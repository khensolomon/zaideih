/**
 * Lyrics of catalog songs (docs/lyrics.md).
 *
 *   GET  /lyrics/:track                  public: {track, version, text, updated} or 404
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
 * The public answer is kept in the Worker's edge cache (caches.default) and
 * removed from it on every change, so reading lyrics costs no D1 query
 * after the first listener in a region.
 */
import { MemberError, can, memberRow } from "./members.js";
import { sessionMember } from "./accounts.js";
import { looksZawgyi } from "../../src/core/lyrics-format.js";

export const MAX_LYRICS = 20_000;
const MAX_REASON = 300;
export const MAX_PER_HOUR = 30;
const RECENT = 50;
const BROWSER_S = 300;
const EDGE_S = 7 * 86_400;
const cacheKey = (track) => new Request(`https://cache.internal/lyrics/v1/${track}`);
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

const current = (env, track) => env.DB.prepare("SELECT track, version, text, updated_at, hidden_at, hidden_by, hidden_reason FROM lyrics WHERE track = ?1").bind(track).first();
const shown = (row) => ({ track: row.track, version: row.version, text: row.text, updated: row.updated_at });

async function forget(track) {
	try {
		await edge()?.delete(cacheKey(track));
	} catch (err) {
		console.warn("could not remove lyrics from the edge cache", err);
	}
}

/** Public read, from the edge cache when it holds the answer. */
async function read(env, track, ctx) {
	const cache = edge();
	const hit = cache ? await cache.match(cacheKey(track)) : null;
	const headers = { "Cache-Control": `public, max-age=${BROWSER_S}` };
	if (hit) return answer(hit.status, await hit.json(), "*", headers);
	const row = await current(env, track);
	const [status, body] = row && !row.hidden_at ? [200, shown(row)] : [404, { error: "no lyrics for this song yet", track }];
	if (cache) {
		const put = cache.put(cacheKey(track), new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_S}` } }));
		if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
	}
	return answer(status, body, "*", headers);
}

/**
 * Writes `text` as the next version when the latest is `base`; answers the
 * new lyrics, or throws 409 with the current ones. Both rows in one batch.
 */
async function write(env, track, text, base, memberId, note, nowSeconds) {
	const same = "COALESCE((SELECT version FROM lyrics WHERE track = ?1), 0) = ?2";
	// New lyrics start from 0: a later base for a song without lyrics is someone else's history (since hidden or gone).
	if (base > 0 && !(await current(env, track))) {
		const err = new MemberError("these lyrics are no longer there; start again from an empty page", 409);
		err.current = null;
		throw err;
	}
	const results = await env.DB.batch([
		env.DB.prepare(`INSERT INTO lyrics_versions (track, version, text, member_id, at, note) SELECT ?1, ?2 + 1, ?3, ?4, ?5, ?6 WHERE ${same}`).bind(track, base, text, memberId, nowSeconds, note),
		env.DB.prepare(`INSERT INTO lyrics (track, version, text, updated_at, updated_by) VALUES (?1, ?2 + 1, ?3, ?5, ?4)
			ON CONFLICT (track) DO UPDATE SET version = excluded.version, text = excluded.text, updated_at = excluded.updated_at, updated_by = excluded.updated_by
			WHERE lyrics.version = ?2`).bind(track, base, text, memberId, nowSeconds),
	]);
	const row = await current(env, track);
	if (!results[1]?.meta?.changes) {
		const err = new MemberError("someone else saved these lyrics while you were editing; your text is kept, compare it with theirs", 409);
		err.current = row && !row.hidden_at ? shown(row) : null;
		throw err;
	}
	await forget(track);
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

export async function handleLyrics(request, env, ctx, { now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const match = /^\/lyrics\/(?:(recent)|(\d{1,12})(?:\/(versions|hide|show|restore|report|resolve))?)\/?$/.exec(url.pathname);
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
	const nowSeconds = Math.floor(now() / 1000);
	try {
		if (!env.DB) throw new MemberError("lyrics are not set up on this Worker: missing DB", 503);
		if (!action && (m === "GET" || m === "HEAD")) return await read(env, track, ctx);
		if (!cors) throw new MemberError("this origin may not edit lyrics (AUTH_ORIGINS)", 403);
		const me = await signedIn(env, request, nowSeconds);

		if (!action && m === "POST") {
			const body = await readBody(request);
			await checkTrack(env, track);
			const text = cleanLyrics(body.text);
			const base = baseOf(body);
			const row = await current(env, track);
			if (row?.hidden_at && !can(me, "lyrics")) throw new MemberError(`these lyrics were taken down by ${row.hidden_by}: ${row.hidden_reason}`, 403);
			if (!can(me, "lyrics")) {
				const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM lyrics_versions WHERE member_id = ?1 AND at > ?2").bind(me.id, nowSeconds - 3600).first())?.n ?? 0;
				if (n >= MAX_PER_HOUR) throw new MemberError(`you have saved ${n} versions of lyrics in the last hour; try again later (your text stays in the studio)`, 429);
			}
			// Unchanged: nothing to keep.
			if (row && row.version === base && row.text === text) return answer(200, shown(row), cors);
			return answer(200, await write(env, track, text, base, me.id, "", nowSeconds), cors);
		}

		if (action === "report" && m === "POST") {
			const body = await readBody(request);
			const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim() : "";
			if (!reason || reason.length > MAX_REASON) throw new MemberError(`say what is wrong in 1 to ${MAX_REASON} characters`);
			if (!(await current(env, track))) throw new MemberError("this song has no lyrics to report", 404);
			// One open report per member and song: a second one replaces the first.
			await env.DB.batch([
				env.DB.prepare("DELETE FROM lyrics_reports WHERE track = ?1 AND member_id = ?2 AND resolved_at IS NULL").bind(track, me.id),
				env.DB.prepare("INSERT INTO lyrics_reports (track, member_id, reason, at) VALUES (?1, ?2, ?3, ?4)").bind(track, me.id, reason, nowSeconds),
			]);
			return answer(201, { reported: true }, cors);
		}

		mayModerate(me);
		if (action === "recent" && m === "GET") {
			const edits = (await env.DB.prepare(`SELECT v.track, v.version, v.at, v.note, v.member_id, m.name, l.hidden_at FROM lyrics_versions v
				LEFT JOIN members m ON m.id = v.member_id LEFT JOIN lyrics l ON l.track = v.track ORDER BY v.at DESC, v.version DESC LIMIT ?1`).bind(RECENT).all()).results ?? [];
			const reports = (await env.DB.prepare(`SELECT r.track, r.reason, r.at, m.name FROM lyrics_reports r LEFT JOIN members m ON m.id = r.member_id
				WHERE r.resolved_at IS NULL ORDER BY r.at DESC LIMIT 200`).all()).results ?? [];
			const bySong = new Map();
			for (const r of reports) {
				if (!bySong.has(r.track)) bySong.set(r.track, { track: r.track, latest: r.at, reasons: [] });
				bySong.get(r.track).reasons.push({ reason: r.reason, at: r.at, by: r.name ?? "a member no longer here" });
			}
			return answer(200, {
				edits: edits.map((e) => ({ track: e.track, version: e.version, at: e.at, note: e.note, hidden: Boolean(e.hidden_at), by: { id: e.member_id, name: e.name ?? "a member no longer here" } })),
				reports: [...bySong.values()],
			}, cors);
		}
		if (action === "versions" && m === "GET") {
			const row = await current(env, track);
			const versions = (await env.DB.prepare(`SELECT v.version, v.text, v.at, v.note, v.member_id, m.name FROM lyrics_versions v LEFT JOIN members m ON m.id = v.member_id
				WHERE v.track = ?1 ORDER BY v.version DESC`).bind(track).all()).results ?? [];
			return answer(200, {
				track,
				version: row?.version ?? 0,
				hidden: row?.hidden_at ? { at: row.hidden_at, by: row.hidden_by, reason: row.hidden_reason } : null,
				versions: versions.map((v) => ({ version: v.version, text: v.text, at: v.at, note: v.note, by: { id: v.member_id, name: v.name ?? "a member no longer here" } })),
				reports: ((await env.DB.prepare(`SELECT r.reason, r.at, m.name FROM lyrics_reports r LEFT JOIN members m ON m.id = r.member_id
					WHERE r.track = ?1 AND r.resolved_at IS NULL ORDER BY r.at DESC`).bind(track).all()).results ?? []).map((r) => ({ reason: r.reason, at: r.at, by: r.name ?? "a member no longer here" })),
			}, cors);
		}
		if (m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		const body = await readBody(request);
		const row = await current(env, track);
		if (!row) throw new MemberError("this song has no lyrics yet", 404);
		// Every decision on a song deals with its open reports.
		const resolve = () => env.DB.prepare("UPDATE lyrics_reports SET resolved_at = ?2, resolved_by = ?3 WHERE track = ?1 AND resolved_at IS NULL").bind(track, nowSeconds, me.login).run();
		if (action === "resolve") {
			await resolve();
		} else if (action === "hide") {
			const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim() : "";
			if (!reason || reason.length > MAX_REASON) throw new MemberError(`give a reason of 1 to ${MAX_REASON} characters; it is shown to whoever tries to edit them`);
			await env.DB.prepare("UPDATE lyrics SET hidden_at = ?2, hidden_by = ?3, hidden_reason = ?4 WHERE track = ?1").bind(track, nowSeconds, me.login, reason).run();
		} else if (action === "show") {
			await env.DB.prepare("UPDATE lyrics SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE track = ?1").bind(track).run();
		} else {
			const base = baseOf(body);
			if (!Number.isSafeInteger(body.version)) throw new MemberError("version must be the version to restore");
			const old = await env.DB.prepare("SELECT text FROM lyrics_versions WHERE track = ?1 AND version = ?2").bind(track, body.version).first();
			if (!old) throw new MemberError(`there is no version ${body.version} of these lyrics`, 404);
			await write(env, track, old.text, base, me.id, `restored version ${body.version}`, nowSeconds);
		}
		if (action !== "resolve") await resolve();
		await forget(track);
		const after = await current(env, track);
		return answer(200, { ...shown(after), hidden: after.hidden_at ? { at: after.hidden_at, by: after.hidden_by, reason: after.hidden_reason } : null }, cors);
	} catch (err) {
		if (err instanceof MemberError) return answer(err.status, { error: err.message, ...(err.current !== undefined ? { current: err.current } : {}) }, cors ?? "*");
		console.error("lyrics request failed", err);
		return answer(500, { error: "the lyrics request failed on the Worker" }, cors ?? "*");
	}
}
