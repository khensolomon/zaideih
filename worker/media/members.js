/**
 * Who is asking: the member behind a Zaideih session (accounts.js), with
 * their role and rights (docs/library.md). Used by the personal library
 * routes (library.js).
 *
 * Roles:
 *   owner   the member signed in with the GitHub account OWNER_GITHUB_ID
 *           (the repository owner's numeric id, which unlike a login cannot
 *           pass to someone else)
 *   member  everyone else
 * Rights the owner gives (D1 `member_rights`) and blocks (D1 `members`) are
 * Zaideih's own. Catalog editing follows the repository permission instead,
 * which GitHub decides on every request (src/workspace).
 */
import { HttpError } from "./http.js";

export class MemberError extends HttpError {}

/**
 * The owner's member id, or null before the owner has signed in. Throws without
 * OWNER_GITHUB_ID. Once known it never changes (the owner's GitHub sign-in cannot
 * be removed), so each isolate asks D1 once; "null" is asked again, since the
 * owner may sign in for the first time meanwhile.
 */
const owners = new WeakMap(); // env.DB -> member id
export async function ownerId(env) {
	if (!/^\d+$/.test(env.OWNER_GITHUB_ID ?? "")) throw new MemberError("accounts are not set up on this Worker: OWNER_GITHUB_ID must be the owner's numeric GitHub id", 503);
	const known = owners.get(env.DB);
	if (known !== undefined) return known;
	const row = await env.DB.prepare("SELECT member_id FROM member_logins WHERE provider = 'github' AND subject = ?1").bind(env.OWNER_GITHUB_ID).first();
	const id = row?.member_id ?? null;
	if (id !== null) owners.set(env.DB, id);
	return id;
}
/** Tests: the owner may change between databases of one process. */
export const forgetOwner = (env) => owners.delete(env.DB);

/*
 * Rights (docs/library.md). The owner holds all of them; `manage` (a
 * co-owner) implies the others and gives or takes any right from anyone
 * but the owner.
 */
const SEEN_EVERY_S = 3600;

export const RIGHTS = Object.freeze({
	manage: "Co-owner",
	review: "Review publishing",
	moderate: "Moderate members",
	storage: "Storage",
	lyrics: "Lyrics",
	albums: "Albums",
	songbooks: "Songbooks",
	audio: "Audio studio",
	catalog: "Catalog",
});

/** True when the person may do what `right` covers. */
export const can = (me, right) => me.role === "owner" || me.rights.has("manage") || me.rights.has(right);

/** Rights held per member (all members, or one): Map<member id, Set<right>>, the old moderator flag counting as moderate. */
export async function rightsOf(env, id = null) {
	const where = id === null ? "" : " WHERE member_id = ?1";
	const bind = (stmt) => (id === null ? stmt : stmt.bind(id));
	const rows = await bind(env.DB.prepare(`SELECT member_id, kind FROM member_rights${where}`)).all();
	const legacy = await bind(env.DB.prepare(`SELECT id AS member_id FROM members${id === null ? " WHERE" : " WHERE id = ?1 AND"} moderator = 1`)).all();
	const out = new Map();
	const add = (gid, kind) => {
		if (!out.has(gid)) out.set(gid, new Set());
		out.get(gid).add(kind);
	};
	for (const r of rows.results ?? []) add(r.member_id, r.kind);
	for (const r of legacy.results ?? []) add(r.member_id, "moderate");
	return out;
}

/**
 * The member with this id, as the library routes use it:
 * { id, name, login, role, rights: Set, folder, moderator, blocked: null | { at, by, reason } }.
 * `login` is the name shown in decisions (blocked by, reviewed by).
 */
export async function memberRow(env, id, nowSeconds = Math.floor(Date.now() / 1000)) {
	// One query: the member, their rights (the old moderator flag counting as moderate) and their folder.
	const row = await env.DB.prepare(`SELECT id, name, blocked_at, blocked_by, blocked_reason, last_seen, moderator,
		(SELECT GROUP_CONCAT(kind) FROM member_rights WHERE member_id = m.id) AS rights,
		(SELECT prefix FROM member_folders WHERE member_id = m.id) AS folder
		FROM members m WHERE id = ?1`).bind(id).first();
	if (!row) throw new MemberError("this account no longer exists; sign in again", 401);
	if (row.last_seen < nowSeconds - SEEN_EVERY_S) await env.DB.prepare("UPDATE members SET last_seen = ?1 WHERE id = ?2").bind(nowSeconds, id).run();
	const role = (await ownerId(env)) === id ? "owner" : "member";
	const rights = role === "owner" ? new Set(Object.keys(RIGHTS)) : new Set([...(row.rights ? row.rights.split(",") : []), ...(row.moderator ? ["moderate"] : [])]);
	const me = { id, name: row.name, login: row.name, role, rights, folder: row.folder ?? null };
	return {
		...me,
		moderator: can(me, "moderate"),
		// Nobody can block the owner.
		blocked: role !== "owner" && row.blocked_at ? { at: row.blocked_at, by: row.blocked_by, reason: row.blocked_reason ?? "" } : null,
	};
}
