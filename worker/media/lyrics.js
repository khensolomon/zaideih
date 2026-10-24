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
 *   POST /lyrics/:track/link {to}        signed in: this recording shows the
 *                                        lyrics of recording `to` (shared lyrics)
 *   POST /lyrics/:track/unlink {copy}    Lyrics right: no longer shared; with
 *                                        copy, the recording keeps a copy of
 *                                        the text (and its timing) as its own
 *
 * Shared lyrics (docs/lyrics.md): the same song recorded on several albums
 * shows one text. Every route on a linked recording reads and writes the
 * text of the recording it links to (its source), in every language: an
 * edit, a translation, hiding or restoring there is one for all of them.
 * Timing is each recording's own: a shared text keeps no times; each
 * recording's are kept apart (lyrics_times), written into the text it reads
 * and taken out of the text it saves. Linking never covers lyrics: a
 * recording with lyrics of its own (in any language) is refused.
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
import { applyTimes, clearTimes, extractTimes, looksZawgyi, lyricsWords } from "../../src/core/lyrics-format.js";

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

/** The recording a linked recording takes its lyrics from; the recording itself when it is not linked. */
async function sourceOf(env, track) {
	const link = await env.DB.prepare("SELECT source FROM lyrics_links WHERE track = ?1 AND unlinked_at IS NULL").bind(track).first();
	return link?.source ?? track;
}

/** The recordings linked to `source`, in order. */
async function linkedTo(env, source) {
	return ((await env.DB.prepare("SELECT track FROM lyrics_links WHERE source = ?1 AND unlinked_at IS NULL ORDER BY track").bind(source).all()).results ?? []).map((r) => r.track);
}

/** One recording's own timing of a shared text (extractTimes), or []. */
async function timesOf(env, track, lang) {
	const row = await env.DB.prepare("SELECT times FROM lyrics_times WHERE track = ?1 AND lang = ?2").bind(track, lang).first();
	return row ? JSON.parse(row.times) : [];
}

/** Keeps one recording's timing of a shared text; none removes it. */
async function keepTimes(env, track, lang, times, memberId, nowSeconds) {
	if (!times.length) await env.DB.prepare("DELETE FROM lyrics_times WHERE track = ?1 AND lang = ?2").bind(track, lang).run();
	else await env.DB.prepare("INSERT INTO lyrics_times (track, lang, times, member_id, at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (track, lang) DO UPDATE SET times = excluded.times, member_id = excluded.member_id, at = excluded.at").bind(track, lang, JSON.stringify(times), memberId, nowSeconds).run();
}

/** Lyrics changed: the public answers of `tracks` in `lang` and the full index are read again. */
async function forget(tracks, lang) {
	try {
		await Promise.all([...[tracks].flat().map((t) => edge()?.delete(cacheKey(t, lang))), edge()?.delete(INDEX_KEY)]);
	} catch (err) {
		console.warn("could not remove lyrics from the edge cache", err);
	}
}

/** A source's lyrics in `lang` changed: its answer, and every linked recording's, are read again. */
async function forgetShared(env, source, lang) {
	await forget([source, ...(await linkedTo(env, source))], lang);
}

/**
 * What a recording shows: its source's lyrics, with its own timing when the
 * text is shared, and the other recordings sharing it. Null when there is
 * none (or it is hidden) and `hiddenToo` is not set.
 */
async function view(env, track, lang, { hiddenToo = false } = {}) {
	const source = await sourceOf(env, track);
	const row = await current(env, source, lang);
	if (!row || (row.hidden_at && !hiddenToo)) return null;
	const linked = await linkedTo(env, source);
	if (!linked.length) return shown(row);
	return {
		...shown(row),
		track,
		text: applyTimes(row.text, await timesOf(env, track, lang)),
		shared: { source, with: [source, ...linked].filter((t) => t !== track) },
	};
}

/** Public read, from the edge cache when it holds the answer. */
async function read(env, track, lang, ctx) {
	const cache = edge();
	const hit = cache ? await cache.match(cacheKey(track, lang)) : null;
	const headers = { "Cache-Control": `public, max-age=${BROWSER_S}` };
	if (hit) return answer(hit.status, await hit.json(), "*", headers);
	const shownNow = await view(env, track, lang);
	const [status, body] = shownNow ? [200, shownNow] : [404, { error: "no lyrics for this song yet", track, lang }];
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
	// Linked recordings show their source's words: changed when the link or the source's text did.
	const linked = (await env.DB.prepare(`SELECT k.track, l.lang, l.version, l.text, l.words, l.hidden_at, k.unlinked_at,
		MAX(k.at, l.changed_at, COALESCE(k.unlinked_at, 0)) AS changed_at
		FROM lyrics_links k JOIN lyrics l ON l.track = k.source
		WHERE MAX(k.at, l.changed_at, COALESCE(k.unlinked_at, 0)) >= ?1 ${since ? "" : "AND k.unlinked_at IS NULL AND l.hidden_at IS NULL"} ORDER BY k.track, l.lang`).bind(since).all()).results ?? [];
	for (const r of linked) r.words ??= lyricsWords(r.text);
	const all = [...rows, ...linked];
	const out = (r) => r.hidden_at || r.unlinked_at;
	const body = {
		at: all.reduce((t, r) => Math.max(t, r.changed_at), since) || nowSeconds,
		// The app drops what is gone, then adds what is shown: a recording unlinked with a copy of its own keeps it.
		songs: all.filter((r) => !out(r)).map((r) => [r.track, r.lang, r.version, r.words]),
		gone: all.filter(out).map((r) => [r.track, r.lang]),
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
	await forgetShared(env, track, lang);
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
	const match = /^\/lyrics\/(?:(recent|index)|(\d{1,12})(?:\/(versions|hide|show|restore|report|resolve|link|unlink))?)\/?$/.exec(url.pathname);
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
			const source = await sourceOf(env, track);
			const shared = (await linkedTo(env, source)).length > 0;
			const row = await current(env, source, lang);
			if (row?.hidden_at && !can(me, "lyrics")) throw new MemberError(`these lyrics were taken down by ${row.hidden_by}: ${row.hidden_reason}`, 403);
			// A shared text keeps no times: this recording's go apart, the words to the source.
			const words = shared ? cleanLyrics(clearTimes(text)) : text;
			const changed = !(row && row.version === base && row.text === words);
			if (changed && !can(me, "lyrics")) {
				const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM lyrics_versions WHERE member_id = ?1 AND at > ?2").bind(me.id, nowSeconds - 3600).first())?.n ?? 0;
				if (n >= MAX_PER_HOUR) throw new MemberError(`you have saved ${n} versions of lyrics in the last hour; try again later (your text stays in the studio)`, 429);
			}
			if (!shared) return answer(200, changed ? await write(env, source, lang, words, base, me.id, "", nowSeconds) : shown(row), cors);
			try {
				if (changed) await write(env, source, lang, words, base, me.id, "", nowSeconds);
			} catch (err) {
				if (err.current) err.current = await view(env, track, lang);
				throw err;
			}
			await keepTimes(env, track, lang, extractTimes(text), me.id, nowSeconds);
			await forgetShared(env, source, lang);
			return answer(200, await view(env, track, lang, { hiddenToo: true }), cors);
		}

		if (action === "link" && m === "POST") {
			const body = await readBody(request);
			if (!Number.isSafeInteger(body.to) || body.to <= 0) throw new MemberError("to must be the song whose lyrics to show");
			await checkTrack(env, track);
			await checkTrack(env, body.to);
			const already = await env.DB.prepare("SELECT source FROM lyrics_links WHERE track = ?1 AND unlinked_at IS NULL").bind(track).first();
			if (already) throw new MemberError(`this song already shows the lyrics of song ${already.source}; someone with the Lyrics right can unlink it first`, 409);
			// Never over lyrics: a song with its own (in any language), or whose lyrics others show, is left alone.
			const own = (await env.DB.prepare("SELECT COUNT(*) AS n FROM lyrics WHERE track = ?1").bind(track).first())?.n ?? 0;
			if (own) throw new MemberError("this song has lyrics of its own; linking would cover them, so it is not done. Someone with the Lyrics right can compare the two and decide", 409);
			if ((await linkedTo(env, track)).length) throw new MemberError("other songs show this song's lyrics; it cannot show another's", 409);
			const source = await sourceOf(env, body.to);
			if (source === track) throw new MemberError("a song cannot show its own lyrics");
			const original = await current(env, source, "");
			if (!original || original.hidden_at) throw new MemberError(`song ${body.to} has no lyrics to share`, 404);
			const langs = (await env.DB.prepare("SELECT lang, version, text FROM lyrics WHERE track = ?1").bind(source).all()).results ?? [];
			// Shared for the first time: the source's timing is its own, so it moves out of the text.
			if (!(await linkedTo(env, source)).length) {
				for (const r of langs) {
					const times = extractTimes(r.text);
					if (!times.length) continue;
					await keepTimes(env, source, r.lang, times, me.id, nowSeconds);
					await write(env, source, r.lang, cleanLyrics(clearTimes(r.text)), r.version, me.id, `shared with song ${track}; each recording keeps its own timing`, nowSeconds);
				}
			}
			await env.DB.prepare(`INSERT INTO lyrics_links (track, source, member_id, at) VALUES (?1, ?2, ?3, ?4)
				ON CONFLICT (track) DO UPDATE SET source = excluded.source, member_id = excluded.member_id, at = excluded.at, unlinked_at = NULL, unlinked_by = NULL`).bind(track, source, me.id, nowSeconds).run();
			for (const r of langs) await forgetShared(env, source, r.lang);
			return answer(200, await view(env, track, "", { hiddenToo: true }), cors);
		}

		if (action === "report" && m === "POST") {
			const body = await readBody(request);
			const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim() : "";
			if (!reason || reason.length > MAX_REASON) throw new MemberError(`say what is wrong in 1 to ${MAX_REASON} characters`);
			if (!(await view(env, track, lang, { hiddenToo: true }))) throw new MemberError("this song has no lyrics to report", 404);
			// One open report per member, song and language: a second one replaces the first.
			await env.DB.batch([
				env.DB.prepare("DELETE FROM lyrics_reports WHERE track = ?1 AND lang = ?3 AND member_id = ?2 AND resolved_at IS NULL").bind(track, me.id, lang),
				env.DB.prepare("INSERT INTO lyrics_reports (track, lang, member_id, reason, at) VALUES (?1, ?5, ?2, ?3, ?4)").bind(track, me.id, reason, nowSeconds, lang),
			]);
			return answer(201, { reported: true }, cors);
		}

		mayModerate(me);
		if (action === "unlink" && m === "POST") {
			const body = await readBody(request);
			const link = await env.DB.prepare("SELECT source FROM lyrics_links WHERE track = ?1 AND unlinked_at IS NULL").bind(track).first();
			if (!link) throw new MemberError("this song does not show another song's lyrics", 404);
			const langs = (await env.DB.prepare("SELECT lang, text FROM lyrics WHERE track = ?1").bind(link.source).all()).results ?? [];
			if (body.copy === true) {
				// A copy of its own first, with its own timing; the source is not touched.
				for (const r of langs) {
					if (await current(env, track, r.lang)) continue;
					await write(env, track, r.lang, cleanLyrics(applyTimes(r.text, await timesOf(env, track, r.lang))), 0, me.id, `copied from song ${link.source}`, nowSeconds);
				}
			}
			await env.DB.batch([
				env.DB.prepare("UPDATE lyrics_links SET unlinked_at = ?2, unlinked_by = ?3 WHERE track = ?1").bind(track, nowSeconds, me.login),
				env.DB.prepare("DELETE FROM lyrics_times WHERE track = ?1").bind(track),
			]);
			for (const r of langs) await forget([track, link.source, ...(await linkedTo(env, link.source))], r.lang);
			return answer(200, { track, source: link.source, copied: body.copy === true }, cors);
		}
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
		// The text a linked song shows is its source's: its history, hiding and restoring are the source's.
		const target = await sourceOf(env, track);
		if (action === "versions" && m === "GET") {
			const row = await current(env, target, lang);
			const versions = (await env.DB.prepare(`SELECT v.version, v.text, v.at, v.note, v.member_id, m.name FROM lyrics_versions v LEFT JOIN members m ON m.id = v.member_id
				WHERE v.track = ?1 AND v.lang = ?2 ORDER BY v.version DESC`).bind(target, lang).all()).results ?? [];
			return answer(200, {
				track,
				source: target,
				lang,
				version: row?.version ?? 0,
				hidden: row?.hidden_at ? { at: row.hidden_at, by: row.hidden_by, reason: row.hidden_reason } : null,
				versions: versions.map((v) => ({ version: v.version, text: v.text, at: v.at, note: v.note, by: { id: v.member_id, name: nameOf(v) } })),
				reports: ((await env.DB.prepare(`SELECT r.reason, r.at, m.name FROM lyrics_reports r LEFT JOIN members m ON m.id = r.member_id
					WHERE r.track IN (?1, ?3) AND r.lang = ?2 AND r.resolved_at IS NULL ORDER BY r.at DESC`).bind(track, lang, target).all()).results ?? []).map((r) => ({ reason: r.reason, at: r.at, by: nameOf(r) })),
			}, cors);
		}
		if (m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		const body = await readBody(request);
		const row = await current(env, target, lang);
		if (!row) throw new MemberError("this song has no lyrics yet", 404);
		// Every decision on a song deals with its open reports.
		const resolve = () => env.DB.prepare("UPDATE lyrics_reports SET resolved_at = ?2, resolved_by = ?3 WHERE track IN (?1, ?5) AND lang = ?4 AND resolved_at IS NULL").bind(track, nowSeconds, me.login, lang, target).run();
		if (action === "resolve") {
			await resolve();
		} else if (action === "hide") {
			const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim() : "";
			if (!reason || reason.length > MAX_REASON) throw new MemberError(`give a reason of 1 to ${MAX_REASON} characters; it is shown to whoever tries to edit them`);
			await env.DB.prepare("UPDATE lyrics SET hidden_at = ?3, hidden_by = ?4, hidden_reason = ?5, changed_at = ?3 WHERE track = ?1 AND lang = ?2").bind(target, lang, nowSeconds, me.login, reason).run();
		} else if (action === "show") {
			await env.DB.prepare("UPDATE lyrics SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL, changed_at = ?3 WHERE track = ?1 AND lang = ?2").bind(target, lang, nowSeconds).run();
		} else {
			const base = baseOf(body);
			if (!Number.isSafeInteger(body.version)) throw new MemberError("version must be the version to restore");
			const old = await env.DB.prepare("SELECT text FROM lyrics_versions WHERE track = ?1 AND lang = ?2 AND version = ?3").bind(target, lang, body.version).first();
			if (!old) throw new MemberError(`there is no version ${body.version} of these lyrics`, 404);
			// A version from before the text was shared may carry times: a shared text keeps none.
			const text = (await linkedTo(env, target)).length ? cleanLyrics(clearTimes(old.text)) : old.text;
			await write(env, target, lang, text, base, me.id, `restored version ${body.version}`, nowSeconds);
		}
		if (action !== "resolve") await resolve();
		await forgetShared(env, target, lang);
		const after = await current(env, target, lang);
		return answer(200, { ...(await view(env, track, lang, { hiddenToo: true })), hidden: after.hidden_at ? { at: after.hidden_at, by: after.hidden_by, reason: after.hidden_reason } : null }, cors);
	} catch (err) {
		if (err instanceof MemberError) return answer(err.status, { error: err.message, ...(err.current !== undefined ? { current: err.current } : {}) }, cors ?? "*");
		console.error("lyrics request failed", err);
		return answer(500, { error: "the lyrics request failed on the Worker" }, cors ?? "*");
	}
}
