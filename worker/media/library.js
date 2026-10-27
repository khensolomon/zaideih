/**
 * Personal libraries (docs/library.md): members' own uploads in R2, played
 * through signed addresses, and moderation.
 *
 * Routes (JSON, `Authorization: Bearer <Zaideih session>` (accounts.js), CORS for AUTH_ORIGINS):
 *   GET    /library                         the member, their space and uploads (with signed addresses)
 *   POST   /library/sync                    {since, changes}: liked songs and playlists on every device (sync.js)
 *   POST   /library/uploads                 {fileName, size, format, duration, title, artist?, album?, year?, track?}
 *                                           -> {id, upload: "/library/uploads/<id>/file"}
 *   PUT    /library/uploads/<id>/file       the file itself (Content-Length must match)
 *   PATCH  /library/uploads/<id>            {title?, artist?, album?, year?, track?}
 *   DELETE /library/uploads/<id>            the uploader, or `moderate`; a file added from
 *                                           storage stays in R2
 *   GET    /library/storage?prefix=<p>      `storage`: folders and audio files in R2 (the whole
 *                                           bucket but users/ for the owner and co-owners, the
 *                                           member's folder otherwise), each file with a signed
 *                                           address to read it
 *   POST   /library/storage/add             {items: [{key, title, artist?, album?, year?, track?, duration}]}
 *                                           files already in storage, added to the library without copying
 *   GET    /library/members                 any right: every member with space, uploads and rights
 *   GET    /library/members/<member id>     `moderate`: one member's uploads (titles only, no addresses)
 *   POST   /library/members/<member id>     `moderate`: {blocked: true, reason} | {blocked: false};
 *                                           `manage`: {rights: {<right>: true|false, ...}},
 *                                           {folder: "<prefix>/" | null} (where Storage adds from)
 *   /library/requests*                      asking to publish an album (requests.js)
 * Streaming (no sign-in; the address is the permission):
 *   GET/HEAD /u/<id>?e=<expiry>&s=<signature>      an upload
 *   GET/HEAD /k/<key, base64url>?e&s               a file in storage, for reading its details
 *
 * Rights (members.js): the owner (OWNER_GITHUB_ID) holds all; co-owners
 * (`manage`) hold all and give or take any of them; nobody but the owner
 * sees the owner's library, and nobody can block the owner or change the
 * owner's rights.
 *
 * Bindings: DB, BUCKET, OWNER_GITHUB_ID, AUTH_ORIGINS, UPLOAD_MAX_BYTES,
 * UPLOAD_QUOTA_BYTES (vars), AUDIO_SIGNING_KEY (secret), UPLOAD_LIMIT (rate limiter).
 */
import { checkDetails, checkNewUpload, cleanText, FORMATS, megabytes, UploadRuleError } from "../../src/core/upload-rules.js";
import { can, MemberError, memberRow, ownerId, RIGHTS, rightsOf } from "./members.js";
import { sessionMember } from "./accounts.js";
import { handleSync } from "./sync.js";
import { formatOf } from "../../src/core/upload-rules.js";
import { handleRequests, settleReleased } from "./requests.js";

export { checkNewUpload, FORMATS };

const SIGNED_FOR_S = 6 * 3600;
/*
 * Storage: files already in R2 that join a library where they are. Uploads
 * are the only files a library owns (users/<member id>/…): they count
 * towards space and are deleted with their entry. Every other file was put
 * in R2 some other way, wherever its owner keeps it, and is left alone.
 */
export const UPLOADS_ROOT = "users/";
/** A member with the Storage right and no folder set adds from here: private/<member id>/. */
export const STORAGE_DEFAULT = "private/";
export const isUpload = (key) => key.startsWith(UPLOADS_ROOT);
const MAX_ADD = 200;
const MAX_LIST = 1000;
const D1_BIND_MAX = 100;
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

/** The signed address of a file in storage, for reading its details: `<origin>/k/<key>?e&s`. */
export async function signedKeyUrl(origin, key, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
	const e = nowSeconds + SIGNED_FOR_S;
	const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`k:${key}.${e}`));
	return `${origin}/k/${b64url(new TextEncoder().encode(key))}?e=${e}&s=${b64url(sig)}`;
}

/** The storage key of a /k/ address, or null when it is not a valid key. */
export function keyOf(encoded) {
	try {
		const key = new TextDecoder("utf-8", { fatal: true }).decode(fromB64url(encoded));
		// Uploads have their own addresses (/u/), checked against their owner.
		return key && !isUpload(key) ? key : null;
	} catch {
		return null;
	}
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

export function json(status, body, cors) {
	const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" });
	if (cors) headers.set("Access-Control-Allow-Origin", cors);
	return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

export async function readJson(request, limit = MAX_JSON) {
	const text = await request.text();
	if (text.length > limit) throw new LibraryError("request body too large", 413);
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

/** Space used by uploads; files added from storage were not uploaded and use none. */
async function usedBytes(env, ownerId) {
	const r = await env.DB.prepare(`SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS n FROM uploads WHERE owner_id = ?1 AND r2_key LIKE '${UPLOADS_ROOT}%'`).bind(ownerId).first();
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
	await settleReleased(env);
	const rows = await env.DB.prepare("SELECT * FROM uploads WHERE owner_id = ?1 AND status <> 'uploading' ORDER BY album COLLATE NOCASE, track_no, title COLLATE NOCASE").bind(me.id).all();
	const { used } = await usedBytes(env, me.id);
	const uploads = [];
	for (const r of rows.results ?? []) uploads.push({ ...publicUpload(r), url: await signedUrl(origin, r.id, env.AUDIO_SIGNING_KEY, nowSeconds) });
	const requests = (await env.DB.prepare("SELECT id, album, lang, note, status, reason, reviewer, catalog_album, pr_url, created_at, decided_at FROM publish_requests WHERE owner_id = ?1 ORDER BY created_at DESC, id DESC").bind(me.id).all()).results ?? [];
	return {
		member: { id: me.id, login: me.login, role: me.role, moderator: me.moderator, rights: [...me.rights], storageRoot: storageRootOf(me) },
		space: { used, quota: me.role === "owner" ? null : cfg.quota, maxFile: cfg.maxBytes },
		uploads,
		requests: requests.map((q) => ({ id: q.id, album: q.album, lang: q.lang, note: q.note, status: q.status, reason: q.reason, reviewer: q.reviewer, catalogAlbum: q.catalog_album, pr: q.pr_url, created: q.created_at, decided: q.decided_at })),
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
	if (row.status === "requested") throw new LibraryError(`"${row.title}" is waiting for review; withdraw the request to change it`, 409);
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
	const isOwnersUpload = row ? row.owner_id === (await ownerId(env)) : false;
	const mine = row?.owner_id === me.id;
	if (!row || (!mine && !(can(me, "moderate") && !isOwnersUpload))) throw new LibraryError("no such upload, or not yours to delete", 404);
	if (row.status === "requested") throw new LibraryError(`"${row.title}" is waiting for review; withdraw the request first`, 409);
	// A published song is in the catalog: its library entry stays, so the member stays credited with it.
	if ((row.status === "published" || row.status === "released") && !can(me, "manage")) {
		throw new LibraryError(`"${row.title}" is published in the catalog; a song is removed from the catalog by the owner, on request`, 409);
	}
	// A file added from storage was put there by hand and stays; only uploads are deleted.
	if (isUpload(row.r2_key)) await env.BUCKET.delete(row.r2_key);
	await env.DB.prepare("DELETE FROM uploads WHERE id = ?1").bind(id).run();
	return null;
}

async function listMembers(env) {
	const rows = await env.DB.prepare(
		`SELECT m.id, m.name, m.blocked_at, m.blocked_by, m.blocked_reason, m.first_seen, m.last_seen,
			COUNT(u.id) AS uploads, COALESCE(SUM(CASE WHEN u.r2_key LIKE '${UPLOADS_ROOT}%' THEN u.size ELSE 0 END), 0) AS used
		FROM members m LEFT JOIN uploads u ON u.owner_id = m.id
		GROUP BY m.id ORDER BY used DESC, m.last_seen DESC`,
	).all();
	const rights = await rightsOf(env);
	const folders = new Map(((await env.DB.prepare("SELECT member_id, prefix FROM member_folders").all()).results ?? []).map((f) => [f.member_id, f.prefix]));
	const owner = await ownerId(env);
	return (rows.results ?? []).map((r) => ({
		id: r.id, login: r.name, owner: r.id === owner,
		folder: folders.get(r.id) ?? `${STORAGE_DEFAULT}${r.id}/`,
		rights: r.id === owner ? Object.keys(RIGHTS) : [...(rights.get(r.id) ?? [])],
		uploads: r.uploads, used: r.used,
		blocked: r.blocked_at ? { at: r.blocked_at, by: r.blocked_by, reason: r.blocked_reason ?? "" } : null,
		firstSeen: r.first_seen, lastSeen: r.last_seen,
	}));
}


async function memberUploads(env, memberId) {
	const m = await env.DB.prepare("SELECT id, name FROM members WHERE id = ?1").bind(memberId).first();
	if (!m) throw new LibraryError("no such member", 404);
	// The owner's library is the owner's alone.
	if (m.id === (await ownerId(env))) throw new LibraryError("the owner's library is private", 403);
	const rows = await env.DB.prepare("SELECT * FROM uploads WHERE owner_id = ?1 ORDER BY created_at DESC, id DESC").bind(memberId).all();
	return { login: m.name, uploads: (rows.results ?? []).map(publicUpload) };
}

async function setMember(env, me, memberId, body, nowSeconds) {
	if (("rights" in body || "folder" in body) && !can(me, "manage")) throw new LibraryError("only the owner and co-owners give or take rights", 403);
	if ("blocked" in body && !can(me, "moderate")) throw new LibraryError("blocking needs the Moderate members right", 403);
	const m = await env.DB.prepare("SELECT id, name FROM members WHERE id = ?1").bind(memberId).first();
	if (!m) throw new LibraryError("no such member", 404);
	if (m.id === (await ownerId(env))) throw new LibraryError("the owner cannot be blocked or changed", 403);
	const held = (await rightsOf(env, memberId)).get(memberId) ?? new Set();
	if ("rights" in body) {
		const change = body.rights;
		if (!change || typeof change !== "object" || Array.isArray(change)) throw new LibraryError("rights must be an object of right: true or false");
		for (const [kind, on] of Object.entries(change)) {
			if (!RIGHTS[kind]) throw new LibraryError(`unknown right "${kind}"; rights are ${Object.keys(RIGHTS).join(", ")}`);
			if (typeof on !== "boolean") throw new LibraryError(`${kind} must be true or false`);
		}
		for (const [kind, on] of Object.entries(change)) {
			if (on) {
				await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING").bind(memberId, kind, me.login, nowSeconds).run();
			} else {
				await env.DB.prepare("DELETE FROM member_rights WHERE member_id = ?1 AND kind = ?2").bind(memberId, kind).run();
				// The flag from before rights existed goes with Moderate members.
				if (kind === "moderate") await env.DB.prepare("UPDATE members SET moderator = 0 WHERE id = ?1").bind(memberId).run();
			}
		}
	}
	if ("folder" in body) {
		if (body.folder === null || body.folder === "") {
			await env.DB.prepare("DELETE FROM member_folders WHERE member_id = ?1").bind(memberId).run();
		} else {
			const folder = checkFolder(body.folder);
			if (folder === "") throw new LibraryError("a member's folder cannot be the whole bucket; make them a co-owner instead");
			await env.DB.prepare("INSERT INTO member_folders (member_id, prefix, set_by, set_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(member_id) DO UPDATE SET prefix = ?2, set_by = ?3, set_at = ?4")
				.bind(memberId, folder, me.login, nowSeconds).run();
		}
	}
	if ("blocked" in body) {
		if (typeof body.blocked !== "boolean") throw new LibraryError("blocked must be true or false");
		// Whoever holds a right answers to the owner and co-owners: only they block such a member.
		if (held.size && !can(me, "manage")) throw new LibraryError("only the owner and co-owners block a member who holds rights", 403);
		if (body.blocked) {
			const reason = cleanText(body.reason, "reason", true);
			await env.DB.prepare("UPDATE members SET blocked_at = ?1, blocked_by = ?2, blocked_reason = ?3 WHERE id = ?4").bind(nowSeconds, me.login, reason, memberId).run();
		} else {
			await env.DB.prepare("UPDATE members SET blocked_at = NULL, blocked_by = NULL, blocked_reason = NULL WHERE id = ?1").bind(memberId).run();
		}
	}
	return (await listMembers(env)).find((x) => x.id === memberId) ?? null;
}

/* ------------------------------------------------------------- storage ---- */

/**
 * Where in R2 a person may add files from: the whole bucket ("") for the
 * owner and co-owners, the folder the owner set for a member with the
 * Storage right (private/<member id>/ until one is set), or null.
 */
export function storageRootOf(me) {
	if (can(me, "manage")) return "";
	if (me.rights.has("storage")) return me.folder ?? `${STORAGE_DEFAULT}${me.id}/`;
	return null;
}

/** A folder as R2 names it ("" for the top, otherwise ending with "/"), never inside users/; or throws. */
export function checkFolder(prefix) {
	if (typeof prefix !== "string") throw new LibraryError("a folder is text ending with /");
	const p = prefix.replace(/^\/+/, "");
	if (p === "") return "";
	const parts = p.split("/");
	if (!p.endsWith("/") || parts.some((part, i) => part === "." || part === ".." || (part === "" && i < parts.length - 1))) {
		throw new LibraryError(`"${prefix}" is not a folder: one name or more, each followed by /, without . or ..`);
	}
	if (isUpload(p) || p === UPLOADS_ROOT.slice(0, -1)) throw new LibraryError(`${UPLOADS_ROOT} holds members' uploads, which are theirs alone`, 403);
	return p;
}

/** A folder inside the person's storage root, or throws. */
function storagePrefix(me, prefix) {
	const root = storageRootOf(me);
	if (root === null) throw new LibraryError("adding from storage needs the Storage right", 403);
	const p = checkFolder(prefix ?? root);
	if (!p.startsWith(root)) throw new LibraryError(root ? `your storage is ${root}` : "outside storage", 403);
	return p;
}

async function listStorage(env, me, prefix, cursor, origin, nowSeconds) {
	const p = storagePrefix(me, prefix);
	const listed = await env.BUCKET.list({ prefix: p, delimiter: "/", limit: MAX_LIST, ...(cursor ? { cursor } : {}) });
	// Members' uploads are theirs alone: users/ is never shown.
	listed.delimitedPrefixes = (listed.delimitedPrefixes ?? []).filter((f) => !isUpload(f));
	const audio = listed.objects.filter((o) => formatOf(o.key));
	const known = new Set();
	// Published in place: the file is a catalog song's own (docs/library.md), so it must stay where it is.
	const catalog = new Set();
	// D1 binds at most 100 values a query: the keys are looked up a hundred at a time.
	for (let i = 0; i < audio.length; i += D1_BIND_MAX) {
		const keys = audio.slice(i, i + D1_BIND_MAX).map((o) => o.key);
		const marks = keys.map(() => "?").join(",");
		const rows = await env.DB.prepare(`SELECT r2_key FROM uploads WHERE r2_key IN (${marks})`).bind(...keys).all();
		for (const r of rows.results ?? []) known.add(r.r2_key);
		const published = await env.DB.prepare(`SELECT r2_key FROM published_tracks WHERE r2_key IN (${marks})`).bind(...keys).all();
		for (const r of published.results ?? []) catalog.add(r.r2_key);
	}
	const files = [];
	for (const o of audio) {
		files.push({ key: o.key, name: o.key.slice(p.length), size: o.size, format: formatOf(o.key), added: known.has(o.key), catalog: catalog.has(o.key), url: await signedKeyUrl(origin, o.key, env.AUDIO_SIGNING_KEY, nowSeconds) });
	}
	return {
		root: storageRootOf(me), prefix: p,
		folders: (listed.delimitedPrefixes ?? []).map((f) => ({ prefix: f, name: f.slice(p.length, -1) })),
		files, others: listed.objects.length - audio.length,
		cursor: listed.truncated ? listed.cursor : null,
	};
}

async function addFromStorage(env, me, body, nowSeconds) {
	const items = body.items;
	if (!Array.isArray(items) || !items.length || items.length > MAX_ADD) throw new LibraryError(`items must list 1 to ${MAX_ADD} files`);
	const root = storageRootOf(me);
	if (root === null) throw new LibraryError("adding from storage needs the Storage right", 403);
	if (!(await env.UPLOAD_LIMIT.limit({ key: `upload:${me.id}` })).success) throw new LibraryError("too many additions in a minute; wait a moment and continue", 429);
	// Everything is checked before anything is added, so a refused list adds nothing.
	const checked = [];
	for (const item of items) {
		const key = String(item?.key ?? "");
		const name = key.split("/").pop();
		if (!key || !key.startsWith(root) || isUpload(key)) throw new LibraryError(`${key} is outside your storage${root ? ` (${root})` : ""}`, 403);
		const format = formatOf(key);
		if (!format) throw new LibraryError(`"${name}" is not a supported format. Add MP3, M4A (AAC), FLAC, WAV or Ogg.`, 415);
		const head = await env.BUCKET.head(key);
		if (!head) throw new LibraryError(`${key} is not in storage`, 404);
		const duration = Number(item.duration);
		if (!Number.isFinite(duration) || duration < 1 || duration > 6 * 3600) throw new LibraryError(`"${name}" has no readable length; it may not be audio, or it is damaged`);
		const exists = await env.DB.prepare("SELECT owner_id FROM uploads WHERE r2_key = ?1").bind(key).first();
		if (exists) throw new LibraryError(`"${name}" is already in ${exists.owner_id === me.id ? "your" : "another"} library`, 409);
		checked.push({ key, name, format, size: head.size, duration: Math.round(duration), d: checkDetails(item) });
	}
	const added = [];
	for (const c of checked) {
		const res = await env.DB.prepare(
			`INSERT INTO uploads (owner_id, r2_key, size, format, duration, title, artist, album, year, track_no, file_name, status, created_at, updated_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'private', ?12, ?12)`,
		).bind(me.id, c.key, c.size, c.format, c.duration, c.d.title, c.d.artist, c.d.album, c.d.year, c.d.track_no, c.name, nowSeconds).run();
		added.push(res.meta.last_row_id);
	}
	return { added };
}

/**
 * /library/*.
 * @param {Request} request
 */
export async function handleLibrary(request, env, { now = () => Date.now() } = {}) {
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
		const memberId = await sessionMember(env, request, nowSeconds);
		const path0 = url.pathname.replace(/\/+$/, "");
		// Syncing the library needs only the member and the block, which keeps it within the Free plan's queries per request.
		if (path0 === "/library/sync" && request.method === "POST") {
			const b = await env.DB.prepare("SELECT blocked_at, blocked_by, blocked_reason FROM members WHERE id = ?1").bind(memberId).first();
			if (b?.blocked_at) throw new LibraryError(`Your library is closed by ${b.blocked_by}: ${b.blocked_reason}`, 403);
			return json(200, await handleSync(env, memberId, await readJson(request, 512 * 1024), now()), cors);
		}
		const me = await memberRow(env, memberId, nowSeconds);
		if (me.blocked) throw new LibraryError(`Your library is closed by ${me.blocked.by}: ${me.blocked.reason}`, 403);
		const path = url.pathname.replace(/\/+$/, "");
		const m = request.method;
		let match;
		if (path === "/library" && m === "GET") return json(200, await library(env, me, cfg, url.origin, nowSeconds), cors);
		if (path === "/library/requests" || path.startsWith("/library/requests/")) {
			const answer = await handleRequests(request, env, me, path, url.origin, cors, nowSeconds);
			if (answer) return answer;
		}
		if (path === "/library/uploads" && m === "POST") return json(201, await createUpload(env, me, cfg, await readJson(request), nowSeconds), cors);
		if (path === "/library/storage" && m === "GET") return json(200, await listStorage(env, me, url.searchParams.get("prefix"), url.searchParams.get("cursor"), url.origin, nowSeconds), cors);
		if (path === "/library/storage/add" && m === "POST") return json(201, await addFromStorage(env, me, await readJson(request, 256 * 1024), nowSeconds), cors);
		if ((match = /^\/library\/uploads\/(\d+)\/file$/.exec(path)) && m === "PUT") return json(200, await storeFile(request, env, me, Number(match[1]), nowSeconds), cors);
		if ((match = /^\/library\/uploads\/(\d+)$/.exec(path))) {
			if (m === "PATCH") return json(200, await editUpload(env, me, Number(match[1]), await readJson(request), nowSeconds), cors);
			if (m === "DELETE") return json(204, await deleteUpload(env, me, Number(match[1])), cors);
		}
		if (path === "/library/members" || path.startsWith("/library/members/")) {
			if (!me.rights.size) throw new LibraryError("members are listed for those the owner has given a right", 403);
			if (path === "/library/members" && m === "GET") return json(200, { members: await listMembers(env) }, cors);
			if ((match = /^\/library\/members\/(\d+)$/.exec(path))) {
				if (m === "GET") {
					if (!can(me, "moderate")) throw new LibraryError("a member's uploads are listed for Moderate members", 403);
					return json(200, await memberUploads(env, Number(match[1])), cors);
				}
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
		"SELECT u.r2_key, u.format, u.status, m.blocked_at FROM uploads u LEFT JOIN members m ON m.id = u.owner_id WHERE u.id = ?1",
	).bind(id).first();
	if (!row || row.status === "uploading") return text(404, "no such upload");
	if (row.blocked_at) return text(403, "this library is closed");
	return streamObject(request, env, row.r2_key, row.format);
}

/**
 * GET/HEAD /k/<key>?e&s: a file in storage, for the app to read its tags
 * and length before adding it (see listStorage). The address is the
 * permission, and only private/ can be named.
 */
export async function handleSignedKey(request, env, encoded) {
	const url = new URL(request.url);
	const text = (status, body) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
	const origin = request.headers.get("origin");
	const allowed = origin && env.AUTH_ORIGINS?.split(",").map((s) => s.trim()).includes(origin) ? origin : null;
	if (request.method === "OPTIONS") {
		if (!allowed) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Range", "Access-Control-Max-Age": "86400", Vary: "Origin" } });
	}
	if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method Not Allowed");
	if (!env.AUDIO_SIGNING_KEY || !env.BUCKET) return text(503, "personal libraries are not set up on this Worker");
	const key = keyOf(encoded);
	if (!key) return text(404, "no such file");
	if (!(await verifySigned(`k:${key}`, url.searchParams.get("e"), url.searchParams.get("s"), env.AUDIO_SIGNING_KEY))) return text(403, "this address has expired or is not valid; open the folder again");
	const format = formatOf(key);
	if (!format) return text(415, "not an audio file");
	return streamObject(request, env, key, format);
}

/** An R2 object as an HTTP answer, with ranges, and CORS for the app's origins. */
async function streamObject(request, env, key, format) {
	const text = (status, body) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
	const range = request.headers.get("range");
	const m = /^bytes=(\d+)-(\d+)?$/.exec(range ?? "");
	const options = m ? { range: m[2] ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : { offset: Number(m[1]) } } : undefined;
	const object = await env.BUCKET.get(key, options);
	if (!object) return text(404, "the file is missing");
	const headers = new Headers({
		"Content-Type": FORMATS[format]?.type ?? "application/octet-stream",
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, max-age=3600",
		"X-Content-Type-Options": "nosniff",
	});
	// The app reads with CORS: downloads for offline listening, and tags before adding from storage.
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
