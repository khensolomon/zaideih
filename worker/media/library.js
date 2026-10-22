/**
 * Personal libraries (docs/library.md): members' own uploads in R2, played
 * through signed addresses, and moderation.
 *
 * Routes (JSON, `Authorization: Bearer <GitHub sign-in token>`, CORS for AUTH_ORIGINS):
 *   GET    /library                         the member, their space and uploads (with signed addresses)
 *   POST   /library/uploads                 {fileName, size, format, duration, title, artist?, album?, year?, track?}
 *                                           -> {id, upload: "/library/uploads/<id>/file"}
 *   PUT    /library/uploads/<id>/file       the file itself (Content-Length must match)
 *   PATCH  /library/uploads/<id>            {title?, artist?, album?, year?, track?}
 *   DELETE /library/uploads/<id>            the owner, or a moderator
 *   GET    /library/members                 moderators: every member with space and uploads used
 *   GET    /library/members/<github id>     moderators: one member's uploads (titles only, no addresses)
 *   POST   /library/members/<github id>     moderators: {blocked: true, reason} | {blocked: false};
 *                                           owner only: {moderator: true|false}
 * Streaming (no sign-in; the address is the permission):
 *   GET/HEAD /u/<id>?e=<expiry>&s=<signature>
 *
 * Bindings: DB, BUCKET, GITHUB_REPO, AUTH_ORIGINS, UPLOAD_MAX_BYTES,
 * UPLOAD_QUOTA_BYTES (vars), AUDIO_SIGNING_KEY (secret), UPLOAD_LIMIT (rate limiter).
 */
import { checkDetails, checkNewUpload, cleanText, FORMATS, megabytes, UploadRuleError } from "../../src/core/upload-rules.js";
import { MemberError, memberRow, whoIs } from "./members.js";

export { checkNewUpload, FORMATS };

const SIGNED_FOR_S = 6 * 3600;
const STALE_UPLOAD_S = 3600;
const MAX_JSON = 8192;

export class LibraryError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

/* ------------------------------------------------------------ settings ---- */

function settings(env) {
	const missing = ["DB", "BUCKET", "GITHUB_REPO", "AUTH_ORIGINS", "UPLOAD_MAX_BYTES", "UPLOAD_QUOTA_BYTES", "AUDIO_SIGNING_KEY", "UPLOAD_LIMIT"].filter((k) => !env[k]);
	if (missing.length) throw new LibraryError(`personal libraries are not set up on this Worker: missing ${missing.join(", ")}`, 503);
	const maxBytes = Number(env.UPLOAD_MAX_BYTES);
	const quota = Number(env.UPLOAD_QUOTA_BYTES);
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(quota) || quota <= 0) throw new LibraryError("UPLOAD_MAX_BYTES and UPLOAD_QUOTA_BYTES must be whole numbers of bytes", 503);
	return { maxBytes, quota, origins: new Set(env.AUTH_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)) };
}

/* ------------------------------------------------------------- signing ---- */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret) {
	return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The signed streaming address of an upload: `<origin>/u/<id>?e=<expiry>&s=<signature>`. */
export async function signedUrl(origin, id, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
	const e = nowSeconds + SIGNED_FOR_S;
	const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`${id}.${e}`));
	return `${origin}/u/${id}?e=${e}&s=${b64url(sig)}`;
}

/** True when the address's signature is right and it has not expired. */
export async function verifySigned(id, e, s, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
	if (!/^\d+$/.test(e ?? "") || Number(e) < nowSeconds || !/^[A-Za-z0-9_-]{43}$/.test(s ?? "")) return false;
	let sig;
	try { sig = fromB64url(s); } catch { return false; }
	// verify() compares in constant time.
	return crypto.subtle.verify("HMAC", await hmacKey(secret), sig, new TextEncoder().encode(`${id}.${e}`));
}

/* --------------------------------------------------------- file checks ---- */

/** True when the first bytes of a file are those of the format. */
export function looksLike(format, b) {
	const text = (from, to) => String.fromCharCode(...b.slice(from, to));
	const id3 = text(0, 3) === "ID3";
	switch (format) {
		case "mp3": return id3 || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
		case "m4a": return text(4, 8) === "ftyp";
		case "flac": return text(0, 4) === "fLaC" || id3;
		case "wav": return text(0, 4) === "RIFF" && text(8, 12) === "WAVE";
		case "ogg": return text(0, 4) === "OggS";
		default: return false;
	}
}

/* ------------------------------------------------------------- answers ---- */

function json(status, body, cors) {
	const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" });
	if (cors) headers.set("Access-Control-Allow-Origin", cors);
	return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

async function readJson(request) {
	const text = await request.text();
	if (text.length > MAX_JSON) throw new LibraryError("request body too large", 413);
	try {
		const v = JSON.parse(text);
		if (v && typeof v === "object" && !Array.isArray(v)) return v;
	} catch { /* below */ }
	throw new LibraryError("body must be a JSON object");
}

const publicUpload = (r) => ({
	id: r.id, title: r.title, artist: r.artist, album: r.album, year: r.year, track: r.track_no,
	duration: r.duration, size: r.size, format: r.format, fileName: r.file_name, status: r.status, created: r.created_at,
});

/* ------------------------------------------------------------ handlers ---- */

async function uploadRow(env, id) {
	return env.DB.prepare("SELECT * FROM uploads WHERE id = ?1").bind(id).first();
}

async function usedBytes(env, ownerId) {
	const r = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS n FROM uploads WHERE owner_id = ?1").bind(ownerId).first();
	return { used: r?.used ?? 0, count: r?.n ?? 0 };
}

/** Removes uploads left half-done (a closed tab): the row, and the object if any of it arrived. */
async function dropStale(env, ownerId, nowSeconds) {
	const stale = await env.DB.prepare("SELECT id, r2_key FROM uploads WHERE owner_id = ?1 AND status = 'uploading' AND created_at < ?2").bind(ownerId, nowSeconds - STALE_UPLOAD_S).all();
	for (const r of stale.results ?? []) {
		await env.BUCKET.delete(r.r2_key);
		await env.DB.prepare("DELETE FROM uploads WHERE id = ?1").bind(r.id).run();
	}
}

async function library(env, me, cfg, origin, nowSeconds) {
	await dropStale(env, me.id, nowSeconds);
	const rows = await env.DB.prepare("SELECT * FROM uploads WHERE owner_id = ?1 AND status <> 'uploading' ORDER BY album COLLATE NOCASE, track_no, title COLLATE NOCASE").bind(me.id).all();
	const { used } = await usedBytes(env, me.id);
	const uploads = [];
	for (const r of rows.results ?? []) uploads.push({ ...publicUpload(r), url: await signedUrl(origin, r.id, env.AUDIO_SIGNING_KEY, nowSeconds) });
	return {
		member: { id: me.id, login: me.login, role: me.role, moderator: me.moderator },
		space: { used, quota: me.role === "owner" ? null : cfg.quota, maxFile: cfg.maxBytes },
		uploads,
	};
}

async function createUpload(env, me, cfg, body, nowSeconds) {
	const u = checkNewUpload(body, cfg);
	if (!(await env.UPLOAD_LIMIT.limit({ key: `upload:${me.id}` })).success) throw new LibraryError("too many uploads in a minute; wait a moment and continue", 429);
	if (me.role !== "owner") {
		const { used } = await usedBytes(env, me.id);
		if (used + u.size > cfg.quota) {
			throw new LibraryError(`"${u.fileName}" (${megabytes(u.size)}) does not fit: ${megabytes(Math.max(0, cfg.quota - used))} of your ${megabytes(cfg.quota)} is left. Delete some uploads first.`, 413);
		}
	}
	// The id comes from the row; the R2 key follows it.
	const res = await env.DB.prepare(
		`INSERT INTO uploads (owner_id, r2_key, size, format, duration, title, artist, album, year, track_no, file_name, status, created_at, updated_at)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'uploading', ?12, ?12)`,
	).bind(me.id, `pending/${me.id}/${crypto.randomUUID()}`, u.size, u.format, u.duration, u.title, u.artist, u.album, u.year, u.track_no, u.fileName, nowSeconds).run();
	const id = res.meta.last_row_id;
	const key = `users/${me.id}/${id}.${u.format}`;
	await env.DB.prepare("UPDATE uploads SET r2_key = ?1 WHERE id = ?2").bind(key, id).run();
	return { id, upload: `/library/uploads/${id}/file` };
}

async function storeFile(request, env, me, id, nowSeconds) {
	const row = await uploadRow(env, id);
	if (!row || row.owner_id !== me.id) throw new LibraryError("no such upload in your library", 404);
	if (row.status !== "uploading") throw new LibraryError("this upload already has its file", 409);
	const declared = Number(request.headers.get("content-length"));
	if (!Number.isSafeInteger(declared)) throw new LibraryError("the file's size (Content-Length) is required", 411);
	if (declared !== row.size) throw new LibraryError(`the file is ${declared} bytes, but ${row.size} were announced`, 400);
	if (!request.body) throw new LibraryError("the request has no file", 400);
	await env.BUCKET.put(row.r2_key, request.body, { httpMetadata: { contentType: FORMATS[row.format].type } });
	// Check what arrived: its size, and that it starts like the format it claims to be.
	const head = await env.BUCKET.get(row.r2_key, { range: { offset: 0, length: 16 } });
	const bytes = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
	if (!head || head.size !== row.size || !looksLike(row.format, bytes)) {
		await env.BUCKET.delete(row.r2_key);
		await env.DB.prepare("DELETE FROM uploads WHERE id = ?1").bind(id).run();
		throw new LibraryError(!head || head.size !== row.size
			? `"${row.file_name}" did not arrive whole; upload it again`
			: `"${row.file_name}" is not a ${FORMATS[row.format].name} file; it may be renamed or damaged`, 415);
	}
	await env.DB.prepare("UPDATE uploads SET status = 'private', updated_at = ?1 WHERE id = ?2").bind(nowSeconds, id).run();
	return publicUpload({ ...row, status: "private" });
}

async function editUpload(env, me, id, body, nowSeconds) {
	const row = await uploadRow(env, id);
	if (!row || row.owner_id !== me.id || row.status === "uploading") throw new LibraryError("no such upload in your library", 404);
	const d = checkDetails(body, true);
	const fields = Object.keys(d);
	if (!fields.length) throw new LibraryError("nothing to change");
	await env.DB.prepare(`UPDATE uploads SET ${fields.map((f, i) => `${f} = ?${i + 1}`).join(", ")}, updated_at = ?${fields.length + 1} WHERE id = ?${fields.length + 2}`)
		.bind(...fields.map((f) => d[f]), nowSeconds, id).run();
	return publicUpload({ ...row, ...d });
}

async function deleteUpload(env, me, id) {
	const row = await uploadRow(env, id);
	// Moderators may delete anyone's uploads except the owner's.
	const ownerOfRow = row ? await env.DB.prepare("SELECT login FROM members WHERE github_id = ?1").bind(row.owner_id).first() : null;
	const isOwnersUpload = isOwnerLogin(env, ownerOfRow?.login);
	const mine = row?.owner_id === me.id;
	if (!row || (!mine && !(me.moderator && !isOwnersUpload))) throw new LibraryError("no such upload, or not yours to delete", 404);
	await env.BUCKET.delete(row.r2_key);
	await env.DB.prepare("DELETE FROM uploads WHERE id = ?1").bind(id).run();
	return null;
}

async function listMembers(env) {
	const rows = await env.DB.prepare(
		`SELECT m.github_id, m.login, m.moderator, m.blocked_at, m.blocked_by, m.blocked_reason, m.first_seen, m.last_seen,
			COUNT(u.id) AS uploads, COALESCE(SUM(u.size), 0) AS used
		FROM members m LEFT JOIN uploads u ON u.owner_id = m.github_id
		GROUP BY m.github_id ORDER BY used DESC, m.last_seen DESC`,
	).all();
	return (rows.results ?? []).map((r) => ({
		id: r.github_id, login: r.login, moderator: r.moderator === 1, uploads: r.uploads, used: r.used,
		blocked: r.blocked_at ? { at: r.blocked_at, by: r.blocked_by, reason: r.blocked_reason ?? "" } : null,
		firstSeen: r.first_seen, lastSeen: r.last_seen,
	}));
}

const isOwnerLogin = (env, login) => login?.toLowerCase() === env.GITHUB_REPO.split("/")[0].toLowerCase();

async function memberUploads(env, gid) {
	const m = await env.DB.prepare("SELECT login FROM members WHERE github_id = ?1").bind(gid).first();
	if (!m) throw new LibraryError("no such member", 404);
	// The owner's library is the owner's alone.
	if (isOwnerLogin(env, m.login)) throw new LibraryError("the owner's library is private", 403);
	const rows = await env.DB.prepare("SELECT * FROM uploads WHERE owner_id = ?1 ORDER BY created_at DESC").bind(gid).all();
	return { login: m.login, uploads: (rows.results ?? []).map(publicUpload) };
}

async function setMember(env, me, gid, body, nowSeconds) {
	if ("moderator" in body && me.role !== "owner") throw new LibraryError("only the owner grants or removes moderator rights", 403);
	const m = await env.DB.prepare("SELECT login, moderator FROM members WHERE github_id = ?1").bind(gid).first();
	if (!m) throw new LibraryError("no such member", 404);
	if (isOwnerLogin(env, m.login)) throw new LibraryError("the owner cannot be blocked or changed", 403);
	if ("moderator" in body) {
		if (typeof body.moderator !== "boolean") throw new LibraryError("moderator must be true or false");
		await env.DB.prepare("UPDATE members SET moderator = ?1 WHERE github_id = ?2").bind(body.moderator ? 1 : 0, gid).run();
	}
	if ("blocked" in body) {
		if (typeof body.blocked !== "boolean") throw new LibraryError("blocked must be true or false");
		// Moderators answer to the owner: only the owner blocks a moderator.
		if (m.moderator === 1 && me.role !== "owner") throw new LibraryError("only the owner blocks a moderator", 403);
		if (body.blocked) {
			const reason = cleanText(body.reason, "reason", true);
			await env.DB.prepare("UPDATE members SET blocked_at = ?1, blocked_by = ?2, blocked_reason = ?3 WHERE github_id = ?4").bind(nowSeconds, me.login, reason, gid).run();
		} else {
			await env.DB.prepare("UPDATE members SET blocked_at = NULL, blocked_by = NULL, blocked_reason = NULL WHERE github_id = ?1").bind(gid).run();
		}
	}
	return (await listMembers(env)).find((x) => x.id === gid) ?? null;
}

/**
 * /library/*.
 * @param {Request} request
 */
export async function handleLibrary(request, env, { fetchImpl, now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const origin = request.headers.get("origin");
	let cfg;
	try {
		cfg = settings(env);
	} catch (err) {
		return json(err.status, { error: err.message }, null);
	}
	const cors = origin && cfg.origins.has(origin) ? origin : null;
	if (request.method === "OPTIONS") {
		if (!cors) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } });
	}
	const nowSeconds = Math.floor(now() / 1000);
	try {
		if (!cors) throw new LibraryError("this origin may not use personal libraries (AUTH_ORIGINS)", 403);
		const me = await memberRow(env, await whoIs(request, env, { fetchImpl, now }), nowSeconds);
		if (me.blocked) throw new LibraryError(`Your library is closed by ${me.blocked.by}: ${me.blocked.reason}`, 403);
		const path = url.pathname.replace(/\/+$/, "");
		const m = request.method;
		let match;
		if (path === "/library" && m === "GET") return json(200, await library(env, me, cfg, url.origin, nowSeconds), cors);
		if (path === "/library/uploads" && m === "POST") return json(201, await createUpload(env, me, cfg, await readJson(request), nowSeconds), cors);
		if ((match = /^\/library\/uploads\/(\d+)\/file$/.exec(path)) && m === "PUT") return json(200, await storeFile(request, env, me, Number(match[1]), nowSeconds), cors);
		if ((match = /^\/library\/uploads\/(\d+)$/.exec(path))) {
			if (m === "PATCH") return json(200, await editUpload(env, me, Number(match[1]), await readJson(request), nowSeconds), cors);
			if (m === "DELETE") return json(204, await deleteUpload(env, me, Number(match[1])), cors);
		}
		if (path === "/library/members" || path.startsWith("/library/members/")) {
			if (!me.moderator) throw new LibraryError("moderators only", 403);
			if (path === "/library/members" && m === "GET") return json(200, { members: await listMembers(env) }, cors);
			if ((match = /^\/library\/members\/(\d+)$/.exec(path))) {
				if (m === "GET") return json(200, await memberUploads(env, Number(match[1])), cors);
				if (m === "POST") return json(200, { member: await setMember(env, me, Number(match[1]), await readJson(request), nowSeconds) }, cors);
			}
		}
		return json(404, { error: `no route ${m} ${path}` }, cors);
	} catch (err) {
		if (err instanceof LibraryError || err instanceof MemberError || err instanceof UploadRuleError) return json(err.status, { error: err.message }, cors);
		console.error("library request failed", err);
		return json(500, { error: "the library request failed on the Worker" }, cors);
	}
}

/**
 * GET/HEAD /u/<id>?e&s: streams an upload to whoever holds a valid signed address.
 */
export async function handleSignedAudio(request, env, id) {
	const url = new URL(request.url);
	const text = (status, body) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
	if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method Not Allowed");
	if (!env.AUDIO_SIGNING_KEY || !env.DB || !env.BUCKET) return text(503, "personal libraries are not set up on this Worker");
	if (!(await verifySigned(String(id), url.searchParams.get("e"), url.searchParams.get("s"), env.AUDIO_SIGNING_KEY))) return text(403, "this address has expired or is not valid; open the library again");
	const row = await env.DB.prepare(
		"SELECT u.r2_key, u.format, u.status, m.blocked_at FROM uploads u LEFT JOIN members m ON m.github_id = u.owner_id WHERE u.id = ?1",
	).bind(id).first();
	if (!row || row.status === "uploading") return text(404, "no such upload");
	if (row.blocked_at) return text(403, "this library is closed");
	const range = request.headers.get("range");
	const m = /^bytes=(\d+)-(\d+)?$/.exec(range ?? "");
	const options = m ? { range: m[2] ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : { offset: Number(m[1]) } } : undefined;
	const object = await env.BUCKET.get(row.r2_key, options);
	if (!object) return text(404, "the file is missing");
	const headers = new Headers({
		"Content-Type": FORMATS[row.format]?.type ?? "application/octet-stream",
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, max-age=3600",
		"X-Content-Type-Options": "nosniff",
	});
	// Downloads for offline listening fetch with CORS.
	const origin = request.headers.get("origin");
	if (origin && env.AUTH_ORIGINS?.split(",").map((s) => s.trim()).includes(origin)) {
		headers.set("Access-Control-Allow-Origin", origin);
		headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type");
		headers.set("Vary", "Origin");
	}
	let status = 200;
	if (object.range && options) {
		const offset = object.range.offset ?? 0;
		const length = object.range.length ?? object.size - offset;
		headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
		headers.set("Content-Length", String(length));
		status = 206;
	} else {
		headers.set("Content-Length", String(object.size));
	}
	return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}
