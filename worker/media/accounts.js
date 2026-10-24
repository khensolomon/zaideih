/**
 * Zaideih accounts (docs/accounts.md): one member however they sign in, and
 * Zaideih's own sign-in tokens.
 *
 * A sign-in (GitHub now; Google and passkeys later) is a row in D1
 * `member_logins`, keyed by the provider and the provider's id for the
 * person. On a sign-in the Worker finds the member:
 *   1. the sign-in is known: its member;
 *   2. linking while signed in (`linkTo`): the signed-in member; when the
 *      sign-in already belongs to another member, the two members become one
 *      (mergeMembers), since completing both sign-ins proves one person
 *      holds both;
 *   3. the provider vouches for an email that exactly one member already has
 *      verified: that member;
 *   4. otherwise a new member.
 * Only verified emails join members: an unverified one could be anyone's.
 *
 * The Worker then gives a session token ("zs_" and 43 base64url characters).
 * Only its SHA-256 hash is stored (`member_sessions`); it lasts SESSION_DAYS
 * after its last use (renewed at most daily), signing out deletes it, and
 * the personal library routes accept nothing else.
 *
 * Routes (under /auth, POST, CORS for AUTH_ORIGINS, see auth.js):
 *   /auth/session        Authorization: Bearer <GitHub token> (a GitHub
 *                        sign-in or a fine-grained token), body {} or
 *                        {"link": "<session token>"} -> { token, expires_at, member, joined, email }
 *   /auth/session/end    Authorization: Bearer <session token> -> 204
 *   /auth/me             Authorization: Bearer <session token> -> { member, logins }
 *   /auth/logins/remove  {provider, subject}, with the session -> { member, logins };
 *                        never the last sign-in, nor the owner's GitHub
 * Google's sign-in (google.js) answers sessions the same way.
 */
import { MemberError } from "./members.js";

const API = "https://api.github.com";
const USER_AGENT = "zaideih-media-worker";
export const SESSION_DAYS = 90;
const DAY_S = 86400;
const PREFIX = "zs_";
const TOKEN = /^zs_[A-Za-z0-9_-]{43}$/;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hashOf(token) {
	return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

/** The session token in `Authorization: Bearer zs_…`, or null when there is none of that shape. */
export function sessionToken(request) {
	const m = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
	return m && TOKEN.test(m[1]) ? m[1] : null;
}

/* ----------------------------------------------------------- sign-ins ---- */

/**
 * The GitHub account behind a token: { provider, subject, login, name,
 * email, emailVerified, verifiedEmails }. Emails need the GitHub App's
 * "Email addresses" permission (a fine-grained token: the same permission);
 * without it the answer has no email, and the sign-in joins by email never.
 */
export async function githubIdentity(token, fetchImpl) {
	const get = (path) => fetchImpl(`${API}${path}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT, "X-GitHub-Api-Version": "2022-11-28" } });
	const res = await get("/user");
	if (res.status === 401) throw new MemberError("the GitHub sign-in is not valid any more; sign in again", 401);
	if (!res.ok) throw new MemberError(`GitHub GET /user: HTTP ${res.status}`, 502);
	const user = await res.json();
	const mails = await get("/user/emails");
	let list = [];
	if (mails.ok) list = await mails.json();
	else if (mails.status !== 403 && mails.status !== 404) throw new MemberError(`GitHub GET /user/emails: HTTP ${mails.status}`, 502);
	const verified = list.filter((e) => e.verified && typeof e.email === "string" && !/@users\.noreply\.github\.com$/i.test(e.email)).map((e) => e.email.toLowerCase());
	const primary = list.find((e) => e.primary && e.verified)?.email?.toLowerCase() ?? verified[0] ?? null;
	return { provider: "github", subject: String(user.id), login: user.login, name: user.login, email: primary, emailVerified: Boolean(primary), verifiedEmails: verified };
}

/**
 * Finds or makes the member for a sign-in (see the rules at the top) and
 * keeps the sign-in's details. Answers { id, name, joined: "known" | "link" | "merged" | "email" | "new" }.
 */
export async function signIn(env, who, { linkTo = null, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
	const known = await env.DB.prepare("SELECT member_id FROM member_logins WHERE provider = ?1 AND subject = ?2").bind(who.provider, who.subject).first();
	let memberId = null;
	let joined;
	if (known && linkTo !== null && known.member_id !== linkTo) {
		// Signed in to one account and just signed in to the other: the same person holds both, so they become one.
		memberId = await mergeMembers(env, linkTo, known.member_id, nowSeconds);
		joined = "merged";
	} else if (known) {
		memberId = known.member_id;
		joined = "known";
	} else if (linkTo !== null) {
		memberId = linkTo;
		joined = "link";
	} else {
		const emails = [...new Set([who.emailVerified ? who.email : null, ...(who.verifiedEmails ?? [])].filter(Boolean))];
		if (emails.length) {
			const rows = (await env.DB.prepare(
				`SELECT DISTINCT member_id FROM member_logins WHERE email_verified = 1 AND email IN (${emails.map((_, i) => `?${i + 1}`).join(", ")})`,
			).bind(...emails).all()).results ?? [];
			// Two members with the same email: joining either would be a guess.
			if (rows.length === 1) { memberId = rows[0].member_id; joined = "email"; }
		}
		if (memberId === null) {
			const made = await env.DB.prepare("INSERT INTO members (name, first_seen, last_seen) VALUES (?1, ?2, ?2)").bind(who.name, nowSeconds).run();
			memberId = made.meta.last_row_id;
			joined = "new";
		}
	}
	await env.DB.prepare(
		`INSERT INTO member_logins (provider, subject, member_id, login, email, email_verified, created_at, last_used)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
		ON CONFLICT (provider, subject) DO UPDATE SET login = ?4, email = ?5, email_verified = ?6, last_used = ?7`,
	).bind(who.provider, who.subject, memberId, who.login ?? null, who.email ?? null, who.emailVerified ? 1 : 0, nowSeconds).run();
	// A GitHub login is the name moderators know; other sign-ins name a member only when it is new.
	if (who.provider === "github") await env.DB.prepare("UPDATE members SET name = ?1, last_seen = ?2 WHERE id = ?3").bind(who.login, nowSeconds, memberId).run();
	else await env.DB.prepare("UPDATE members SET last_seen = ?1 WHERE id = ?2").bind(nowSeconds, memberId).run();
	const row = await env.DB.prepare("SELECT id, name FROM members WHERE id = ?1").bind(memberId).first();
	if (!row) throw new MemberError(`member ${memberId} is missing`, 500);
	return { id: row.id, name: row.name, joined };
}

/**
 * Makes two members one, for a person who signed in to both: the older
 * member stays (its id, so its files in R2 keep their place), and takes the
 * other's sign-ins, sessions, uploads, publish requests, rights and storage
 * folder. Refused while either is blocked, so a merge cannot lift a block.
 * One D1 batch: all of it or none. Answers the id that stays.
 */
export async function mergeMembers(env, a, b, nowSeconds) {
	const rows = (await env.DB.prepare("SELECT id, first_seen, blocked_at FROM members WHERE id IN (?1, ?2)").bind(a, b).all()).results ?? [];
	if (rows.length !== 2) throw new MemberError("one of the accounts to join no longer exists; sign in again", 409);
	if (rows.some((r) => r.blocked_at)) throw new MemberError("one of these accounts is blocked; the owner can join them", 403);
	const [keep, gone] = [...rows].sort((x, y) => x.first_seen - y.first_seen || x.id - y.id).map((r) => r.id);
	const q = (sql) => env.DB.prepare(sql).bind(keep, gone);
	await env.DB.batch([
		q("UPDATE member_logins SET member_id = ?1 WHERE member_id = ?2"),
		q("UPDATE member_sessions SET member_id = ?1 WHERE member_id = ?2"),
		q("UPDATE passkeys SET member_id = ?1 WHERE member_id = ?2"),
		// Libraries (sync.js): the moved rows take a new counter so every device of the account sees them.
		env.DB.prepare("INSERT INTO library_sync (member_id, seq) VALUES (?1, 0) ON CONFLICT (member_id) DO NOTHING").bind(keep),
		q("UPDATE library_sync SET seq = seq + 1 + COALESCE((SELECT seq FROM library_sync WHERE member_id = ?2), 0) WHERE member_id = ?1"),
		q("INSERT OR IGNORE INTO library_likes (member_id, track, liked, at, seq) SELECT ?1, track, liked, at, (SELECT seq FROM library_sync WHERE member_id = ?1) FROM library_likes WHERE member_id = ?2"),
		q("DELETE FROM library_likes WHERE member_id = ?2"),
		q("UPDATE library_playlists SET member_id = ?1, seq = (SELECT seq FROM library_sync WHERE member_id = ?1) WHERE member_id = ?2"),
		q("DELETE FROM library_sync WHERE member_id = ?2"),
		q("UPDATE lyrics_versions SET member_id = ?1 WHERE member_id = ?2"),
		q("UPDATE lyrics SET updated_by = ?1 WHERE updated_by = ?2"),
		q("UPDATE uploads SET owner_id = ?1 WHERE owner_id = ?2"),
		q("UPDATE publish_requests SET owner_id = ?1 WHERE owner_id = ?2"),
		q("UPDATE published_tracks SET owner_id = ?1 WHERE owner_id = ?2"),
		q("INSERT OR IGNORE INTO member_rights (member_id, kind, granted_by, granted_at) SELECT ?1, kind, granted_by, granted_at FROM member_rights WHERE member_id = ?2"),
		q("DELETE FROM member_rights WHERE member_id = ?2"),
		q("INSERT OR IGNORE INTO member_folders (member_id, prefix, set_by, set_at) SELECT ?1, prefix, set_by, set_at FROM member_folders WHERE member_id = ?2"),
		q("DELETE FROM member_folders WHERE member_id = ?2"),
		env.DB.prepare(`UPDATE members SET moderator = MAX(moderator, (SELECT moderator FROM members WHERE id = ?2)),
			first_seen = MIN(first_seen, (SELECT first_seen FROM members WHERE id = ?2)), last_seen = ?3 WHERE id = ?1`).bind(keep, gone, nowSeconds),
		q("DELETE FROM members WHERE id = ?2"),
	]);
	return keep;
}

/* ----------------------------------------------------------- sessions ---- */

export async function startSession(env, memberId, nowSeconds) {
	const token = PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
	const expires = nowSeconds + SESSION_DAYS * DAY_S;
	await env.DB.prepare("INSERT INTO member_sessions (token_hash, member_id, created_at, last_used, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)")
		.bind(await hashOf(token), memberId, nowSeconds, expires).run();
	return { token, expiresAt: expires };
}

/** The member id of the request's session token. Throws MemberError (401) without a live one. */
export async function sessionMember(env, request, nowSeconds) {
	const token = sessionToken(request);
	if (!token) throw new MemberError("sign in first", 401);
	const hash = await hashOf(token);
	const row = await env.DB.prepare("SELECT member_id, last_used, expires_at FROM member_sessions WHERE token_hash = ?1").bind(hash).first();
	if (!row || row.expires_at <= nowSeconds) {
		if (row) await env.DB.prepare("DELETE FROM member_sessions WHERE token_hash = ?1").bind(hash).run();
		throw new MemberError("the sign-in has run out; sign in again", 401);
	}
	if (row.last_used < nowSeconds - DAY_S) {
		await env.DB.prepare("UPDATE member_sessions SET last_used = ?1, expires_at = ?2 WHERE token_hash = ?3").bind(nowSeconds, nowSeconds + SESSION_DAYS * DAY_S, hash).run();
	}
	return row.member_id;
}

export async function endSession(env, token) {
	await env.DB.prepare("DELETE FROM member_sessions WHERE token_hash = ?1").bind(await hashOf(token)).run();
}

/* ------------------------------------------------------------- routes ---- */

/** The member a sign-in should be added to (`{"link": "<session>"}`), or null. */
async function linkTarget(env, body, nowSeconds) {
	if (body.link === undefined) return null;
	if (typeof body.link !== "string" || !TOKEN.test(body.link)) throw new MemberError("link must be a session token");
	return sessionMember(env, new Request("https://x", { headers: { Authorization: `Bearer ${body.link}` } }), nowSeconds);
}

/** Signs in `who` and answers the new session, as every sign-in route does. */
export async function issueSession(env, who, body, nowSeconds) {
	const member = await signIn(env, who, { linkTo: await linkTarget(env, body, nowSeconds), nowSeconds });
	const session = await startSession(env, member.id, nowSeconds);
	return { token: session.token, expires_at: session.expiresAt * 1000, member: { id: member.id, name: member.name }, joined: member.joined, email: who.email };
}

/** The signed-in member and their sign-ins, for "Your account". */
export async function me(env, memberId) {
	const m = await env.DB.prepare("SELECT id, name FROM members WHERE id = ?1").bind(memberId).first();
	const rows = (await env.DB.prepare("SELECT provider, subject, login, email, email_verified, created_at, last_used FROM member_logins WHERE member_id = ?1 ORDER BY created_at").bind(memberId).all()).results ?? [];
	return {
		member: { id: m.id, name: m.name },
		logins: rows.map((r) => ({ provider: r.provider, subject: r.subject, login: r.login, email: r.email, emailVerified: r.email_verified === 1, added: r.created_at, used: r.last_used })),
	};
}

/** Removes one of the member's sign-ins; never the last one, nor the owner's GitHub. */
async function removeLogin(env, memberId, body) {
	const { provider, subject } = body;
	if (typeof provider !== "string" || typeof subject !== "string") throw new MemberError("expected {provider, subject}");
	const row = await env.DB.prepare("SELECT member_id FROM member_logins WHERE provider = ?1 AND subject = ?2").bind(provider, subject).first();
	if (!row || row.member_id !== memberId) throw new MemberError("no such sign-in on your account", 404);
	const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM member_logins WHERE member_id = ?1").bind(memberId).first()).n;
	if (n <= 1) throw new MemberError("this is the only way you sign in; add another before removing it", 409);
	if (provider === "github" && subject === env.OWNER_GITHUB_ID) throw new MemberError("the owner's GitHub sign-in is what makes the owner; it stays", 409);
	await env.DB.prepare("DELETE FROM member_logins WHERE provider = ?1 AND subject = ?2").bind(provider, subject).run();
	// A passkey's key goes with its sign-in.
	if (provider === "passkey") await env.DB.prepare("DELETE FROM passkeys WHERE credential_id = ?1").bind(subject).run();
	return me(env, memberId);
}

/**
 * The account routes under /auth (called by auth.js, which checks the
 * origin and answers errors): session, session/end, me, logins/remove.
 * Answers [status, body].
 */
export async function handleSession(request, env, route, body, { fetchImpl, nowSeconds }) {
	if (!env.DB) throw new MemberError("accounts are not set up on this Worker: missing the D1 binding DB", 503);
	if (route === "/auth/session/end") {
		const token = sessionToken(request);
		if (!token) throw new MemberError("expected Authorization: Bearer <session token>", 400);
		await endSession(env, token);
		return [204, null];
	}
	if (route === "/auth/me") return [200, await me(env, await sessionMember(env, request, nowSeconds))];
	if (route === "/auth/logins/remove") return [200, await removeLogin(env, await sessionMember(env, request, nowSeconds), body)];
	// /auth/session: a GitHub token for a session.
	const auth = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
	if (!auth || TOKEN.test(auth[1])) throw new MemberError("expected Authorization: Bearer <GitHub token>", 400);
	const who = await githubIdentity(auth[1], fetchImpl);
	return [200, await issueSession(env, who, body, nowSeconds)];
}
