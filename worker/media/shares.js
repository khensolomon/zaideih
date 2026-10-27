/**
 * Sharing private music with other members (docs/library.md, "Sharing"):
 * one album of a member's library, or all of it (what is added later too),
 * shared with one member at a time. They listen to it in their own Library
 * and search; they cannot change it, share it on or ask to publish it.
 *
 * A member shares by an invite link: the code is shown once, kept only as
 * its hash, used once, and gone after INVITE_DAYS unused. Whoever opens it
 * signed in gets the share, so no member can list the others. The owner and
 * co-owners may also name a member directly (found by name).
 *
 * A shared song plays through an address that names its listener
 * (/u/<id>?e&m&s, library.js): every play checks the share is still there,
 * so taking a share back stops it at once, not when the address expires.
 * "Listen only" hides downloading in the app; the stream itself is the same.
 *
 * Routes (under /library, see library.js for sign-in and CORS):
 *   POST   /library/shares                    {album: <name> | null (all), listenOnly?, member?: <id>}
 *                                             -> {share, code?}: an invite (code shown once), or,
 *                                             with `member` (the owner and co-owners), shared at once
 *   PATCH  /library/shares/<id>               {listenOnly}: its owner
 *   DELETE /library/shares/<id>               its owner (take it back), or its member (leave it)
 *   GET    /library/shares/invite/<code>      what an invite shares, before taking it
 *   POST   /library/shares/invite/<code>      take it
 *   GET    /library/shares/members?q=<name>   the owner and co-owners: members by name, to share with
 */
import { can } from "./members.js";
import { LibraryError } from "./library.js";

export const INVITE_DAYS = 14;
const MAX_SHARES = 200;
const MAX_OPEN_INVITES = 20;
const FIND = 20;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const hashOf = async (code) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
const newCode = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const CODE = /^[A-Za-z0-9_-]{32}$/;

/** A share as the app sees it. */
const shareOut = (r) => ({
	id: r.id, album: r.scope === "all" ? null : r.album, listenOnly: Boolean(r.listen_only),
	member: r.member_id ? { id: r.member_id, name: r.member_name ?? null } : null,
	invite: Boolean(r.invite_hash), created: r.created_at, accepted: r.accepted_at ?? null,
	owner: r.owner_name !== undefined ? { id: r.owner_id, name: r.owner_name } : undefined,
});

/** Invites left unused for INVITE_DAYS are removed. */
async function dropOldInvites(env, nowSeconds) {
	await env.DB.prepare("DELETE FROM library_shares WHERE member_id IS NULL AND created_at < ?1").bind(nowSeconds - INVITE_DAYS * 86400).run();
}

/** The shares a member made: [{ id, album, listenOnly, member, invite, created, accepted }]. */
export async function sharesOf(env, ownerId, nowSeconds) {
	await dropOldInvites(env, nowSeconds);
	const rows = (await env.DB.prepare(
		"SELECT s.*, m.name AS member_name FROM library_shares s LEFT JOIN members m ON m.id = s.member_id WHERE s.owner_id = ?1 ORDER BY s.scope = 'all' DESC, s.album COLLATE NOCASE, s.created_at",
	).bind(ownerId).all()).results ?? [];
	return rows.map(shareOut);
}

/** The shares made with a member: [{ id, album, listenOnly, owner: { id, name }, accepted }] (blocked owners left out). */
export async function sharesWith(env, memberId) {
	const rows = (await env.DB.prepare(
		"SELECT s.*, m.name AS owner_name FROM library_shares s JOIN members m ON m.id = s.owner_id WHERE s.member_id = ?1 AND m.blocked_at IS NULL ORDER BY m.name COLLATE NOCASE, s.scope = 'all' DESC, s.album COLLATE NOCASE",
	).bind(memberId).all()).results ?? [];
	return rows.map(shareOut);
}

/**
 * The songs shared with a member, each once: the upload's row, its owner's
 * name, and whether it is listen only (only when every share that covers it
 * is). Songs of a blocked member are left out.
 */
export async function sharedWith(env, memberId) {
	const rows = (await env.DB.prepare(
		`SELECT u.*, m.name AS owner_name, MIN(s.listen_only) AS listen_only FROM library_shares s
		JOIN uploads u ON u.owner_id = s.owner_id AND (s.scope = 'all' OR s.album = COALESCE(u.album, ''))
		JOIN members m ON m.id = s.owner_id
		WHERE s.member_id = ?1 AND u.status <> 'uploading' AND m.blocked_at IS NULL
		GROUP BY u.id ORDER BY m.name COLLATE NOCASE, u.album COLLATE NOCASE, u.track_no, u.title COLLATE NOCASE`,
	).bind(memberId).all()).results ?? [];
	return rows;
}

/** True when upload `id` is shared with `memberId` (and both members may still use it). */
export async function mayHear(env, id, memberId) {
	const row = await env.DB.prepare(
		`SELECT 1 AS yes FROM uploads u
		JOIN library_shares s ON s.owner_id = u.owner_id AND s.member_id = ?2 AND (s.scope = 'all' OR s.album = COALESCE(u.album, ''))
		JOIN members listener ON listener.id = ?2
		WHERE u.id = ?1 AND listener.blocked_at IS NULL LIMIT 1`,
	).bind(id, memberId).first();
	return Boolean(row);
}

async function shareRow(env, id) {
	const r = await env.DB.prepare("SELECT * FROM library_shares WHERE id = ?1").bind(id).first();
	if (!r) throw new LibraryError("no such share", 404);
	return r;
}

async function create(env, me, body, nowSeconds) {
	const all = body.album === null || body.album === undefined;
	if (!all && typeof body.album !== "string") throw new LibraryError("album must be an album's name in your library, or null for all of it");
	const album = all ? "" : body.album.trim();
	if (!all) {
		const has = await env.DB.prepare("SELECT 1 AS yes FROM uploads WHERE owner_id = ?1 AND COALESCE(album, '') = ?2 AND status <> 'uploading' LIMIT 1").bind(me.id, album).first();
		if (!has) throw new LibraryError(`there is no album "${album || "Singles"}" in your library`, 404);
	}
	const listenOnly = body.listenOnly ? 1 : 0;
	const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM library_shares WHERE owner_id = ?1").bind(me.id).first();
	if (n >= MAX_SHARES) throw new LibraryError(`you have ${MAX_SHARES} shares; take some back first`, 409);
	const scope = all ? "all" : "album";
	if (body.member !== undefined && body.member !== null) {
		if (!can(me, "manage")) throw new LibraryError("sharing with a named member is for the owner and co-owners; send an invite link instead", 403);
		const member = Number(body.member);
		if (member === me.id) throw new LibraryError("this is your own library");
		const who = await env.DB.prepare("SELECT id, name, blocked_at FROM members WHERE id = ?1").bind(member).first();
		if (!who) throw new LibraryError("no such member", 404);
		if (who.blocked_at) throw new LibraryError(`${who.name} is blocked`, 409);
		const same = await env.DB.prepare("SELECT id FROM library_shares WHERE owner_id = ?1 AND scope = ?2 AND album = ?3 AND member_id = ?4").bind(me.id, scope, album, member).first();
		if (same) throw new LibraryError(`this is already shared with ${who.name}`, 409);
		const res = await env.DB.prepare("INSERT INTO library_shares (owner_id, scope, album, member_id, listen_only, created_at, accepted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)")
			.bind(me.id, scope, album, member, listenOnly, nowSeconds).run();
		return { share: shareOut({ ...(await shareRow(env, res.meta.last_row_id)), member_name: who.name }) };
	}
	await dropOldInvites(env, nowSeconds);
	const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM library_shares WHERE owner_id = ?1 AND member_id IS NULL").bind(me.id).first();
	if (open.n >= MAX_OPEN_INVITES) throw new LibraryError(`you have ${MAX_OPEN_INVITES} unused invites; take some back first`, 409);
	const code = newCode();
	const res = await env.DB.prepare("INSERT INTO library_shares (owner_id, scope, album, listen_only, invite_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
		.bind(me.id, scope, album, listenOnly, await hashOf(code), nowSeconds).run();
	return { share: shareOut(await shareRow(env, res.meta.last_row_id)), code };
}

/** The invite named by a code, still unused and not too old, with its owner's name; or throws. */
async function inviteOf(env, code, nowSeconds) {
	if (!CODE.test(code)) throw new LibraryError("this invite link is not complete; ask for it again", 400);
	await dropOldInvites(env, nowSeconds);
	const r = await env.DB.prepare("SELECT s.*, m.name AS owner_name, m.blocked_at FROM library_shares s JOIN members m ON m.id = s.owner_id WHERE s.invite_hash = ?1").bind(await hashOf(code)).first();
	if (!r) throw new LibraryError(`this invite was used already, taken back, or is older than ${INVITE_DAYS} days; ask for a new one`, 404);
	if (r.blocked_at) throw new LibraryError("this library is closed", 403);
	return r;
}

async function preview(env, me, code, nowSeconds) {
	const r = await inviteOf(env, code, nowSeconds);
	const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE owner_id = ?1 AND status <> 'uploading' AND (?2 = 'all' OR COALESCE(album, '') = ?3)").bind(r.owner_id, r.scope, r.album).first();
	return { owner: { id: r.owner_id, name: r.owner_name }, album: r.scope === "all" ? null : r.album, songs: n, listenOnly: Boolean(r.listen_only), yours: r.owner_id === me.id };
}

async function accept(env, me, code, nowSeconds) {
	const r = await inviteOf(env, code, nowSeconds);
	if (r.owner_id === me.id) throw new LibraryError("this is your own invite: send the link to the person you are sharing with", 409);
	const same = await env.DB.prepare("SELECT id FROM library_shares WHERE owner_id = ?1 AND scope = ?2 AND album = ?3 AND member_id = ?4").bind(r.owner_id, r.scope, r.album, me.id).first();
	if (same) {
		// Already shared with them: the invite is spent, nothing else changes.
		await env.DB.prepare("DELETE FROM library_shares WHERE id = ?1").bind(r.id).run();
		return { share: shareOut({ ...(await shareRow(env, same.id)), owner_name: r.owner_name }), already: true };
	}
	await env.DB.prepare("UPDATE library_shares SET member_id = ?1, invite_hash = NULL, accepted_at = ?2 WHERE id = ?3 AND invite_hash IS NOT NULL").bind(me.id, nowSeconds, r.id).run();
	return { share: shareOut({ ...(await shareRow(env, r.id)), owner_name: r.owner_name }), already: false };
}

async function findMembers(env, me, q) {
	if (!can(me, "manage")) throw new LibraryError("finding members by name is for the owner and co-owners", 403);
	const text = String(q ?? "").trim();
	if (text.length < 2) return { members: [] };
	const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const rows = (await env.DB.prepare(`SELECT id, name FROM members WHERE name LIKE ?1 ESCAPE '\\' AND id <> ?2 AND blocked_at IS NULL ORDER BY name COLLATE NOCASE LIMIT ${FIND}`).bind(like, me.id).all()).results ?? [];
	return { members: rows.map((r) => ({ id: r.id, name: r.name })) };
}

/**
 * When an album of a library is renamed so that no song keeps its old name,
 * its shares follow it to the new name.
 */
export async function followRename(env, ownerId, from, to) {
	const left = await env.DB.prepare("SELECT 1 AS yes FROM uploads WHERE owner_id = ?1 AND COALESCE(album, '') = ?2 LIMIT 1").bind(ownerId, from ?? "").first();
	if (left) return;
	await env.DB.prepare("UPDATE library_shares SET album = ?1 WHERE owner_id = ?2 AND scope = 'album' AND album = ?3").bind(to ?? "", ownerId, from ?? "").run();
}

/** /library/shares*: answers [status, body], or null when the path is not one of these. */
export async function handleShares(request, env, me, path, url, readJson, nowSeconds) {
	const m = request.method;
	let match;
	if (path === "/library/shares" && m === "POST") return [201, await create(env, me, await readJson(request), nowSeconds)];
	if (path === "/library/shares/members" && m === "GET") return [200, await findMembers(env, me, url.searchParams.get("q"))];
	if ((match = /^\/library\/shares\/invite\/([^/]+)$/.exec(path))) {
		const code = decodeURIComponent(match[1]);
		if (m === "GET") return [200, await preview(env, me, code, nowSeconds)];
		if (m === "POST") return [200, await accept(env, me, code, nowSeconds)];
	}
	if ((match = /^\/library\/shares\/(\d+)$/.exec(path))) {
		const r = await shareRow(env, Number(match[1]));
		if (m === "PATCH") {
			if (r.owner_id !== me.id) throw new LibraryError("only who shared it changes a share", 403);
			const body = await readJson(request);
			if (typeof body.listenOnly !== "boolean") throw new LibraryError("listenOnly must be true or false");
			await env.DB.prepare("UPDATE library_shares SET listen_only = ?1 WHERE id = ?2").bind(body.listenOnly ? 1 : 0, r.id).run();
			return [200, { share: shareOut(await shareRow(env, r.id)) }];
		}
		if (m === "DELETE") {
			if (r.owner_id !== me.id && r.member_id !== me.id) throw new LibraryError("a share is taken back by who shared it, or left by who it is shared with", 403);
			await env.DB.prepare("DELETE FROM library_shares WHERE id = ?1").bind(r.id).run();
			return [204, null];
		}
	}
	return null;
}
