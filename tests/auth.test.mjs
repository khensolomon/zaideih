import assert from "node:assert/strict";
import { test } from "node:test";

const { handleAuth, returnUrl, tokenAnswer } = await import("../worker/media/auth.js");
const { default: worker } = await import("../worker/media/script.js");

const env = { GITHUB_CLIENT_ID: "Iv23test", GITHUB_CLIENT_SECRET: "s3cret", AUTH_ORIGINS: "https://zaideih.com,http://localhost:8080" };
const W = "https://media.zaideih.com";
const NONCE = "n".repeat(43);
const CHALLENGE = "c".repeat(43);
const VERIFIER = "v".repeat(43);

function fakeGitHub(answer) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
		const { status = 200, body = {} } = typeof answer === "function" ? answer(url, init) : answer;
		return new Response(status === 204 ? null : JSON.stringify(body), { status });
	};
	return { calls, fetchImpl };
}
const post = (path, body, origin = "https://zaideih.com") => new Request(`${W}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("returnUrl allows only the listed origins and drops query and fragment", () => {
	const origins = new Set(["https://zaideih.com"]);
	assert.equal(returnUrl("https://zaideih.com/?x=1#/admin", origins), "https://zaideih.com/");
	assert.throws(() => returnUrl("https://evil.example/", origins), /may not sign in/);
	assert.throws(() => returnUrl("javascript:alert(1)", origins), /may not sign in/);
	assert.throws(() => returnUrl(null, origins), /admin page's URL/);
});

test("login redirects to GitHub with PKCE and a state naming the page", async () => {
	const res = await handleAuth(new Request(`${W}/auth/login?return=${encodeURIComponent("https://zaideih.com/")}&nonce=${NONCE}&challenge=${CHALLENGE}`), env);
	assert.equal(res.status, 302);
	const to = new URL(res.headers.get("location"));
	assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
	assert.equal(to.searchParams.get("client_id"), "Iv23test");
	assert.equal(to.searchParams.get("redirect_uri"), `${W}/auth/callback`);
	assert.equal(to.searchParams.get("code_challenge"), CHALLENGE);
	assert.equal(to.searchParams.get("code_challenge_method"), "S256");
	assert.ok(!to.href.includes("s3cret"));

	const back = await handleAuth(new Request(`${W}/auth/callback?code=abc123&state=${to.searchParams.get("state")}`), env);
	assert.equal(back.status, 302);
	assert.equal(back.headers.get("location"), `https://zaideih.com/#/admin?signin=abc123&nonce=${NONCE}`);
	assert.equal(back.headers.get("referrer-policy"), "no-referrer");
});

test("login refuses other origins and malformed PKCE values", async () => {
	const bad = await handleAuth(new Request(`${W}/auth/login?return=${encodeURIComponent("https://evil.example/")}&nonce=${NONCE}&challenge=${CHALLENGE}`), env);
	assert.equal(bad.status, 403);
	assert.match(await bad.text(), /may not sign in/);
	const short = await handleAuth(new Request(`${W}/auth/login?return=${encodeURIComponent("https://zaideih.com/")}&nonce=x&challenge=${CHALLENGE}`), env);
	assert.equal(short.status, 400);
});

test("a forged state cannot send the code to another site", async () => {
	const state = Buffer.from(JSON.stringify({ r: "https://evil.example/", n: NONCE })).toString("base64url");
	const res = await handleAuth(new Request(`${W}/auth/callback?code=abc&state=${state}`), env);
	assert.equal(res.status, 403);
	const broken = await handleAuth(new Request(`${W}/auth/callback?code=abc&state=%%%`), env);
	assert.equal(broken.status, 400);
});

test("a refused sign-in comes back with GitHub's reason", async () => {
	const state = Buffer.from(JSON.stringify({ r: "https://zaideih.com/", n: NONCE })).toString("base64url");
	const res = await handleAuth(new Request(`${W}/auth/callback?error=access_denied&error_description=The+user+has+denied+your+application+access.&state=${state}`), env);
	const to = res.headers.get("location");
	assert.match(to, /^https:\/\/zaideih\.com\/#\/admin\?signin-error=/);
	assert.equal(new URLSearchParams(to.split("?")[1]).get("signin-error"), "The user has denied your application access.");
});

test("token exchange sends the secret and verifier to GitHub and answers with expiry times", async () => {
	const gh = fakeGitHub({ body: { access_token: "ghu_x", expires_in: 28800, refresh_token: "ghr_y", refresh_token_expires_in: 15897600, token_type: "bearer" } });
	const res = await handleAuth(post("/auth/token", { code: "abc", verifier: VERIFIER }), env, { fetchImpl: gh.fetchImpl, now: () => 1000 });
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("access-control-allow-origin"), "https://zaideih.com");
	assert.equal(res.headers.get("cache-control"), "no-store");
	assert.deepEqual(await res.json(), { access_token: "ghu_x", expires_at: 1000 + 28800e3, refresh_token: "ghr_y", refresh_expires_at: 1000 + 15897600e3 });
	assert.equal(gh.calls[0].url, "https://github.com/login/oauth/access_token");
	assert.deepEqual(gh.calls[0].body, { client_id: "Iv23test", client_secret: "s3cret", code: "abc", code_verifier: VERIFIER, redirect_uri: `${W}/auth/callback` });
});

test("tokens are never answered to other origins", async () => {
	const gh = fakeGitHub({ body: { access_token: "ghu_x" } });
	const res = await handleAuth(post("/auth/token", { code: "abc", verifier: VERIFIER }, "https://evil.example"), env, { fetchImpl: gh.fetchImpl });
	assert.equal(res.status, 403);
	assert.equal(res.headers.get("access-control-allow-origin"), null);
	assert.equal(gh.calls.length, 0);
	const pre = await handleAuth(new Request(`${W}/auth/token`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
	assert.equal(pre.status, 403);
	const ok = await handleAuth(new Request(`${W}/auth/token`, { method: "OPTIONS", headers: { Origin: "http://localhost:8080" } }), env);
	assert.equal(ok.status, 204);
	assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:8080");
});

test("GitHub's errors are passed on, not hidden", async () => {
	const gh = fakeGitHub({ body: { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } });
	const res = await handleAuth(post("/auth/token", { code: "old", verifier: VERIFIER }), env, { fetchImpl: gh.fetchImpl });
	assert.equal(res.status, 400);
	assert.deepEqual(await res.json(), { error: "GitHub: The code passed is incorrect or expired." });
	assert.throws(() => tokenAnswer({}), /without a token/);
});

test("refresh and sign-out", async () => {
	const gh = fakeGitHub((url) => url.includes("/applications/") ? { status: 204 } : { body: { access_token: "ghu_2", expires_in: 28800, refresh_token: "ghr_2", refresh_token_expires_in: 15897600 } });
	const res = await handleAuth(post("/auth/refresh", { refresh_token: "ghr_y" }), env, { fetchImpl: gh.fetchImpl, now: () => 0 });
	assert.equal((await res.json()).access_token, "ghu_2");
	assert.deepEqual(gh.calls[0].body, { client_id: "Iv23test", client_secret: "s3cret", grant_type: "refresh_token", refresh_token: "ghr_y" });
	const out = await handleAuth(post("/auth/signout", { access_token: "ghu_2" }), env, { fetchImpl: gh.fetchImpl });
	assert.equal(out.status, 204);
	assert.equal(gh.calls[1].url, "https://api.github.com/applications/Iv23test/token");
	assert.equal(gh.calls[1].init.method, "DELETE");
	assert.equal(gh.calls[1].init.headers.Authorization, `Basic ${btoa("Iv23test:s3cret")}`);
});

test("a Worker without the secret says so instead of failing later", async () => {
	const res = await handleAuth(new Request(`${W}/auth/login`), { GITHUB_CLIENT_ID: "x", AUTH_ORIGINS: "https://zaideih.com" });
	assert.equal(res.status, 503);
	assert.match((await res.json()).error, /missing GITHUB_CLIENT_SECRET/);
});

test("the audio Worker routes /auth to sign-in", async () => {
	const res = await worker.fetch(new Request(`${W}/auth/nothing`, { method: "POST", headers: { Origin: "https://zaideih.com" } }), env, { waitUntil() {} });
	assert.equal(res.status, 404);
	const login = await worker.fetch(new Request(`${W}/auth/login?return=${encodeURIComponent("https://zaideih.com/")}&nonce=${NONCE}&challenge=${CHALLENGE}`), env, { waitUntil() {} });
	assert.equal(login.status, 302);
});
