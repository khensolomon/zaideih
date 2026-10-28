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
 *   GET    /library/members?q&filter&sort&offset&limit
 *                                           any right: a page of members (members-admin.js)
 *   GET    /library/members/<member id>     any right: a member's page (rights, sign-ins, history)
 *   GET    /library/members/<id>/uploads?q&offset&limit
 *                                           `moderate`: a member's uploads (titles only, no addresses)
 *   POST   /library/members/<id>/uploads/delete {ids}
 *                                           `moderate`: several of them at once
 *   POST   /library/members/<member id>     `moderate`: {blocked: true, reason} | {blocked: false} |
 *                                           {signOut: true} (every session ends);
 *                                           `manage`: {rights: {<right>: true|false, ...}},
 *                                           {folder: "<prefix>/" | null} (where Storage adds from);
 *                                           each change kept in member_log
 *   /library/requests*                      asking to publish an album (requests.js)
 *   /library/shares*                        sharing an album, or all of a library, with members (shares.js)
 * Streaming (no sign-in; the address is the permission):
 *   GET/HEAD /u/<id>?e=<expiry>&s=<signature>      an upload, for its owner
 *   GET/HEAD /u/<id>?e&m=<member>&s                an upload shared with that member: the share
 *                                                  is checked on every request
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
import { allowedOrigins, corsOf, HttpError } from "./http.js";
import { checkDetails, checkNewUpload, cleanText, FORMATS, megabytes, UploadRuleError } from "../../src/core/upload-rules.js";
import { can, MemberError, memberRow, ownerId, RIGHTS, rightsOf } from "./members.js";
import { listPage, logStatement, memberPage, memberSummary, uploadsPage } from "./members-admin.js";
import { sessionMember } from "./accounts.js";
import { handleSync } from "./sync.js";
import { formatOf } from "../../src/core/upload-rules.js";
import { handleRequests } from "./requests.js";
import { followRename, handleShares, mayHear, sharedWith, sharesOf, sharesWith } from "./shares.js";

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

export class LibraryError extends HttpError {}

/* ------------------------------------------------------------ settings ---- */

function settings(env) {
	const missing = ["DB", "BUCKET", "GITHUB_REPO", "AUTH_ORIGINS", "UPLOAD_MAX_BYTES", "UPLOAD_QUOTA_BYTES", "AUDIO_SIGNING_KEY", "UPLOAD_LIMIT"].filter((k) => !env[k]);
	if (missing.length) throw new LibraryError(`personal libraries are not set up on this Worker: missing ${missing.join(", ")}`, 503);
	const maxBytes = Number(env.UPLOAD_MAX_BYTES);
	const quota = Number(env.UPLOAD_QUOTA_BYTES);
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(quota) || quota <= 0) throw new LibraryError("UPLOAD_MAX_BYTES and UPLOAD_QUOTA_BYTES must be whole numbers of bytes", 503);
	return { maxBytes, quota, origins: allowedOrigins(env) };
}

/* ------------------------------------------------------------- signing ---- */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// The key is imported once per secret and isolate: a library lists hundreds of addresses,
// each signed, and importing the key cost three times the signing.
let hmac = { secret: null, key: null };
async function hmacKey(secret) {
	if (hmac.secret !== secret) hmac = { secret, key: await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) };
	return hmac.key;
}

/** What a streaming address signs: the upload, the expiry, and the member it is for when shared. */
const signedText = (id, e, member) => (member ? `${id}.${e}.m${member}` : `${id}.${e}`);

/**
 * The signed streaming address of an upload: `<origin>/u/<id>?e=<expiry>&s=<signature>`
 * for its owner, `…?e&m=<member>&s` for a member it is shared with.
 */
export async function signedUrl(origin, id, secret, nowSeconds = Math.floor(Date.now() / 1000), member = null) {
	const e = nowSeconds + SIGNED_FOR_S;
	const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(signedText(id, e, member)));
	return `${origin}/u/${id}?e=${e}${member ? `&m=${member}` : ""}&s=${b64url(sig)}`;
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

/** True when the address's signature is right and it has not expired (`member`: an address for a share). */
export async function verifySigned(id, e, s, secret, nowSeconds = Math.floor(Date.now() / 1000), member = null) {
	if (!/^\d+$/.test(e ?? "") || Number(e) < nowSeconds || !/^[A-Za-z0-9_-]{43}$/.test(s ?? "")) return false;
	let sig;
	try { sig = fromB64url(s); } catch { return false; }
	// verify() compares in constant time.
	return crypto.subtle.verify("HMAC", await hmacKey(secret), sig, new TextEncoder().encode(signedText(id, e, member)));
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
	// Half-done uploads of an hour ago go (their rows would count as space) before the library is read.
	await dropStale(env, me.id, nowSeconds);
	const rows = await env.DB.prepare("SELECT * FROM uploads WHERE owner_id = ?1 AND status <> 'uploading' ORDER BY album COLLATE NOCASE, track_no, title COLLATE NOCASE").bind(me.id).all();
	const { used } = await usedBytes(env, me.id);
	const uploads = [];
	for (const r of rows.results ?? []) uploads.push({ ...publicUpload(r), url: await signedUrl(origin, r.id, env.AUDIO_SIGNING_KEY, nowSeconds) });
	const requests = (await env.DB.prepare("SELECT id, album, lang, note, status, reason, reviewer, catalog_album, pr_url, created_at, decided_at FROM publish_requests WHERE owner_id = ?1 ORDER BY created_at DESC, id DESC").bind(me.id).all()).results ?? [];
	// Shared with this member by others: each song with an address that names them (checked on every play).
	const shared = [];
	for (const r of await sharedWith(env, me.id)) {
		shared.push({ ...publicUpload(r), url: await signedUrl(origin, r.id, env.AUDIO_SIGNING_KEY, nowSeconds, me.id), owner: { id: r.owner_id, name: r.owner_name }, listenOnly: Boolean(r.listen_only) });
	}
	return {
		member: { id: me.id, login: me.login, role: me.role, moderator: me.moderator, rights: [...me.rights], storageRoot: storageRootOf(me) },
		space: { used, quota: me.role === "owner" ? null : cfg.quota, maxFile: cfg.maxBytes },
		uploads,
		shared,
		shares: await sharesOf(env, me.id, nowSeconds),
		received: await sharesWith(env, me.id),
		requests: requests.map((q) => ({ id: q.id, album: q.album, lang: q.lang, note: q.note, status: q.status, reason: q.reason, reviewer: q.reviewer, catalogAlbum: q.catalog_album, pr: q.pr_url, created: q.created_at, decided: q.decided_at })),
	};
}

async function createUpload(env, me, cfg, body, nowSeconds) {
	const u = checkNewUpload(body, cfg);
	if (!(await env.UPLOAD_LIMIT.limit({ key: `upload:${me.id}` })).success) throw new LibraryError("too many uploads in a minute; wait a moment and continue", 429);
	// The space is checked in the statement that takes it (uploads sent together cannot pass it
	// one by one): the row is made only while the quota holds. The id comes from the row; the R2 key
	// follows it, set in the same batch.
	const quota = me.role === "owner" ? null : cfg.quota;
	const [res] = await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO uploads (owner_id, r2_key, size, format, duration, title, artist, album, year, track_no, file_name, status, created_at, updated_at)
			SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'uploading', ?12, ?12
			WHERE ?13 IS NULL OR (SELECT COALESCE(SUM(size), 0) FROM uploads WHERE owner_id = ?1 AND r2_key LIKE '${UPLOADS_ROOT}%') + ?3 <= ?13`,
		).bind(me.id, `pending/${me.id}/${crypto.randomUUID()}`, u.size, u.format, u.duration, u.title, u.artist, u.album, u.year, u.track_no, u.fileName, nowSeconds, quota),
		env.DB.prepare(`UPDATE uploads SET r2_key = 'users/' || owner_id || '/' || id || '.' || format WHERE owner_id = ?1 AND status = 'uploading' AND r2_key LIKE 'pending/%'`).bind(me.id),
	]);
	if (!res.meta?.changes) {
		const { used } = await usedBytes(env, me.id);
		throw new LibraryError(`"${u.fileName}" (${megabytes(u.size)}) does not fit: ${megabytes(Math.max(0, cfg.quota - used))} of your ${megabytes(cfg.quota)} is left. Delete some uploads first.`, 413);
	}
	const id = res.meta.last_row_id;
	return { id, upload: `/library/uploads/${id}/file` };
}

async function storeFile(request, env, me, id, nowSeconds) {
	const row = await uploadRow(env, id);
	if (!row || row.owner_id !== me.id) throw new LibraryError("no such upload in your library", 404);
	if (row.status !== "uploading") {
		// Sent again after the answer was lost: the file is there and whole, the same answer.
		const have = await env.BUCKET.head(row.r2_key);
		if (have && have.size === row.size && Number(request.headers.get("content-length")) === row.size) {
			await request.body?.cancel().catch(() => {});
			return publicUpload(row);
		}
		throw new LibraryError("this upload already has its file", 409);
	}
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
	// An album renamed (its last song with the old name): its shares follow it.
	if ("album" in d && (d.album ?? "") !== (row.album ?? "")) await followRename(env, me.id, row.album, d.album);
	return publicUpload({ ...row, ...d });
}

async function deleteUpload(env, me, id, nowSeconds = Math.floor(Date.now() / 1000), { log = true } = {}) {
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
	// Deleting another member's upload is moderation, kept in their history.
	if (!mine && log) await logStatement(env, row.owner_id, "uploads-deleted", { count: 1, titles: [row.title] }, me.login, nowSeconds).run();
	return row;
}

const MAX_DELETE = 100;

/**
 * POST /library/members/<id>/uploads/delete {ids}: several of a member's
 * uploads at once, each as DELETE /library/uploads/<id> would (a published
 * or requested one is refused, with why). { deleted: [id], refused: [{ id, error }] }.
 */
async function deleteMemberUploads(env, me, memberId, body, nowSeconds) {
	if (!can(me, "moderate")) throw new LibraryError("deleting a member's uploads needs the Moderate members right", 403);
	const ids = body.ids;
	if (!Array.isArray(ids) || !ids.length || ids.length > MAX_DELETE || !ids.every((x) => Number.isSafeInteger(x) && x > 0)) throw new LibraryError(`ids must list 1 to ${MAX_DELETE} upload ids`);
	const wanted = [...new Set(ids)];
	// One query for the rows, one batch for the deletes and the log: within D1's queries per request.
	// At most 100 ids: D1 binds 100 values a statement.
	const rows = new Map(((await env.DB.prepare(`SELECT id, owner_id, r2_key, title, status FROM uploads WHERE id IN (${wanted.map((_, i) => `?${i + 1}`).join(", ")})`)
		.bind(...wanted).all()).results ?? []).filter((r) => r.owner_id === memberId).map((r) => [r.id, r]));
	const deleted = [];
	const refused = [];
	for (const id of wanted) {
		const row = rows.get(id);
		if (!row) refused.push({ id, error: "not one of this member's uploads" });
		else if (row.status === "requested") refused.push({ id, error: `"${row.title}" is waiting for review; withdraw the request first` });
		else if ((row.status === "published" || row.status === "released") && !can(me, "manage")) refused.push({ id, error: `"${row.title}" is published in the catalog; a song is removed from the catalog by the owner, on request` });
		else deleted.push(row);
	}
	if (!deleted.length) return { deleted: [], refused };
	await env.DB.batch([
		env.DB.prepare(`DELETE FROM uploads WHERE id IN (${deleted.map((_, i) => `?${i + 1}`).join(", ")})`).bind(...deleted.map((r) => r.id)),
		...(memberId !== me.id ? [logStatement(env, memberId, "uploads-deleted", { count: deleted.length, titles: deleted.slice(0, 20).map((r) => r.title) }, me.login, nowSeconds)] : []),
	]);
	// A file added from storage was put there by hand and stays; only uploads are deleted.
	const files = deleted.map((r) => r.r2_key).filter(isUpload);
	if (files.length) await env.BUCKET.delete(files);
	return { deleted: deleted.map((r) => r.id), refused };
}

async function setMember(env, me, memberId, body, nowSeconds) {
	if (("rights" in body || "folder" in body) && !can(me, "manage")) throw new LibraryError("only the owner and co-owners give or take rights", 403);
	if (("blocked" in body || "signOut" in body) && !can(me, "moderate")) throw new LibraryError(`${"blocked" in body ? "blocking" : "signing a member out"} needs the Moderate members right`, 403);
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
			// Only a change is logged: giving a right already held, or taking one not held, does nothing.
			if (on === held.has(kind)) continue;
			if (on) {
				await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING").bind(memberId, kind, me.login, nowSeconds).run();
			} else {
				await env.DB.prepare("DELETE FROM member_rights WHERE member_id = ?1 AND kind = ?2").bind(memberId, kind).run();
				// The flag from before rights existed goes with Moderate members.
				if (kind === "moderate") await env.DB.prepare("UPDATE members SET moderator = 0 WHERE id = ?1").bind(memberId).run();
			}
			await logStatement(env, memberId, on ? "right-given" : "right-taken", { right: kind }, me.login, nowSeconds).run();
		}
	}
	if ("folder" in body) {
		if (body.folder === null || body.folder === "") {
			await env.DB.prepare("DELETE FROM member_folders WHERE member_id = ?1").bind(memberId).run();
			await logStatement(env, memberId, "folder", { folder: null }, me.login, nowSeconds).run();
		} else {
			const folder = checkFolder(body.folder);
			if (folder === "") throw new LibraryError("a member's folder cannot be the whole bucket; make them a co-owner instead");
			await env.DB.prepare("INSERT INTO member_folders (member_id, prefix, set_by, set_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(member_id) DO UPDATE SET prefix = ?2, set_by = ?3, set_at = ?4")
				.bind(memberId, folder, me.login, nowSeconds).run();
			await logStatement(env, memberId, "folder", { folder }, me.login, nowSeconds).run();
		}
	}
	if ("blocked" in body) {
		if (typeof body.blocked !== "boolean") throw new LibraryError("blocked must be true or false");
		// Whoever holds a right answers to the owner and co-owners: only they block such a member.
		if (held.size && !can(me, "manage")) throw new LibraryError("only the owner and co-owners block a member who holds rights", 403);
		if (body.blocked) {
			const reason = cleanText(body.reason, "reason", true);
			await env.DB.prepare("UPDATE members SET blocked_at = ?1, blocked_by = ?2, blocked_reason = ?3 WHERE id = ?4").bind(nowSeconds, me.login, reason, memberId).run();
			await logStatement(env, memberId, "blocked", { reason }, me.login, nowSeconds).run();
		} else {
			await env.DB.prepare("UPDATE members SET blocked_at = NULL, blocked_by = NULL, blocked_reason = NULL WHERE id = ?1").bind(memberId).run();
			await logStatement(env, memberId, "unblocked", {}, me.login, nowSeconds).run();
		}
	}
	if ("signOut" in body) {
		if (body.signOut !== true) throw new LibraryError("signOut must be true");
		// As with blocking: a member who holds rights answers to the owner and co-owners.
		if (held.size && !can(me, "manage")) throw new LibraryError("only the owner and co-owners sign out a member who holds rights", 403);
		const { meta } = await env.DB.prepare("DELETE FROM member_sessions WHERE member_id = ?1").bind(memberId).run();
		await logStatement(env, memberId, "signed-out", { sessions: meta?.changes ?? 0 }, me.login, nowSeconds).run();
	}
	return memberSummary(env, memberId);
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
		checked.push({ key, name, format, size: head.size, duration: Math.round(duration), d: checkDetails(item) });
	}
	// Files already in a library: one query a hundred keys (D1's bind limit), not one a file.
	const keys = checked.map((c) => c.key);
	for (let i = 0; i < keys.length; i += 100) {
		const part = keys.slice(i, i + 100);
		const exists = await env.DB.prepare(`SELECT r2_key, owner_id FROM uploads WHERE r2_key IN (${part.map((_, k) => `?${k + 1}`).join(", ")})`).bind(...part).first();
		if (exists) throw new LibraryError(`"${exists.r2_key.split("/").pop()}" is already in ${exists.owner_id === me.id ? "your" : "another"} library`, 409);
	}
	// All in one batch: every file is added, or (another adding one meanwhile) none.
	const results = await env.DB.batch(checked.map((c) => env.DB.prepare(
		`INSERT INTO uploads (owner_id, r2_key, size, format, duration, title, artist, album, year, track_no, file_name, status, created_at, updated_at)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'private', ?12, ?12)`,
	).bind(me.id, c.key, c.size, c.format, c.duration, c.d.title, c.d.artist, c.d.album, c.d.year, c.d.track_no, c.name, nowSeconds)));
	return { added: results.map((r) => r.meta.last_row_id) };
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
		// Syncing the library needs only the member and the block: one query, not the member's whole row and rights.
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
		if (path === "/library/shares" || path.startsWith("/library/shares/")) {
			const answer = await handleShares(request, env, me, path, url, readJson, nowSeconds);
			if (answer) return json(answer[0], answer[1], cors);
		}
		if (path === "/library/uploads" && m === "POST") return json(201, await createUpload(env, me, cfg, await readJson(request), nowSeconds), cors);
		if (path === "/library/storage" && m === "GET") return json(200, await listStorage(env, me, url.searchParams.get("prefix"), url.searchParams.get("cursor"), url.origin, nowSeconds), cors);
		if (path === "/library/storage/add" && m === "POST") return json(201, await addFromStorage(env, me, await readJson(request, 256 * 1024), nowSeconds), cors);
		if ((match = /^\/library\/uploads\/(\d+)\/file$/.exec(path)) && m === "PUT") return json(200, await storeFile(request, env, me, Number(match[1]), nowSeconds), cors);
		if ((match = /^\/library\/uploads\/(\d+)$/.exec(path))) {
			if (m === "PATCH") return json(200, await editUpload(env, me, Number(match[1]), await readJson(request), nowSeconds), cors);
			if (m === "DELETE") { await deleteUpload(env, me, Number(match[1]), nowSeconds); return json(204, null, cors); }
		}
		if (path === "/library/members" || path.startsWith("/library/members/")) {
			if (!me.rights.size) throw new LibraryError("members are listed for those the owner has given a right", 403);
			if (path === "/library/members" && m === "GET") return json(200, await listPage(env, me, url.searchParams, nowSeconds), cors);
			if ((match = /^\/library\/members\/(\d+)$/.exec(path))) {
				if (m === "GET") return json(200, await memberPage(env, me, Number(match[1]), nowSeconds, { quota: cfg.quota }), cors);
				if (m === "POST") return json(200, { member: await setMember(env, me, Number(match[1]), await readJson(request), nowSeconds) }, cors);
			}
			if ((match = /^\/library\/members\/(\d+)\/uploads(\/delete)?$/.exec(path))) {
				if (!can(me, "moderate")) throw new LibraryError("a member's uploads are listed for Moderate members", 403);
				const memberId = Number(match[1]);
				// The owner's library is the owner's alone.
				if (memberId === (await ownerId(env))) throw new LibraryError("the owner's library is private", 403);
				if (!match[2] && m === "GET") return json(200, await uploadsPage(env, memberId, url.searchParams, publicUpload), cors);
				if (match[2] && m === "POST") return json(200, await deleteMemberUploads(env, me, memberId, await readJson(request), nowSeconds), cors);
			}
		}
		return json(404, { error: `no route ${m} ${path}` }, cors);
	} catch (err) {
		if (err instanceof HttpError || err instanceof UploadRuleError) return json(err.status, { error: err.message }, cors);
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
	// An address for a member it is shared with names them; the share is checked on every request, so taking it back works at once.
	const m = url.searchParams.get("m");
	const member = m === null ? null : /^\d+$/.test(m) ? Number(m) : NaN;
	if (Number.isNaN(member)) return text(403, "this address is not valid");
	if (!(await verifySigned(String(id), url.searchParams.get("e"), url.searchParams.get("s"), env.AUDIO_SIGNING_KEY, undefined, member))) return text(403, "this address has expired or is not valid; open the library again");
	if (member !== null && !(await mayHear(env, id, member))) return text(403, "this song is no longer shared with you");
	const row = await env.DB.prepare(
		"SELECT u.r2_key, u.format, u.status, m.blocked_at FROM uploads u LEFT JOIN members m ON m.id = u.owner_id WHERE u.id = ?1",
	).bind(id).first();
	if (!row || row.status === "uploading") return text(404, "no such upload");
	if (row.blocked_at) return text(403, "this library is closed");
	return streamObject(request, env, row.r2_key, row.format, { shared: member !== null });
}

/**
 * GET/HEAD /k/<key>?e&s: a file in storage, for the app to read its tags
 * and length before adding it (see listStorage). The address is the
 * permission, and any key outside users/ (members' uploads) can be named.
 */
export async function handleSignedKey(request, env, encoded) {
	const url = new URL(request.url);
	const text = (status, body) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
	const allowed = corsOf(env, request);
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
async function streamObject(request, env, key, format, { shared = false } = {}) {
	const text = (status, body) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
	const range = request.headers.get("range");
	const m = /^bytes=(\d+)-(\d+)?$/.exec(range ?? "");
	const options = m ? { range: m[2] ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : { offset: Number(m[1]) } } : undefined;
	let object;
	try {
		object = await env.BUCKET.get(key, options);
	} catch (err) {
		// A range starting past the end of the file: R2 refuses it.
		if (!m) throw err;
		const head = await env.BUCKET.head(key);
		if (!head) return text(404, "the file is missing");
		return new Response("range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${head.size}`, "Cache-Control": "no-store" } });
	}
	if (!object) return text(404, "the file is missing");
	const headers = new Headers({
		"Content-Type": FORMATS[format]?.type ?? "application/octet-stream",
		"Accept-Ranges": "bytes",
		// A shared song is checked on every request, so taking a share back (or blocking) stops it at once: not kept.
		"Cache-Control": shared ? "private, no-store" : "private, max-age=3600",
		"X-Content-Type-Options": "nosniff",
	});
	// The app reads with CORS: downloads for offline listening, and tags before adding from storage.
	const allowed = corsOf(env, request);
	if (allowed) {
		headers.set("Access-Control-Allow-Origin", allowed);
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
