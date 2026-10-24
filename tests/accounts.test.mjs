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
const github = async (url, init) => {
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	if (url.endsWith("/user")) return new Response(JSON.stringify(p.user));
	if (url.endsWith("/user/emails")) return p.emails ? new Response(JSON.stringify(p.emails)) : new Response("{}", { status: 403 });
	return new Response("{}", { status: 500 });
};

function setup() {
	const env = { DB: fakeD1(), BUCKET: fakeR2(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1753766", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "s", AUDIO_SIGNING_KEY: "k", UPLOAD_MAX_BYTES: "1000", UPLOAD_QUOTA_BYTES: "2000", UPLOAD_LIMIT: { limit: async () => ({ success: true }) } };
	let clock = 1_800_000_000_000;
	const post = (path, token, body = {}) => handleAuth(new Request(`${W}${path}`, {
		method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
	}), env, { fetchImpl: github, now: () => clock });
	const lib = (session) => handleLibrary(new Request(`${W}/library`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${session}` } }), env, { now: () => clock });
	return { env, post, lib, tick: (days) => { clock += days * 86400_000; } };
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
	await assert.rejects(signIn(env, { provider: "google", subject: "g-1", name: "x" }, { linkTo: bo.member.id, nowSeconds: at }), /already belongs to another Zaideih account/);
	const viaRoute = await post("/auth/session", "gh-unverified", { link: bo.token });
	assert.equal(viaRoute.status, 409, "cy's GitHub already has its own account");
	assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM member_logins WHERE member_id = ?").get(bo.member.id).n, 2);
	assert.equal((await post("/auth/session", "gh-ann", { link: "zs_" + "x".repeat(43) })).status, 401, "linking needs a live session");
});
