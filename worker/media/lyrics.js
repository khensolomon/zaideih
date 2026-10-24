/**
 * Lyrics of catalog songs (docs/lyrics.md).
 *
 * Every song has its own lyrics (the original, lang "") and may have
 * translations ("en", "my"), each kept and versioned on its own. Every route
 * on a song takes ?lang= (none: the original).
 *
 *   GET  /lyrics/:track                  public: {track, lang, version, text, updated} or 404
 *   POST /lyrics/:track {text, base}     signed in: a new version; 409 with the
 *                                        current lyrics when `base` is not the
 *                                        latest version (someone else saved first)
 *   GET  /lyrics/:track/versions         Lyrics right: every version, who and when
 *   POST /lyrics/:track/hide {reason}    Lyrics right: no longer shown
 *   POST /lyrics/:track/show             Lyrics right: shown again
 *   POST /lyrics/:track/restore {version, base}
 *                                        Lyrics right: an earlier version's text
 *                                        becomes the newest version
 *   POST /lyrics/:track/report {reason}  signed in: something is wrong with them
 *   POST /lyrics/:track/resolve          Lyrics right: its open reports dealt with
 *   GET  /lyrics/recent                  Lyrics right: the latest edits, and the
 *                                        songs with open reports
 *   GET  /lyrics/index?since=<seconds>   public: what the app searches (below)
 *
 * The index: every shown text's words (no times, chords or details: what is
 * sung, plus an original title), for searching songs by a line of their
 * lyrics on the device, and for marking songs that have lyrics. With
 * since=0, all of it (edge cached until the next change); with a later
 * since, what changed from then: texts shown, and those hidden ("gone").
 *
 * Myanmar text must be Unicode: text in the Zawgyi encoding is refused (422)
 * with a clear message, never converted. A member (without the Lyrics right)
 * saves at most MAX_PER_HOUR versions an hour.
 *
 * Anyone signed in (and not blocked) adds or edits lyrics; they appear at
 * once. Every version is kept (`lyrics_versions`), so a bad edit is undone
 * by restoring an earlier one, never lost. Hidden lyrics answer 404 to
 * listeners; only the Lyrics right edits them while hidden.
 *
 * Public answers are kept in the Worker's edge cache (caches.default) and
 * removed from it on every change, so reading lyrics costs no D1 query
 * after the first listener in a region.
 */
import { MemberError, can, memberRow } from "./members.js";
import { sessionMember } from "./accounts.js";
import { looksZawgyi, lyricsWords } from "../../src/core/lyrics-format.js";

export const MAX_LYRICS = 20_000;
/** The languages lyrics are kept in: "" the song's own words, then translations. */
export const LANGS = Object.freeze(["", "en", "my"]);
const MAX_REASON = 300;
export const MAX_PER_HOUR = 30;
const RECENT = 50;
const BROWSER_S = 300;
const EDGE_S = 7 * 86_400;
const cacheKey = (track, lang) => new Request(`https://cache.internal/lyrics/v2/${track}${lang ? `/${lang}` : ""}`);
const INDEX_KEY = new Request("https://cache.internal/lyrics/v2/index");
const edge = () => globalThis.caches?.default ?? null;

/** Lyrics as kept: NFC, \n line ends, no spaces at line ends, no blank lines at either end. */
export function cleanLyrics(text) {
	if (typeof text !== "string") throw new MemberError("text must be the lyrics");
	const clean = text.normalize("NFC").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t ]+$/u, "")).join("\n").replace(/^\n+|\n+$/g, "").replace(/\n{3,}/g, "\n\n");
	if (!clean.trim()) throw new MemberError("the lyrics are empty; to take lyrics down, ask someone with the Lyrics right to hide them");
	if (clean.length > MAX_LYRICS) throw new MemberError(`lyrics may be at most ${MAX_LYRICS} characters`, 413);
	if (looksZawgyi(clean)) throw new MemberError("this text is in the Zawgyi encoding; Zaideih keeps Myanmar text in Unicode only. Convert it to Unicode first, then save", 422);
	return clean;
}

function answer(status, body, cors, extra = {}) {
	const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
	if (cors) headers.set("Access-Control-Allow-Origin", cors);
	if (cors && cors !== "*") headers.set("Vary", "Origin");
	return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

const current = (env, track, lang) => env.DB.prepare("SELECT track, lang, version, text, updated_at, hidden_at, hidden_by, hidden_reason FROM lyrics WHERE track = ?1 AND lang = ?2").bind(track, lang).first();
const shown = (row) => ({ track: row.track, lang: row.lang, version: row.version, text: row.text, updated: row.updated_at });

/** A song's lyrics in one language changed: its public answer and the full index are read again. */
async function forget(track, lang) {
	try {
		await Promise.all([edge()?.delete(cacheKey(track, lang)), edge()?.delete(INDEX_KEY)]);
	} catch (err) {
		console.warn("could not remove lyrics from the edge cache", err);
	}
}

/** Public read, from the edge cache when it holds the answer. */
async function read(env, track, lang, ctx) {
	const cache = edge();
	const hit = cache ? await cache.match(cacheKey(track, lang)) : null;
	const headers = { "Cache-Control": `public, max-age=${BROWSER_S}` };
	if (hit) return answer(hit.status, await hit.json(), "*", headers);
	const row = await current(env, track, lang);
	const [status, body] = row && !row.hidden_at ? [200, shown(row)] : [404, { error: "no lyrics for this song yet", track, lang }];
	if (cache) {
		const put = cache.put(cacheKey(track, lang), new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_S}` } }));
		if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
	}
	return answer(status, body, "*", headers);
}

/**
 * The index (see above): { at, songs: [[track, lang, version, words]], gone: [[track, lang]] }.
 * `at` is what to ask `since` next time. Texts saved before the words were
 * kept (words NULL) get them now, once.
 */
async function index(env, since, ctx, nowSeconds) {
	const cache = edge();
	const headers = { "Cache-Control": "public, max-age=60" };
	if (!since && cache) {
		const hit = await cache.match(INDEX_KEY);
		if (hit) return answer(200, await hit.json(), "*", headers);
	}
	const rows = (await env.DB.prepare(`SELECT track, lang, version, text, words, hidden_at, changed_at FROM lyrics WHERE changed_at >= ?1 ${since ? "" : "AND hidden_at IS NULL"} ORDER BY track, lang`).bind(since).all()).results ?? [];
	const missing = rows.filter((r) => r.words === null);
	if (missing.length) {
		for (const r of missing) r.words = lyricsWords(r.text);
		await env.DB.batch(missing.map((r) => env.DB.prepare("UPDATE lyrics SET words = ?3 WHERE track = ?1 AND lang = ?2").bind(r.track, r.lang, r.words)));
	}
	const body = {
		at: rows.reduce((t, r) => Math.max(t, r.changed_at), since) || nowSeconds,
		songs: rows.filter((r) => !r.hidden_at).map((r) => [r.track, r.lang, r.version, r.words]),
		gone: rows.filter((r) => r.hidden_at).map((r) => [r.track, r.lang]),
	};
	if (!since && cache) {
		const put = cache.put(INDEX_KEY, new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_S}` } }));
		if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
	}
	return answer(200, body, "*", headers);
}

/**
 * Writes `text` as the next version when the latest is `base`; answers the
 * new lyrics, or throws 409 with the current ones. Both rows in one batch.
 */
async function write(env, track, lang, text, base, memberId, note, nowSeconds) {
	const same = "COALESCE((SELECT version FROM lyrics WHERE track = ?1 AND lang = ?7), 0) = ?2";
	// New lyrics start from 0: a later base for a song without lyrics is someone else's history (since hidden or gone).
	if (base > 0 && !(await current(env, track, lang))) {
		const err = new MemberError("these lyrics are no longer there; start again from an empty page", 409);
		err.current = null;
		throw err;
	}
	const words = lyricsWords(text);
	const results = await env.DB.batch([
		env.DB.prepare(`INSERT INTO lyrics_versions (track, lang, version, text, member_id, at, note) SELECT ?1, ?7, ?2 + 1, ?3, ?4, ?5, ?6 WHERE ${same}`).bind(track, base, text, memberId, nowSeconds, note, lang),
		env.DB.prepare(`INSERT INTO lyrics (track, lang, version, text, words, updated_at, updated_by, changed_at) VALUES (?1, ?6, ?2 + 1, ?3, ?7, ?5, ?4, ?5)
			ON CONFLICT (track, lang) DO UPDATE SET version = excluded.version, text = excluded.text, words = excluded.words, updated_at = excluded.updated_at, updated_by = excluded.updated_by, changed_at = excluded.changed_at
			WHERE lyrics.version = ?2`).bind(track, base, text, memberId, nowSeconds, lang, words),
	]);
	const row = await current(env, track, lang);
	if (!results[1]?.meta?.changes) {
		const err = new MemberError("someone else saved these lyrics while you were editing; your text is kept, compare it with theirs", 409);
		err.current = row && !row.hidden_at ? shown(row) : null;
		throw err;
	}
	await forget(track, lang);
	return shown(row);
}

async function checkTrack(env, track) {
	const row = await env.DB.prepare("SELECT id FROM tracks WHERE id = ?1").bind(track).first();
	if (!row) throw new MemberError(`there is no song ${track} in the catalog`, 404);
}

function baseOf(body) {
	if (!Number.isSafeInteger(body.base) || body.base < 0) throw new MemberError("base must be the version you started from (0 for new lyrics)");
	return body.base;
}

async function readBody(request) {
	const text = await request.text();
	if (text.length > MAX_LYRICS * 4 + 1024) throw new MemberError("request body too large", 413);
	try {
		const v = JSON.parse(text || "{}");
		if (v && typeof v === "object" && !Array.isArray(v)) return v;
	} catch { /* below */ }
	throw new MemberError("body must be a JSON object");
}

/** Signed-in routes: the member, refused when blocked. */
async function signedIn(env, request, nowSeconds) {
	const me = await memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds);
	if (me.blocked) throw new MemberError(`You cannot edit lyrics: blocked by ${me.blocked.by}: ${me.blocked.reason}`, 403);
	return me;
}

function mayModerate(me) {
	if (!can(me, "lyrics")) throw new MemberError("this needs the Lyrics right", 403);
}

const nameOf = (r) => r.name ?? "a member no longer here";

export async function handleLyrics(request, env, ctx, { now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const match = /^\/lyrics\/(?:(recent|index)|(\d{1,12})(?:\/(versions|hide|show|restore|report|resolve))?)\/?$/.exec(url.pathname);
	const origin = request.headers.get("origin");
	const origins = new Set((env.AUTH_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
	const cors = origin && origins.has(origin) ? origin : null;
	const m = request.method;
	if (m === "OPTIONS") {
		if (!cors) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } });
	}
	if (!match) return answer(404, { error: "lyrics addresses are /lyrics/<song id>" }, cors ?? "*");
	const track = Number(match[2] ?? 0);
	const action = match[1] ?? match[3] ?? "";
	const lang = url.searchParams.get("lang") ?? "";
	const nowSeconds = Math.floor(now() / 1000);
	try {
		if (!env.DB) throw new MemberError("lyrics are not set up on this Worker: missing DB", 503);
		if (!LANGS.includes(lang)) throw new MemberError(`lang must be one of: the original (none), ${LANGS.filter(Boolean).join(", ")}`);
		if (action === "index" && (m === "GET" || m === "HEAD")) {
			const since = Number(url.searchParams.get("since") ?? 0);
			if (!Number.isSafeInteger(since) || since < 0) throw new MemberError("since must be the `at` of the last index (0 for all of it)");
			return await index(env, since, ctx, nowSeconds);
		}
		if (!action && (m === "GET" || m === "HEAD")) return await read(env, track, lang, ctx);
		if (!cors) throw new MemberError("this origin may not edit lyrics (AUTH_ORIGINS)", 403);
		const me = await signedIn(env, request, nowSeconds);

		if (!action && m === "POST") {
			const body = await readBody(request);
			await checkTrack(env, track);
			const text = cleanLyrics(body.text);
			const base = baseOf(body);
			const row = await current(env, track, lang);
			if (row?.hidden_at && !can(me, "lyrics")) throw new MemberError(`these lyrics were taken down by ${row.hidden_by}: ${row.hidden_reason}`, 403);
			if (!can(me, "lyrics")) {
				const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM lyrics_versions WHERE member_id = ?1 AND at > ?2").bind(me.id, nowSeconds - 3600).first())?.n ?? 0;
				if (n >= MAX_PER_HOUR) throw new MemberError(`you have saved ${n} versions of lyrics in the last hour; try again later (your text stays in the studio)`, 429);
			}
			// Unchanged: nothing to keep.
			if (row && row.version === base && row.text === text) return answer(200, shown(row), cors);
			return answer(200, await write(env, track, lang, text, base, me.id, "", nowSeconds), cors);
		}

		if (action === "report" && m === "POST") {
			const body = await readBody(request);
			const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim() : "";
			if (!reason || reason.length > MAX_REASON) throw new MemberError(`say what is wrong in 1 to ${MAX_REASON} characters`);
			if (!(await current(env, track, lang))) throw new MemberError("this song has no lyrics to report", 404);
			// One open report per member, song and language: a second one replaces the first.
			await env.DB.batch([
				env.DB.prepare("DELETE FROM lyrics_reports WHERE track = ?1 AND lang = ?3 AND member_id = ?2 AND resolved_at IS NULL").bind(track, me.id, lang),
				env.DB.prepare("INSERT INTO lyrics_reports (track, lang, member_id, reason, at) VALUES (?1, ?5, ?2, ?3, ?4)").bind(track, me.id, reason, nowSeconds, lang),
			]);
			return answer(201, { reported: true }, cors);
		}

		mayModerate(me);
		if (action === "recent" && m === "GET") {
			const edits = (await env.DB.prepare(`SELECT v.track, v.lang, v.version, v.at, v.note, v.member_id, m.name, l.hidden_at FROM lyrics_versions v
				LEFT JOIN members m ON m.id = v.member_id LEFT JOIN lyrics l ON l.track = v.track AND l.lang = v.lang ORDER BY v.at DESC, v.version DESC LIMIT ?1`).bind(RECENT).all()).results ?? [];
			const reports = (await env.DB.prepare(`SELECT r.track, r.lang, r.reason, r.at, m.name FROM lyrics_reports r LEFT JOIN members m ON m.id = r.member_id
				WHERE r.resolved_at IS NULL ORDER BY r.at DESC LIMIT 200`).all()).results ?? [];
			const bySong = new Map();
			for (const r of reports) {
				const k = `${r.track}/${r.lang}`;
				if (!bySong.has(k)) bySong.set(k, { track: r.track, lang: r.lang, latest: r.at, reasons: [] });
				bySong.get(k).reasons.push({ reason: r.reason, at: r.at, by: nameOf(r) });
			}
			return answer(200, {
				edits: edits.map((e) => ({ track: e.track, lang: e.lang, version: e.version, at: e.at, note: e.note, hidden: Boolean(e.hidden_at), by: { id: e.member_id, name: nameOf(e) } })),
				reports: [...bySong.values()],
			}, cors);
		}
		if (action === "versions" && m === "GET") {
			const row = await current(env, track, lang);
			const versions = (await env.DB.prepare(`SELECT v.version, v.text, v.at, v.note, v.member_id, m.name FROM lyrics_versions v LEFT JOIN members m ON m.id = v.member_id
				WHERE v.track = ?1 AND v.lang = ?2 ORDER BY v.version DESC`).bind(track, lang).all()).results ?? [];
			return answer(200, {
				track,
				lang,
				version: row?.version ?? 0,
				hidden: row?.hidden_at ? { at: row.hidden_at, by: row.hidden_by, reason: row.hidden_reason } : null,
				versions: versions.map((v) => ({ version: v.version, text: v.text, at: v.at, note: v.note, by: { id: v.member_id, name: nameOf(v) } })),
				reports: ((await env.DB.prepare(`SELECT r.reason, r.at, m.name FROM lyrics_reports r LEFT JOIN members m ON m.id = r.member_id
					WHERE r.track = ?1 AND r.lang = ?2 AND r.resolved_at IS NULL ORDER BY r.at DESC`).bind(track, lang).all()).results ?? []).map((r) => ({ reason: r.reason, at: r.at, by: nameOf(r) })),
			}, cors);
		}
		if (m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		const body = await readBody(request);
		const row = await current(env, track, lang);
		if (!row) throw new MemberError("this song has no lyrics yet", 404);
		// Every decision on a song deals with its open reports.
		const resolve = () => env.DB.prepare("UPDATE lyrics_reports SET resolved_at = ?2, resolved_by = ?3 WHERE track = ?1 AND lang = ?4 AND resolved_at IS NULL").bind(track, nowSeconds, me.login, lang).run();
		if (action === "resolve") {
			await resolve();
		} else if (action === "hide") {
			const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim() : "";
			if (!reason || reason.length > MAX_REASON) throw new MemberError(`give a reason of 1 to ${MAX_REASON} characters; it is shown to whoever tries to edit them`);
			await env.DB.prepare("UPDATE lyrics SET hidden_at = ?3, hidden_by = ?4, hidden_reason = ?5, changed_at = ?3 WHERE track = ?1 AND lang = ?2").bind(track, lang, nowSeconds, me.login, reason).run();
		} else if (action === "show") {
			await env.DB.prepare("UPDATE lyrics SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL, changed_at = ?3 WHERE track = ?1 AND lang = ?2").bind(track, lang, nowSeconds).run();
		} else {
			const base = baseOf(body);
			if (!Number.isSafeInteger(body.version)) throw new MemberError("version must be the version to restore");
			const old = await env.DB.prepare("SELECT text FROM lyrics_versions WHERE track = ?1 AND lang = ?2 AND version = ?3").bind(track, lang, body.version).first();
			if (!old) throw new MemberError(`there is no version ${body.version} of these lyrics`, 404);
			await write(env, track, lang, old.text, base, me.id, `restored version ${body.version}`, nowSeconds);
		}
		if (action !== "resolve") await resolve();
		await forget(track, lang);
		const after = await current(env, track, lang);
		return answer(200, { ...shown(after), hidden: after.hidden_at ? { at: after.hidden_at, by: after.hidden_by, reason: after.hidden_reason } : null }, cors);
	} catch (err) {
		if (err instanceof MemberError) return answer(err.status, { error: err.message, ...(err.current !== undefined ? { current: err.current } : {}) }, cors ?? "*");
		console.error("lyrics request failed", err);
		return answer(500, { error: "the lyrics request failed on the Worker" }, cors ?? "*");
	}
}
