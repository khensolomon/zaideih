/**
 * Asking to publish (docs/library.md): a member's album of uploads asked to
 * join the public catalog, reviewed, and on approval copied to the
 * catalog's place in R2. The catalog itself (albums.json, media.json) is
 * changed by a pull request the reviewer's Workspace opens, since the
 * catalog lives in git; the release that merges it loads the songs, and the
 * member's uploaded copies are then removed (settleReleased).
 *
 * Routes (under /library, see library.js for sign-in and CORS):
 *   POST   /library/requests                {album, lang, note}: ask; every song of the album, MP3 only
 *   GET    /library/requests                the person's own; with Review publishing, every open one
 *                                           and the recent decisions, each song with an address to listen
 *   DELETE /library/requests/<id>           withdraw an open request (its member, or a co-owner)
 *   POST   /library/requests/<id>/reject    {reason}: Review publishing
 *   POST   /library/requests/<id>/approve   {album: <catalog ui>, tracks: [{upload, track, key}]}:
 *                                           Review publishing; copies every song to its key under music/
 *   POST   /library/requests/<id>/pr        {url}: the pull request that adds the album to the catalog
 *
 * The owner and co-owners hold every right, so for them asking and
 * approving is one step on the page ("Public in the catalog").
 */
import { can } from "./members.js";
import { cleanText } from "../../src/core/upload-rules.js";
import { isUpload, json, LibraryError, readJson, signedUrl } from "./library.js";

const CATALOG_ROOT = "music/";
const OPEN = "open";
const RECENT = 50;

const shapeRequest = (r, extra = {}) => ({
	id: r.id, owner: r.owner_id, login: r.login ?? null, album: r.album, lang: r.lang, note: r.note, status: r.status,
	reviewer: r.reviewer, reason: r.reason, catalogAlbum: r.catalog_album, pr: r.pr_url, created: r.created_at, decided: r.decided_at, ...extra,
});

async function requestRow(env, id) {
	const r = await env.DB.prepare("SELECT p.*, m.name AS login FROM publish_requests p LEFT JOIN members m ON m.id = p.owner_id WHERE p.id = ?1").bind(id).first();
	if (!r) throw new LibraryError("no such request", 404);
	return r;
}

/** The songs of a request (uploads waiting under it, or published by it). */
async function songsOf(env, req) {
	const rows = await env.DB.prepare(
		`SELECT u.*, t.track_id, t.r2_key AS catalog_key FROM uploads u
		LEFT JOIN published_tracks t ON t.upload_id = u.id
		WHERE u.owner_id = ?1 AND (t.request_id = ?2 OR (t.request_id IS NULL AND u.album = ?3 AND u.status = 'requested'))
		ORDER BY u.track_no, u.title COLLATE NOCASE`,
	).bind(req.owner_id, req.id, req.album).all();
	return rows.results ?? [];
}

const songOut = async (u, origin, env, nowSeconds) => ({
	upload: u.id, title: u.title, artist: u.artist, album: u.album, year: u.year, track: u.track_no, duration: u.duration,
	format: u.format, size: u.size, fileName: u.file_name, catalogTrack: u.track_id ?? null, catalogKey: u.catalog_key ?? null,
	url: await signedUrl(origin, u.id, env.AUDIO_SIGNING_KEY, nowSeconds),
});

/* ---------------------------------------------------------------- ask ---- */

async function ask(env, me, body, nowSeconds) {
	const album = cleanText(body.album, "album", true);
	// A reviewer publishing their own album chooses the language on the approval form.
	const lang = body.lang === undefined && can(me, "review") ? 0 : Number(body.lang);
	if (!Number.isSafeInteger(lang) || lang < 0 || (lang === 0 && !can(me, "review"))) throw new LibraryError("choose the album's language");
	const note = cleanText(body.note ?? "", "note");
	const rows = (await env.DB.prepare("SELECT * FROM uploads WHERE owner_id = ?1 AND album = ?2 AND status IN ('private', 'requested')").bind(me.id, album).all()).results ?? [];
	if (!rows.length) throw new LibraryError(`no songs of yours are in the album "${album}"`, 404);
	if (rows.some((u) => u.status === "requested")) throw new LibraryError(`"${album}" is already waiting for review`, 409);
	// The catalog streams MP3 (media.json, /audio): other formats need an MP3 copy first.
	const other = rows.filter((u) => u.format !== "mp3");
	if (other.length) {
		throw new LibraryError(`Only MP3 can be published. ${other.length === 1 ? `"${other[0].file_name}" is` : `${other.length} songs (${other.slice(0, 3).map((u) => `"${u.file_name}"`).join(", ")}${other.length > 3 ? ", …" : ""}) are`} ${other[0].format.toUpperCase()}: save an MP3 copy (320 kbps keeps an old recording's sound), upload it, and ask again.`, 415);
	}
	const res = await env.DB.prepare("INSERT INTO publish_requests (owner_id, album, lang, note, status, created_at) VALUES (?1, ?2, ?3, ?4, 'open', ?5)")
		.bind(me.id, album, lang, note, nowSeconds).run();
	await env.DB.prepare("UPDATE uploads SET status = 'requested', updated_at = ?1 WHERE owner_id = ?2 AND album = ?3 AND status = 'private'").bind(nowSeconds, me.id, album).run();
	return { id: res.meta.last_row_id, songs: rows.length };
}

async function list(env, me, origin, nowSeconds) {
	await settleReleased(env);
	const reviewer = can(me, "review");
	const rows = (await env.DB.prepare(
		reviewer
			? `SELECT p.*, m.name AS login FROM publish_requests p LEFT JOIN members m ON m.id = p.owner_id
				WHERE p.status = 'open' OR p.owner_id = ?1 OR p.id IN (SELECT id FROM publish_requests ORDER BY COALESCE(decided_at, created_at) DESC LIMIT ${RECENT})
				ORDER BY p.status = 'open' DESC, COALESCE(p.decided_at, p.created_at) DESC, p.id DESC`
			: "SELECT p.*, m.name AS login FROM publish_requests p LEFT JOIN members m ON m.id = p.owner_id WHERE p.owner_id = ?1 ORDER BY p.created_at DESC, p.id DESC",
	).bind(me.id).all()).results ?? [];
	const out = [];
	for (const r of rows) {
		// Songs are listed with addresses for the member, and for reviewers while there is something to review.
		const mine = r.owner_id === me.id;
		const songs = mine || (reviewer && (r.status === OPEN || r.status === "approved"))
			? await Promise.all((await songsOf(env, r)).map((u) => songOut(u, origin, env, nowSeconds)))
			: undefined;
		out.push(shapeRequest(r, songs ? { songs } : {}));
	}
	return { reviewer, requests: out };
}

async function withdraw(env, me, id, nowSeconds) {
	const r = await requestRow(env, id);
	if (r.owner_id !== me.id && !can(me, "manage")) throw new LibraryError("only the member who asked, or a co-owner, withdraws a request", 403);
	if (r.status !== OPEN) throw new LibraryError(`this request is ${r.status}, not open`, 409);
	await env.DB.prepare("UPDATE publish_requests SET status = 'withdrawn', decided_at = ?1, reviewer = ?2 WHERE id = ?3").bind(nowSeconds, me.login, id).run();
	await env.DB.prepare("UPDATE uploads SET status = 'private' WHERE owner_id = ?1 AND album = ?2 AND status = 'requested'").bind(r.owner_id, r.album).run();
	return null;
}

async function reject(env, me, id, body, nowSeconds) {
	if (!can(me, "review")) throw new LibraryError("rejecting needs the Review publishing right", 403);
	const reason = cleanText(body.reason, "reason", true);
	const r = await requestRow(env, id);
	if (r.status !== OPEN) throw new LibraryError(`this request is ${r.status}, not open`, 409);
	await env.DB.prepare("UPDATE publish_requests SET status = 'rejected', reason = ?1, reviewer = ?2, decided_at = ?3 WHERE id = ?4").bind(reason, me.login, nowSeconds, id).run();
	await env.DB.prepare("UPDATE uploads SET status = 'private' WHERE owner_id = ?1 AND album = ?2 AND status = 'requested'").bind(r.owner_id, r.album).run();
	return shapeRequest({ ...r, status: "rejected", reason, reviewer: me.login, decided_at: nowSeconds });
}

/* ------------------------------------------------------------ approve ---- */

/** A catalog key for a song: music/<folder>/<file>.mp3, safe path segments only. */
export function checkCatalogKey(key) {
	if (typeof key !== "string" || !key.startsWith(CATALOG_ROOT) || !/\.mp3$/i.test(key)) throw new LibraryError(`${key} must be an .mp3 under ${CATALOG_ROOT}`);
	const parts = key.slice(CATALOG_ROOT.length).split("/");
	if (parts.length < 2 || parts.some((p) => !p || p === "." || p === ".." || p.includes("\\"))) throw new LibraryError(`${key} is not a safe catalog path`);
	return key;
}

async function approve(env, me, id, body, nowSeconds) {
	if (!can(me, "review")) throw new LibraryError("approving needs the Review publishing right", 403);
	const r = await requestRow(env, id);
	if (r.status !== OPEN) throw new LibraryError(`this request is ${r.status}, not open`, 409);
	const album = typeof body.album === "string" && /^[0-9a-f]{16}$/.test(body.album) ? body.album : null;
	if (!album) throw new LibraryError("album must be the new catalog album's id (16 hex characters)");
	const songs = await songsOf(env, r);
	const tracks = Array.isArray(body.tracks) ? body.tracks : [];
	const byUpload = new Map(tracks.map((t) => [Number(t?.upload), t]));
	// Every song of the request, once each, with a new track id and a free key; checked before anything is copied.
	if (byUpload.size !== tracks.length || tracks.length !== songs.length || songs.some((u) => !byUpload.has(u.id))) {
		throw new LibraryError(`tracks must name each of the request's ${songs.length} songs once`);
	}
	const keys = new Set();
	const ids = new Set();
	for (const u of songs) {
		const t = byUpload.get(u.id);
		const track = Number(t.track);
		if (!Number.isSafeInteger(track) || track <= 0 || ids.has(track)) throw new LibraryError(`track ids must be new positive whole numbers, one per song`);
		ids.add(track);
		const key = checkCatalogKey(t.key);
		if (keys.has(key)) throw new LibraryError(`${key} is named twice`);
		keys.add(key);
		if (await env.BUCKET.head(key)) throw new LibraryError(`${key} already exists in the catalog's storage; choose another folder`, 409);
		const taken = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM tracks WHERE id = ?1) + (SELECT COUNT(*) FROM published_tracks WHERE track_id = ?1) AS n").bind(track).first();
		if (taken.n) throw new LibraryError(`track id ${track} is already used`, 409);
	}
	const copied = [];
	try {
		for (const u of songs) {
			const t = byUpload.get(u.id);
			const src = await env.BUCKET.get(u.r2_key);
			if (!src) throw new LibraryError(`"${u.file_name}" is missing from storage`, 404);
			await env.BUCKET.put(t.key, src.body, { httpMetadata: { contentType: "audio/mpeg" } });
			copied.push(t.key);
		}
	} catch (err) {
		// All or nothing: what was copied goes again.
		for (const k of copied) await env.BUCKET.delete(k);
		throw err;
	}
	for (const u of songs) {
		const t = byUpload.get(u.id);
		await env.DB.prepare("INSERT INTO published_tracks (upload_id, request_id, owner_id, track_id, r2_key) VALUES (?1, ?2, ?3, ?4, ?5)").bind(u.id, id, r.owner_id, Number(t.track), t.key).run();
	}
	await env.DB.prepare("UPDATE uploads SET status = 'published', updated_at = ?1 WHERE owner_id = ?2 AND album = ?3 AND status = 'requested'").bind(nowSeconds, r.owner_id, r.album).run();
	await env.DB.prepare("UPDATE publish_requests SET status = 'approved', reviewer = ?1, catalog_album = ?2, decided_at = ?3 WHERE id = ?4").bind(me.login, album, nowSeconds, id).run();
	return { id, status: "approved", copied: copied.length };
}

async function recordPr(env, me, id, body) {
	if (!can(me, "review")) throw new LibraryError("needs the Review publishing right", 403);
	const url = String(body.url ?? "");
	if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(url)) throw new LibraryError("url must be a GitHub pull request address");
	const r = await requestRow(env, id);
	if (r.status !== "approved") throw new LibraryError(`this request is ${r.status}, not approved`, 409);
	await env.DB.prepare("UPDATE publish_requests SET pr_url = ?1 WHERE id = ?2").bind(url, id).run();
	return null;
}

/**
 * Approved requests whose songs the release has loaded (D1 `tracks`) are
 * released: each library row now names the catalog file, and the member's
 * uploaded copy is deleted (a file added from storage is left where it is).
 */
export async function settleReleased(env) {
	const approved = (await env.DB.prepare("SELECT id FROM publish_requests WHERE status = 'approved'").all()).results ?? [];
	for (const { id } of approved) {
		const done = await env.DB.prepare(
			"SELECT COUNT(*) AS total, SUM(CASE WHEN EXISTS (SELECT 1 FROM tracks t WHERE t.id = p.track_id) THEN 1 ELSE 0 END) AS loaded FROM published_tracks p WHERE p.request_id = ?1",
		).bind(id).first();
		if (!done.total || done.loaded !== done.total) continue;
		const rows = (await env.DB.prepare("SELECT p.upload_id, p.r2_key AS catalog_key, u.r2_key FROM published_tracks p JOIN uploads u ON u.id = p.upload_id WHERE p.request_id = ?1").bind(id).all()).results ?? [];
		for (const row of rows) {
			if (isUpload(row.r2_key)) await env.BUCKET.delete(row.r2_key);
			await env.DB.prepare("UPDATE uploads SET r2_key = ?1, status = 'released' WHERE id = ?2").bind(row.catalog_key, row.upload_id).run();
		}
		await env.DB.prepare("UPDATE publish_requests SET status = 'released' WHERE id = ?1").bind(id).run();
	}
}

/** /library/requests*: answers a Response, or null when the path is not one of these. */
export async function handleRequests(request, env, me, path, origin, cors, nowSeconds) {
	const m = request.method;
	let match;
	if (path === "/library/requests") {
		if (m === "POST") return json(201, await ask(env, me, await readJson(request), nowSeconds), cors);
		if (m === "GET") return json(200, await list(env, me, origin, nowSeconds), cors);
	}
	if ((match = /^\/library\/requests\/(\d+)$/.exec(path)) && m === "DELETE") return json(204, await withdraw(env, me, Number(match[1]), nowSeconds), cors);
	if ((match = /^\/library\/requests\/(\d+)\/(reject|approve|pr)$/.exec(path)) && m === "POST") {
		const id = Number(match[1]);
		const body = await readJson(request, 64 * 1024);
		if (match[2] === "reject") return json(200, await reject(env, me, id, body, nowSeconds), cors);
		if (match[2] === "approve") return json(200, await approve(env, me, id, body, nowSeconds), cors);
		return json(204, await recordPr(env, me, id, body), cors);
	}
	return null;
}
