/**
 * Who is asking: the GitHub account behind a sign-in token, with its role
 * on Zaideih (docs/library.md). Used by the personal library routes
 * (library.js).
 *
 * The token is the person's GitHub App user token (src/admin/session.js).
 * GitHub answers who it belongs to (GET /user) and their permission on the
 * repository (GET /repos/{repo}); both are asked with the person's own
 * token, so nothing here can be claimed by the caller. The answer is kept
 * per isolate for CACHE_MS, keyed by a hash of the token (never the token).
 *
 * Roles:
 *   owner      the owner of GITHUB_REPO
 *   admin      admin or maintain on the repository
 *   editor     write
 *   member     any other GitHub account
 * Moderator rights and blocks are Zaideih's own (D1 `members`).
 */
const API = "https://api.github.com";
const USER_AGENT = "zaideih-media-worker";
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 500;
const SEEN_EVERY_S = 3600;

export class MemberError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

/** @type {Map<string, { who: object, expires: number }>} */
const cache = new Map();

/** For tests. */
export function forgetMembers() {
	cache.clear();
}

async function tokenKey(token) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

async function gh(fetchImpl, path, token) {
	const res = await fetchImpl(`${API}${path}`, {
		headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT, "X-GitHub-Api-Version": "2022-11-28" },
	});
	if (res.status === 401) throw new MemberError("the GitHub sign-in is not valid any more; sign in again", 401);
	if (!res.ok) throw new MemberError(`GitHub GET ${path}: HTTP ${res.status}`, 502);
	return res.json();
}

/** The role for a login and GitHub's repository permissions. */
export function roleOf(login, permissions, repo) {
	if (login.toLowerCase() === repo.split("/")[0].toLowerCase()) return "owner";
	if (permissions?.admin || permissions?.maintain) return "admin";
	if (permissions?.push) return "editor";
	return "member";
}

/**
 * The person behind the request's `Authorization: Bearer <token>`:
 * { id, login, role }. Throws MemberError (401) without a valid sign-in.
 */
export async function whoIs(request, env, { fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
	const auth = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
	if (!auth) throw new MemberError("sign in with GitHub first", 401);
	const key = await tokenKey(auth[1]);
	const hit = cache.get(key);
	if (hit && hit.expires > now()) return hit.who;
	const [user, repo] = await Promise.all([gh(fetchImpl, "/user", auth[1]), gh(fetchImpl, `/repos/${env.GITHUB_REPO}`, auth[1])]);
	const who = { id: user.id, login: user.login, role: roleOf(user.login, repo.permissions, env.GITHUB_REPO) };
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
	cache.set(key, { who, expires: now() + CACHE_MS });
	return who;
}

/**
 * The person's row in D1 `members`, created on first use; the login and
 * last_seen are refreshed at most hourly. Answers
 * { ...who, moderator, blocked: null | { at, by, reason } }.
 */
export async function memberRow(env, who, nowSeconds = Math.floor(Date.now() / 1000)) {
	await env.DB.prepare(
		`INSERT INTO members (github_id, login, first_seen, last_seen) VALUES (?1, ?2, ?3, ?3)
		ON CONFLICT(github_id) DO UPDATE SET login = ?2, last_seen = ?3 WHERE members.last_seen < ?3 - ${SEEN_EVERY_S} OR members.login <> ?2`,
	).bind(who.id, who.login, nowSeconds).run();
	const row = await env.DB.prepare("SELECT moderator, blocked_at, blocked_by, blocked_reason FROM members WHERE github_id = ?1").bind(who.id).first();
	return {
		...who,
		// The owner always moderates; nobody can block the owner.
		moderator: who.role === "owner" || row?.moderator === 1,
		blocked: who.role !== "owner" && row?.blocked_at ? { at: row.blocked_at, by: row.blocked_by, reason: row.blocked_reason ?? "" } : null,
	};
}
