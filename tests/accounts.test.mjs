import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, fakeR2, sqlite } from "./helpers/fakes.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { handleLibrary } = await import("../worker/media/library.js");
const { signIn, SESSION_DAYS } = await import("../worker/media/accounts.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const mails = (...list) => list.map(([email, verified, primary = false]) => ({ email, verified, primary }));
const PEOPLE = {
	"gh-owner": { user: { id: 1753766, login: "khensolomon" }, emails: mails(["khen@example.com", true, true]) },
	"gh-ann": { user: { id: 42, login: "ann" }, emails: mails(["ann@work.example", true, true], ["ann@home.example", true]) },
	"gh-noperm": { user: { id: 43, login: "bo" } },
	"gh-unverified": { user: { id: 44, login: "cy" }, emails: mails(["khen@example.com", false, true]) },
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const GOOGLE = {
	"code-khen": { sub: "g-111", email: "Khen@Example.com", email_verified: true, name: "Khen Solomon" },
	"code-new": { sub: "g-222", email: "new@example.com", email_verified: true, name: "" },
	"code-unverified": { sub: "g-333", email: "ann@work.example", email_verified: false, name: "Not Ann" },
	"code-otherapp": { sub: "g-444", email: "x@example.com", email_verified: true, aud: "someone-else" },
};
const googleCalls = [];
const github = async (url, init) => {
	if (url === "https://oauth2.googleapis.com/token") {
		const form = new URLSearchParams(init.body);
		googleCalls.push(Object.fromEntries(form));
		const c = GOOGLE[form.get("code")];
		if (!c) return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" }), { status: 400 });
		const claims = { iss: "https://accounts.google.com", aud: "g-client.apps.googleusercontent.com", exp: 1_900_000_000, ...c };
		return new Response(JSON.stringify({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.sig`, access_token: "ya29" }));
	}
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	if (url.endsWith("/user")) return new Response(JSON.stringify(p.user));
	if (url.endsWith("/user/emails")) return p.emails ? new Response(JSON.stringify(p.emails)) : new Response("{}", { status: 403 });
	return new Response("{}", { status: 500 });
};

function setup() {
	const env = { GOOGLE_CLIENT_ID: "g-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "g-secret", DB: fakeD1(), BUCKET: fakeR2(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1753766", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "s", AUDIO_SIGNING_KEY: "k", UPLOAD_MAX_BYTES: "1000", UPLOAD_QUOTA_BYTES: "2000", UPLOAD_LIMIT: { limit: async () => ({ success: true }) } };
	let clock = 1_800_000_000_000;
	const post = (path, token, body = {}) => handleAuth(new Request(`${W}${path}`, {
		method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
	}), env, { fetchImpl: github, now: () => clock });
	const lib = (session) => handleLibrary(new Request(`${W}/library`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${session}` } }), env, { now: () => clock });
	const get = (path) => handleAuth(new Request(`${W}${path}`), env, { fetchImpl: github, now: () => clock });
	const google = (code, extra = {}) => handleAuth(new Request(`${W}/auth/google/token`, {
		method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ code, verifier: "v".repeat(43), ...extra }),
	}), env, { fetchImpl: github, now: () => clock });
	return { env, post, lib, get, google, tick: (days) => { clock += days * 86400_000; } };
}

test("a GitHub sign-in becomes a Zaideih session; the library takes nothing else", { skip }, async () => {
	const { env, post, lib } = setup();
	const res = await post("/auth/session", "gh-ann");
	assert.equal(res.status, 200);
	const s = await res.json();
	assert.match(s.token, /^zs_[A-Za-z0-9_-]{43}$/);
	assert.deepEqual([s.member.name, s.joined, s.email], ["ann", "new", "ann@work.example"]);
	assert.equal((await lib(s.token)).status, 200);
	assert.equal((await lib("gh-ann")).status, 401, "a GitHub token is not a session");
	assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM member_sessions WHERE token_hash = ?").get(s.token).n, 0, "only the hash is kept");

	const again = await (await post("/auth/session", "gh-ann")).json();
	assert.deepEqual([again.member.id, again.joined], [s.member.id, "known"]);
	assert.equal((await post("/auth/session", "nobody")).status, 401);
	assert.equal((await post("/auth/session", s.token)).status, 400, "a session is not exchanged for another");

	assert.equal((await post("/auth/session/end", s.token)).status, 204);
	assert.equal((await lib(s.token)).status, 401, "signed out");
	assert.equal((await lib(again.token)).status, 200, "other devices stay signed in");
});

test("sessions last SESSION_DAYS after their last use", { skip }, async () => {
	const { post, lib, tick } = setup();
	const { token } = await (await post("/auth/session", "gh-ann")).json();
	tick(SESSION_DAYS - 1);
	assert.equal((await lib(token)).status, 200, "renewed by use");
	tick(SESSION_DAYS - 1);
	assert.equal((await lib(token)).status, 200);
	tick(SESSION_DAYS + 1);
	assert.equal((await lib(token)).status, 401);
});

test("the owner is the member signed in with OWNER_GITHUB_ID, whatever the login", { skip }, async () => {
	const { post, lib } = setup();
	const owner = await (await post("/auth/session", "gh-owner")).json();
	assert.equal((await (await lib(owner.token)).json()).member.role, "owner");
	PEOPLE["gh-noperm"].user.login = "khensolomon";
	const lookalike = await (await post("/auth/session", "gh-noperm")).json();
	PEOPLE["gh-noperm"].user.login = "bo";
	assert.equal((await (await lib(lookalike.token)).json()).member.role, "member", "a login alone is not the owner");
});

test("sign-ins join one member by verified email, or by linking while signed in", { skip }, async () => {
	const { env, post } = setup();
	const at = 1_800_000_000;
	const owner = await (await post("/auth/session", "gh-owner")).json();
	// A Google sign-in (next PR) with the owner's verified email joins the owner.
	const google = await signIn(env, { provider: "google", subject: "g-1", name: "Khen", email: "khen@example.com", emailVerified: true }, { nowSeconds: at });
	assert.deepEqual([google.id, google.joined], [owner.member.id, "email"]);
	// Any verified address of the new sign-in counts, not only its primary.
	const home = await signIn(env, { provider: "google", subject: "g-2", name: "Ann", email: "ann@home.example", emailVerified: true }, { nowSeconds: at });
	const ann = await (await post("/auth/session", "gh-ann")).json();
	assert.deepEqual([ann.member.id, ann.joined], [home.id, "email"]);
	// An unverified email, or none, never joins.
	const cy = await (await post("/auth/session", "gh-unverified")).json();
	assert.equal(cy.joined, "new");
	const bo = await (await post("/auth/session", "gh-noperm")).json();
	assert.deepEqual([bo.joined, bo.email], ["new", null]);
	// Linking: bo, signed in, adds a Google sign-in that has no email in common.
	const linked = await signIn(env, { provider: "google", subject: "g-3", name: "Bo", email: "bo@else.example", emailVerified: true }, { linkTo: bo.member.id, nowSeconds: at });
	assert.deepEqual([linked.id, linked.joined], [bo.member.id, "link"]);
	assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM member_logins WHERE member_id = ?").get(bo.member.id).n, 2);
	assert.equal((await post("/auth/session", "gh-ann", { link: "zs_" + "x".repeat(43) })).status, 401, "linking needs a live session");
});

test("Google sign-in: the Worker sends the browser to Google and back to the account page", { skip }, async () => {
	const { env, get } = setup();
	const q = new URLSearchParams({ return: `${ORIGIN}/`, nonce: "n".repeat(43), challenge: "c".repeat(43) });
	const out = await get(`/auth/google/login?${q}`);
	assert.equal(out.status, 302);
	const to = new URL(out.headers.get("location"));
	assert.equal(to.origin + to.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
	assert.deepEqual(["client_id", "redirect_uri", "scope", "code_challenge_method"].map((k) => to.searchParams.get(k)), ["g-client.apps.googleusercontent.com", `${W}/auth/google/callback`, "openid email profile", "S256"]);
	const back = await get(`/auth/google/callback?code=abc&state=${to.searchParams.get("state")}`);
	assert.equal(back.headers.get("location"), `${ORIGIN}/#/account?google=abc&nonce=${"n".repeat(43)}`);
	const denied = await get(`/auth/google/callback?error=access_denied&state=${to.searchParams.get("state")}`);
	assert.equal(denied.headers.get("location"), `${ORIGIN}/#/account?google-error=access_denied`);
	assert.equal((await get(`/auth/google/login?${new URLSearchParams({ return: "https://evil.example/", nonce: "n".repeat(43), challenge: "c".repeat(43) })}`)).status, 403);
	delete env.GOOGLE_CLIENT_SECRET;
	const unset = await get(`/auth/google/login?${q}`);
	assert.equal(unset.status, 503);
	assert.match(await unset.text(), /missing GOOGLE_CLIENT_SECRET/);
	// GitHub can return to the account page too.
	const gh = await get(`/auth/login?${q}&to=account`);
	const state = new URL(gh.headers.get("location")).searchParams.get("state");
	assert.equal((await get(`/auth/callback?code=xyz&state=${state}`)).headers.get("location"), `${ORIGIN}/#/account?signin=xyz&nonce=${"n".repeat(43)}`);
	assert.equal((await get(`/auth/login?${q}&to=elsewhere`)).status, 400);
});

test("Google sign-in: a verified email joins the GitHub account; nothing of Google's is kept", { skip }, async () => {
	const { env, post, google } = setup();
	const owner = await (await post("/auth/session", "gh-owner")).json();
	const res = await google("code-khen");
	assert.equal(res.status, 200, await res.clone().text());
	const s = await res.json();
	assert.deepEqual([s.member.id, s.joined, s.email], [owner.member.id, "email", "khen@example.com"]);
	assert.equal(googleCalls.at(-1).code_verifier, "v".repeat(43));
	assert.equal(googleCalls.at(-1).redirect_uri, `${W}/auth/google/callback`);
	const fresh = await (await google("code-new")).json();
	assert.deepEqual([fresh.joined, fresh.member.name], ["new", "new"], "named from the email when Google gives no name");
	assert.equal((await (await google("code-unverified")).json()).joined, "new", "an unverified email joins nobody");
	assert.equal((await google("code-otherapp")).status, 502, "an ID token for another application");
	assert.equal((await google("code-bad")).status, 400);
	assert.match(await (await google("code-bad")).text(), /Google did not sign you in: Bad Request/);
	const kept = JSON.stringify(env.DB.raw.prepare("SELECT * FROM member_logins").all());
	assert.doesNotMatch(kept, /ya29|sig/, "no Google token is stored");
});

test("Your account: the sign-ins, adding one, and removing all but the last", { skip }, async () => {
	const { post, google } = setup();
	const ann = await (await post("/auth/session", "gh-noperm")).json();
	const meOf = async (t) => (await post("/auth/me", t)).json();
	assert.deepEqual((await meOf(ann.token)).logins.map((l) => l.provider), ["github"]);
	const added = await (await google("code-new", { link: ann.token })).json();
	assert.deepEqual([added.member.id, added.joined], [ann.member.id, "link"]);
	const both = await meOf(ann.token);
	assert.deepEqual(both.logins.map((l) => [l.provider, l.email]), [["github", null], ["google", "new@example.com"]]);
	const gh = both.logins[0];
	const after = await post("/auth/logins/remove", ann.token, { provider: "github", subject: gh.subject });
	assert.equal(after.status, 200);
	assert.deepEqual((await after.json()).logins.map((l) => l.provider), ["google"]);
	assert.equal((await post("/auth/logins/remove", ann.token, { provider: "google", subject: "g-222" })).status, 409, "never the last");
	assert.equal((await post("/auth/logins/remove", ann.token, { provider: "github", subject: "1753766" })).status, 404, "nor someone else's");
	const owner = await (await post("/auth/session", "gh-owner")).json();
	await google("code-khen");
	assert.equal((await post("/auth/logins/remove", owner.token, { provider: "github", subject: "1753766" })).status, 409, "the owner's GitHub stays");
	assert.equal((await post("/auth/me", "zs_" + "x".repeat(43))).status, 401);
});

test("adding a sign-in that has its own account makes the two accounts one", { skip }, async () => {
	const { env, post, google, lib } = setup();
	const raw = env.DB.raw;
	// The owner's GitHub account, from before accounts: an upload, a right, a folder.
	const owner = await (await post("/auth/session", "gh-owner")).json();
	raw.prepare("UPDATE members SET first_seen = 100 WHERE id = ?").run(owner.member.id);
	raw.prepare("INSERT INTO uploads (owner_id, r2_key, size, format, duration, title, file_name, status, created_at, updated_at) VALUES (?, 'users/1/9.mp3', 5, 'mp3', 1, 'Old', '9.mp3', 'private', 1, 1)").run(owner.member.id);
	// A Google sign-in made before GitHub gave the email: a second account, with its own upload.
	PEOPLE["gh-owner"].emails = undefined;
	raw.prepare("UPDATE member_logins SET email = NULL, email_verified = 0").run();
	const g = await (await google("code-khen")).json();
	assert.equal(g.joined, "new");
	raw.prepare("INSERT INTO uploads (owner_id, r2_key, size, format, duration, title, file_name, status, created_at, updated_at) VALUES (?, 'users/2/1.mp3', 5, 'mp3', 1, 'New', '1.mp3', 'private', 2, 2)").run(g.member.id);
	raw.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?, 'storage', 'x', 1)").run(g.member.id);
	// Signed in with Google, Add GitHub: one account, the older one's id.
	const merged = await (await post("/auth/session", "gh-owner", { link: g.token })).json();
	assert.deepEqual([merged.joined, merged.member.id], ["merged", owner.member.id]);
	assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM members WHERE id = ?").get(g.member.id).n, 0);
	assert.deepEqual(raw.prepare("SELECT provider FROM member_logins WHERE member_id = ? ORDER BY provider").all(owner.member.id).map((r) => r.provider), ["github", "google"]);
	assert.deepEqual(raw.prepare("SELECT title FROM uploads WHERE owner_id = ? ORDER BY title").all(owner.member.id).map((r) => r.title), ["New", "Old"]);
	assert.equal(raw.prepare("SELECT kind FROM member_rights WHERE member_id = ?").get(owner.member.id).kind, "storage");
	// Every session of either now opens the one account, still the owner's.
	for (const t of [g.token, owner.token, merged.token]) assert.equal((await (await lib(t)).json()).member.role, "owner");
	// The other way round (signed in with GitHub, Add Google) is the same; joining again changes nothing.
	assert.equal((await (await google("code-khen", { link: owner.token })).json()).joined, "known");
	PEOPLE["gh-owner"].emails = mails(["khen@example.com", true, true]);
});

test("a blocked account is not joined to another", { skip }, async () => {
	const { env, post, google } = setup();
	const ann = await (await post("/auth/session", "gh-noperm")).json();
	const g = await (await google("code-new")).json();
	env.DB.raw.prepare("UPDATE members SET blocked_at = 1, blocked_by = 'mod', blocked_reason = 'spam' WHERE id = ?").run(g.member.id);
	const res = await post("/auth/session", "gh-noperm", { link: "zs_" + "x".repeat(43) });
	assert.equal(res.status, 401);
	const tried = await google("code-new", { link: ann.token });
	assert.equal(tried.status, 403);
	assert.match(await tried.text(), /blocked; the owner can join them/);
});
