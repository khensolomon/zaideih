/**
 * Albums held back from listeners without a release (docs/holds.md).
 *
 * The catalog ships with each release; a hold is how an album is taken out of
 * reach at once, and given back, without one. Nothing is deleted: the album,
 * its songs and their files stay where they are.
 *
 *   streaming off   the album stays listed, its songs greyed out; they do not play
 *   listed off      the album is hidden from the public, its songs too; they do not play
 *
 * An album with both on has no hold. The Worker refuses the held songs
 * (`heldTracks`, read again every HELD_TTL_MS per isolate); the app reads
 * GET /holds when it starts and every few minutes, and applies it to its
 * catalog (src/core/holds.js).
 *
 *   GET  /holds                public: { at, albums: { <album id>: { streaming, listed } } }
 *   GET  /holds/detail         Albums right: every hold with its reason, who and when,
 *                              and the latest changes
 *   POST /holds/:album {streaming, listed, reason, tracks}
 *                              Albums right: the album's hold; `tracks` are its
 *                              songs (the catalog the Workspace reads), each
 *                              one in the tracks table. A reason is needed to
 *                              hold an album back, not to give it back.
 *
 * The owner and co-owners hold the Albums right; the owner gives it to others
 * (Members), as any right.
 */
import { answer, corsOf, HttpError, preflight, readBody } from "./http.js";
import { MemberError, can, memberRow } from "./members.js";
import { sessionMember } from "./accounts.js";

const MAX_REASON = 300;
const MAX_TRACKS = 500;
const LOG = 100;
const PUBLIC_S = 60;
export const HELD_TTL_MS = 60_000;
const ALBUM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PUBLIC_KEY = new Request("https://cache.internal/holds/v1");
const edge = () => globalThis.caches?.default ?? null;

/** What the app applies: every held album, without reasons or names. */
export async function publicHolds(env) {
	const rows = (await env.DB.prepare("SELECT album_id, streaming, listed, at FROM album_holds").all()).results ?? [];
	const albums = {};
	let at = 0;
	for (const r of rows) {
		albums[r.album_id] = { streaming: Boolean(r.streaming), listed: Boolean(r.listed) };
		at = Math.max(at, r.at);
	}
	return { at, albums };
}

let held = null;

/**
 * The songs the Worker refuses: a Set of track ids, read again after
 * HELD_TTL_MS. When D1 cannot be read, the last set read is kept (none at
 * first) and the failure is logged: a hold must never stop the rest of the
 * catalog from playing.
 */
export async function heldTracks(env, now = Date.now()) {
	if (held && held.until > now) return held.ids;
	try {
		const rows = (await env.DB.prepare("SELECT track_id FROM album_hold_tracks").all()).results ?? [];
		held = { ids: new Set(rows.map((r) => r.track_id)), until: now + HELD_TTL_MS };
	} catch (err) {
		console.error("could not read album_hold_tracks; songs are not held until it can be read", err);
		held = { ids: held?.ids ?? new Set(), until: now + HELD_TTL_MS };
	}
	return held.ids;
}

/** Forgets the held songs read so far (tests, and a change made in this isolate). */
export function forgetHeld() {
	held = null;
}

export async function handleHolds(request, env, ctx, { now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const match = /^\/holds(?:\/(detail|[^/]+))?\/?$/.exec(url.pathname);
	const cors = corsOf(env, request);
	const m = request.method;
	if (m === "OPTIONS") return preflight(cors);
	if (!match) return answer(404, { error: "hold addresses are /holds and /holds/<album id>" }, cors ?? "*");
	const nowSeconds = Math.floor(now() / 1000);
	try {
		if (!env.DB) throw new MemberError("holds are not set up on this Worker: missing DB", 503);
		if (!match[1] && (m === "GET" || m === "HEAD")) {
			const cache = edge();
			const hit = cache ? await cache.match(PUBLIC_KEY) : null;
			const headers = { "Cache-Control": `public, max-age=${PUBLIC_S}` };
			if (hit) return answer(200, await hit.json(), "*", headers);
			const body = await publicHolds(env);
			if (cache) {
				const put = cache.put(PUBLIC_KEY, new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${PUBLIC_S}` } }));
				if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
			}
			return answer(200, body, "*", headers);
		}
		if (!cors) throw new MemberError("this origin may not change holds (AUTH_ORIGINS)", 403);
		const me = await memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds);
		if (me.blocked) throw new MemberError(`blocked by ${me.blocked.by}: ${me.blocked.reason}`, 403);
		if (!can(me, "albums")) throw new MemberError("this needs the Albums right", 403);

		if (match[1] === "detail" && m === "GET") {
			const holds = (await env.DB.prepare("SELECT album_id, streaming, listed, reason, set_by, at FROM album_holds ORDER BY at DESC").all()).results ?? [];
			const log = (await env.DB.prepare("SELECT album_id, streaming, listed, reason, set_by, at FROM album_hold_log ORDER BY at DESC, id DESC LIMIT ?1").bind(LOG).all()).results ?? [];
			const shape = (r) => ({ album: r.album_id, streaming: Boolean(r.streaming), listed: Boolean(r.listed), reason: r.reason, by: r.set_by, at: r.at });
			return answer(200, { holds: holds.map(shape), log: log.map(shape) }, cors);
		}
		if (match[1] === "detail" || m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 404);

		const album = decodeURIComponent(match[1]);
		if (!ALBUM_ID.test(album)) throw new MemberError("the album id is letters, digits, - and _ only");
		const body = await readBody(request, 64 * 1024);
		if (typeof body.streaming !== "boolean" || typeof body.listed !== "boolean") throw new MemberError("streaming and listed must be true or false");
		const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim() : "";
		if (reason.length > MAX_REASON) throw new MemberError(`the reason may be at most ${MAX_REASON} characters`);
		const holding = !body.streaming || !body.listed;
		if (holding && !reason) throw new MemberError("say why the album is held back; it is kept with the change");
		const tracks = body.tracks;
		if (!Array.isArray(tracks) || !tracks.length || tracks.length > MAX_TRACKS || !tracks.every((t) => Number.isSafeInteger(t) && t > 0)) {
			throw new MemberError(`tracks must be the album's songs: 1 to ${MAX_TRACKS} song ids`);
		}
		const ids = JSON.stringify([...new Set(tracks)]);
		const known = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tracks WHERE id IN (SELECT value FROM json_each(?1))").bind(ids).first())?.n ?? 0;
		if (known !== new Set(tracks).size) throw new MemberError(`${new Set(tracks).size - known} of these songs are not in the catalog's tracks; release the catalog first`, 404);
		const note = reason || "given back";
		await env.DB.batch([
			env.DB.prepare("DELETE FROM album_hold_tracks WHERE album_id = ?1").bind(album),
			holding
				? env.DB.prepare(`INSERT INTO album_holds (album_id, streaming, listed, reason, set_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
					ON CONFLICT (album_id) DO UPDATE SET streaming = excluded.streaming, listed = excluded.listed, reason = excluded.reason, set_by = excluded.set_by, at = excluded.at`)
					.bind(album, Number(body.streaming), Number(body.listed), note, me.login, nowSeconds)
				: env.DB.prepare("DELETE FROM album_holds WHERE album_id = ?1").bind(album),
			...(holding ? [env.DB.prepare("INSERT OR REPLACE INTO album_hold_tracks (track_id, album_id) SELECT value, ?2 FROM json_each(?1)").bind(ids, album)] : []),
			env.DB.prepare("INSERT INTO album_hold_log (album_id, streaming, listed, reason, set_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(album, Number(body.streaming), Number(body.listed), note, me.login, nowSeconds),
		]);
		forgetHeld();
		try { await edge()?.delete(PUBLIC_KEY); } catch (err) { console.warn("could not remove the holds from the edge cache", err); }
		return answer(200, { album, streaming: body.streaming, listed: body.listed, reason: note, by: me.login, at: nowSeconds }, cors);
	} catch (err) {
		if (err instanceof HttpError) return answer(err.status, { error: err.message }, cors ?? "*");
		console.error("holds request failed", err);
		return answer(500, { error: "the holds request failed on the Worker" }, cors ?? "*");
	}
}
