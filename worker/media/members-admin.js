/**
 * The Workspace's Members (docs/library.md#members): the members a page at a
 * time, found by name, login or id, one member's page, their uploads a page
 * at a time, and the log of what was done to them by those with rights.
 *
 * Who sees what: anyone holding a right lists members and opens a member's
 * page; a member's uploads need Moderate members; sign-in emails are shown
 * to, and searched by, the owner and co-owners only. Nothing here returns a
 * session, a passkey or an address to play an upload.
 *
 * Each request stays within D1's queries per request on the Free plan: a
 * list is four queries, a member's page about twenty.
 */
import { can, ownerId, RIGHTS, rightsOf } from "./members.js";

export class AdminError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

export const PAGE = 50;
const MAX_PAGE = 100;
/** Past this, a page is never asked for (the list is far shorter); a larger offset is refused, not sent to D1. */
const MAX_OFFSET = 1_000_000;
const MAX_QUERY = 100;
const NEW_DAYS = 30;
const HISTORY = 60;
export const FILTERS = Object.freeze(["all", "rights", "uploading", "new", "blocked"]);
export const SORTS = Object.freeze({
	seen: "m.last_seen DESC, m.id DESC",
	joined: "m.first_seen DESC, m.id DESC",
	space: "CASE WHEN m.id = {OWNER} THEN 0 ELSE used END DESC, m.last_seen DESC, m.id DESC",
	name: "m.name COLLATE NOCASE ASC, m.id ASC",
});
export const ACTIONS = Object.freeze(["right-given", "right-taken", "folder", "blocked", "unblocked", "signed-out", "uploads-deleted"]);

const UPLOADS_ROOT = "users/";
const STORAGE_DEFAULT = "private/";

/** A statement that records `action` on member `memberId` by `by` (a login) at `at`. */
export function logStatement(env, memberId, action, detail, by, at) {
	if (!ACTIONS.includes(action)) throw new Error(`unknown member log action ${action}`);
	return env.DB.prepare("INSERT INTO member_log (member_id, action, detail, by_login, at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(memberId, action, JSON.stringify(detail ?? {}), by, at);
}

/** A whole number from a query parameter, or `fallback` when absent; refuses anything else. */
function whole(value, name, fallback, max) {
	if (value === null || value === "") return fallback;
	if (!/^\d+$/.test(value)) throw new AdminError(`${name} must be a whole number`);
	const n = Number(value);
	if (max !== undefined && n > max) throw new AdminError(`${name} must be at most ${max}`);
	return n;
}

/** LIKE pattern for text anywhere, with %, _ and \ taken literally. */
const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * SQL with named values ({OWNER}, {SINCE}, {Q}) numbered in the order they
 * first appear, and the values to bind: D1 refuses a value bound to no
 * placeholder.
 */
export function bindNamed(sql, values) {
	const order = [];
	const text = sql.replace(/\{([A-Z]+)\}/g, (_, name) => {
		if (!(name in values)) throw new Error(`no value for {${name}}`);
		if (!order.includes(name)) order.push(name);
		return `?${order.indexOf(name) + 1}`;
	});
	return { sql: text, args: order.map((n) => values[n]) };
}

/**
 * The WHERE part for a search: an id (`42` or `#42`), or text in the
 * member's name, a sign-in's login or full name, and (for those who may
 * see them) a sign-in's email. Returns { sql, q } ({Q} its value).
 */
function searchOf(q, withEmail) {
	if (!q) return { sql: "", q: null };
	const id = /^#?(\d{1,15})$/.exec(q);
	if (id) return { sql: "m.id = {Q}", q: Number(id[1]) };
	const fields = ["l.login", "l.full_name", ...(withEmail ? ["l.email"] : [])].map((f) => `${f} LIKE {Q} ESCAPE '\\'`).join(" OR ");
	return {
		sql: `(m.name LIKE {Q} ESCAPE '\\' OR EXISTS (SELECT 1 FROM member_logins l WHERE l.member_id = m.id AND (${fields})))`,
		q: likeOf(q),
	};
}

const FILTER_SQL = {
	all: "1",
	// The owner holds every right without a row.
	rights: "(m.id = {OWNER} OR m.moderator = 1 OR EXISTS (SELECT 1 FROM member_rights r WHERE r.member_id = m.id))",
	uploading: "(m.id <> {OWNER} AND EXISTS (SELECT 1 FROM uploads u WHERE u.owner_id = m.id))",
	new: "m.first_seen >= {SINCE}",
	blocked: "m.blocked_at IS NOT NULL",
};

/**
 * GET /library/members?q&filter&sort&offset&limit: a page of members.
 * { members: [summary], total (matching the search and filter), counts
 * (matching the search, per filter), offset, limit }.
 */
export async function listPage(env, me, params, nowSeconds) {
	const q = (params.get("q") ?? "").normalize("NFC").trim();
	if (q.length > MAX_QUERY) throw new AdminError(`the search is at most ${MAX_QUERY} characters`);
	const filter = params.get("filter") || "all";
	if (!FILTERS.includes(filter)) throw new AdminError(`filter is one of ${FILTERS.join(", ")}`);
	const sort = params.get("sort") || "seen";
	if (!SORTS[sort]) throw new AdminError(`sort is one of ${Object.keys(SORTS).join(", ")}`);
	const offset = whole(params.get("offset"), "offset", 0, MAX_OFFSET);
	const limit = whole(params.get("limit"), "limit", PAGE, MAX_PAGE) || PAGE;
	const owner = await ownerId(env);
	const since = nowSeconds - NEW_DAYS * 86400;
	const search = searchOf(q, can(me, "manage"));
	const values = { OWNER: owner ?? -1, SINCE: since, Q: search.q };
	const where = (f) => [search.sql, f === "all" ? "" : FILTER_SQL[f]].filter(Boolean).join(" AND ") || "1";
	const run = (sql) => {
		const b = bindNamed(sql, values);
		return env.DB.prepare(b.sql).bind(...b.args);
	};

	const counts = await run(`SELECT COUNT(*) AS all_n,
			SUM(CASE WHEN ${FILTER_SQL.rights} THEN 1 ELSE 0 END) AS rights_n,
			SUM(CASE WHEN ${FILTER_SQL.uploading} THEN 1 ELSE 0 END) AS uploading_n,
			SUM(CASE WHEN ${FILTER_SQL.new} THEN 1 ELSE 0 END) AS new_n,
			SUM(CASE WHEN ${FILTER_SQL.blocked} THEN 1 ELSE 0 END) AS blocked_n
		FROM members m WHERE ${where("all")}`).first();
	const rows = (await run(`SELECT m.id, m.name, m.blocked_at, m.blocked_by, m.blocked_reason, m.first_seen, m.last_seen,
			(SELECT COUNT(*) FROM uploads u WHERE u.owner_id = m.id) AS uploads,
			(SELECT COALESCE(SUM(u.size), 0) FROM uploads u WHERE u.owner_id = m.id AND u.r2_key LIKE '${UPLOADS_ROOT}%') AS used,
			(SELECT l.full_name FROM member_logins l WHERE l.member_id = m.id AND l.full_name IS NOT NULL ORDER BY l.last_used DESC LIMIT 1) AS full_name,
			(SELECT l.picture FROM member_logins l WHERE l.member_id = m.id AND l.picture IS NOT NULL ORDER BY l.last_used DESC LIMIT 1) AS picture,
			(SELECT f.prefix FROM member_folders f WHERE f.member_id = m.id) AS folder
		FROM members m WHERE ${where(filter)} ORDER BY ${SORTS[sort]} LIMIT ${limit} OFFSET ${offset}`).all()).results ?? [];
	const rights = await rightsOf(env);
	const c = counts ?? {};
	const n = { all: c.all_n ?? 0, rights: c.rights_n ?? 0, uploading: c.uploading_n ?? 0, new: c.new_n ?? 0, blocked: c.blocked_n ?? 0 };
	return {
		members: rows.map((r) => summary(r, owner, rights)),
		total: n[filter],
		counts: n,
		offset, limit, filter, sort, q,
	};
}

/** A member as the list shows them. */
function summary(r, owner, rights) {
	return {
		id: r.id, login: r.name, name: r.full_name ?? "", picture: r.picture ?? "", owner: r.id === owner,
		// Where Storage adds from (the owner and co-owners: the whole bucket but users/).
		folder: r.id === owner ? null : r.folder ?? `${STORAGE_DEFAULT}${r.id}/`,
		rights: r.id === owner ? Object.keys(RIGHTS) : [...(rights.get(r.id) ?? [])],
		// The owner's library is the owner's alone: nothing of it is shown.
		uploads: r.id === owner ? 0 : r.uploads, used: r.id === owner ? 0 : r.used,
		blocked: r.blocked_at ? { at: r.blocked_at, by: r.blocked_by, reason: r.blocked_reason ?? "" } : null,
		firstSeen: r.first_seen, lastSeen: r.last_seen,
	};
}

/** One member as the list shows them, or null (after a change). */
export async function memberSummary(env, id) {
	const r = await env.DB.prepare(`SELECT m.id, m.name, m.blocked_at, m.blocked_by, m.blocked_reason, m.first_seen, m.last_seen,
			(SELECT COUNT(*) FROM uploads u WHERE u.owner_id = m.id) AS uploads,
			(SELECT COALESCE(SUM(u.size), 0) FROM uploads u WHERE u.owner_id = m.id AND u.r2_key LIKE '${UPLOADS_ROOT}%') AS used,
			(SELECT l.full_name FROM member_logins l WHERE l.member_id = m.id AND l.full_name IS NOT NULL ORDER BY l.last_used DESC LIMIT 1) AS full_name,
			(SELECT l.picture FROM member_logins l WHERE l.member_id = m.id AND l.picture IS NOT NULL ORDER BY l.last_used DESC LIMIT 1) AS picture,
			(SELECT f.prefix FROM member_folders f WHERE f.member_id = m.id) AS folder
		FROM members m WHERE m.id = ?1`).bind(id).first();
	if (!r) return null;
	return summary(r, await ownerId(env), await rightsOf(env, id));
}

/**
 * GET /library/members/<id>: one member's page.
 * { member (summary, with `folder`), rights: [{ kind, by, at }], logins:
 *   [{ provider, login, name, picture, email?, created, lastUsed }],
 *   passkeys: { count, lastUsed }, sessions: { count, lastUsed },
 *   library: { liked, playlists, sharesGiven, sharesReceived },
 *   uploads: { count, used, published, quota },
 *   contributions: { lyrics, requests: { open, approved, rejected, … }, songbooks },
 *   history: [{ at, action, by?, detail }] (newest first) }
 * The owner's own library (uploads, likes, playlists, shares) stays private.
 */
export async function memberPage(env, me, id, nowSeconds, { quota = null } = {}) {
	const base = await memberSummary(env, id);
	if (!base) throw new AdminError("no such member", 404);
	const isOwner = base.owner;
	const seeEmail = can(me, "manage");
	const granted = isOwner ? [] : ((await env.DB.prepare("SELECT kind, granted_by, granted_at FROM member_rights WHERE member_id = ?1 ORDER BY granted_at").bind(id).all()).results ?? []);
	const logins = (await env.DB.prepare("SELECT provider, login, full_name, picture, email, created_at, last_used FROM member_logins WHERE member_id = ?1 ORDER BY created_at").bind(id).all()).results ?? [];
	const keys = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(last_used) AS last, MIN(created_at) AS first FROM passkeys WHERE member_id = ?1").bind(id).first();
	const sessions = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(last_used) AS last FROM member_sessions WHERE member_id = ?1 AND expires_at > ?2").bind(id, nowSeconds).first();
	const lib = isOwner ? null : await env.DB.prepare(`SELECT
			(SELECT COUNT(*) FROM library_likes WHERE member_id = ?1 AND liked = 1) AS liked,
			(SELECT COUNT(*) FROM library_playlists WHERE member_id = ?1 AND deleted = 0) AS playlists,
			(SELECT COUNT(*) FROM library_shares WHERE owner_id = ?1 AND member_id IS NOT NULL) AS given,
			(SELECT COUNT(*) FROM library_shares WHERE member_id = ?1) AS received,
			(SELECT COUNT(*) FROM uploads WHERE owner_id = ?1 AND status IN ('published', 'released')) AS published`).bind(id).first();
	const lyrics = await env.DB.prepare("SELECT COUNT(*) AS n FROM lyrics_versions WHERE member_id = ?1").bind(id).first();
	const requests = (await env.DB.prepare("SELECT status, COUNT(*) AS n FROM publish_requests WHERE owner_id = ?1 GROUP BY status").bind(id).all()).results ?? [];
	const books = await env.DB.prepare("SELECT COUNT(*) AS n FROM songbook_members WHERE member_id = ?1").bind(id).first();
	return {
		member: base,
		rights: isOwner ? Object.keys(RIGHTS).map((kind) => ({ kind, by: null, at: null })) : granted.map((r) => ({ kind: r.kind, by: r.granted_by, at: r.granted_at })),
		logins: logins.map((l) => ({ provider: l.provider, login: l.login ?? "", name: l.full_name ?? "", picture: l.picture ?? "", ...(seeEmail && l.email ? { email: l.email } : {}), created: l.created_at, lastUsed: l.last_used })),
		passkeys: { count: keys?.n ?? 0, lastUsed: keys?.last ?? null },
		sessions: { count: sessions?.n ?? 0, lastUsed: sessions?.last ?? null },
		library: lib ? { liked: lib.liked, playlists: lib.playlists, sharesGiven: lib.given, sharesReceived: lib.received } : null,
		uploads: isOwner ? null : { count: base.uploads, used: base.used, published: lib?.published ?? 0, quota },
		contributions: { lyrics: lyrics?.n ?? 0, requests: Object.fromEntries(requests.map((r) => [r.status, r.n])), songbooks: books?.n ?? 0 },
		history: await history(env, id, base, logins, keys),
	};
}

/**
 * What happened to and by a member, newest first: the member log, joining,
 * each sign-in way and the first passkey, requests to publish (asked and
 * decided) and the latest lyrics versions.
 */
async function history(env, id, base, logins, keys) {
	const out = [];
	const log = (await env.DB.prepare("SELECT action, detail, by_login, at FROM member_log WHERE member_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2").bind(id, HISTORY).all()).results ?? [];
	for (const r of log) {
		let detail = {};
		try { detail = JSON.parse(r.detail); } catch { /* an unreadable detail is shown without one */ }
		out.push({ at: r.at, action: r.action, by: r.by_login, detail });
	}
	// The sign-in made on joining is the joining; others were added later.
	const first = logins[0];
	out.push({ at: base.firstSeen, action: "joined", detail: first ? { provider: first.provider } : {} });
	for (const l of logins.slice(1)) out.push({ at: l.created_at, action: "sign-in-added", detail: { provider: l.provider } });
	if (keys?.n) out.push({ at: keys.first, action: "passkey-added", detail: { count: keys.n } });
	const reqs = (await env.DB.prepare("SELECT album, status, reviewer, created_at, decided_at FROM publish_requests WHERE owner_id = ?1 ORDER BY created_at DESC LIMIT 20").bind(id).all()).results ?? [];
	for (const r of reqs) {
		out.push({ at: r.created_at, action: "asked-to-publish", detail: { album: r.album } });
		if (r.decided_at) out.push({ at: r.decided_at, action: `request-${r.status}`, by: r.reviewer ?? null, detail: { album: r.album } });
	}
	const ly = (await env.DB.prepare("SELECT track, lang, version, at FROM lyrics_versions WHERE member_id = ?1 ORDER BY at DESC LIMIT 20").bind(id).all()).results ?? [];
	for (const r of ly) out.push({ at: r.at, action: "lyrics-saved", detail: { track: r.track, lang: r.lang, version: r.version } });
	return out.sort((a, b) => b.at - a.at).slice(0, HISTORY);
}

/**
 * GET /library/members/<id>/uploads?q&offset&limit: a member's uploads,
 * newest first, found by title, artist, album or file name.
 * { uploads, total, offset, limit } (titles only, no addresses).
 */
export async function uploadsPage(env, id, params, publicUpload) {
	const q = (params.get("q") ?? "").normalize("NFC").trim();
	if (q.length > MAX_QUERY) throw new AdminError(`the search is at most ${MAX_QUERY} characters`);
	const offset = whole(params.get("offset"), "offset", 0, MAX_OFFSET);
	const limit = whole(params.get("limit"), "limit", PAGE, MAX_PAGE) || PAGE;
	const where = q ? "owner_id = ?1 AND (title LIKE ?2 ESCAPE '\\' OR artist LIKE ?2 ESCAPE '\\' OR album LIKE ?2 ESCAPE '\\' OR file_name LIKE ?2 ESCAPE '\\')" : "owner_id = ?1";
	const args = q ? [id, likeOf(q)] : [id];
	const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM uploads WHERE ${where}`).bind(...args).first())?.n ?? 0;
	const rows = (await env.DB.prepare(`SELECT * FROM uploads WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`).bind(...args).all()).results ?? [];
	return { uploads: rows.map(publicUpload), total, offset, limit, q };
}
