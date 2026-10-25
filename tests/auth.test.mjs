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
	assert.equal(returnUrl("https://zaideih.com/?x=1#/workspace", origins), "https://zaideih.com/");
	assert.throws(() => returnUrl("https://evil.example/", origins), /may not sign in/);
	assert.throws(() => returnUrl("javascript:alert(1)", origins), /may not sign in/);
	assert.throws(() => returnUrl(null, origins), /Workspace's URL/);
});

test("login redirects to GitHub with PKCE and a state naming the page", async () => {
	const res = await handleAuth(new Request(`${W}/auth/login?return=${encodeURIComponent("https://zaideih.com/")}&nonce=${NONCE}&challenge=${CHALLENGE}&to=workspace`), env);
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
	assert.equal(back.headers.get("location"), `https://zaideih.com/#/workspace?signin=abc123&nonce=${NONCE}`);
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

/* ------------------------------------------------------------ suggestions ---- */
const { generateKeyPairSync, createVerify } = await import("node:crypto");
const { appJwt, checkSuggestion, resetInstallation } = await import("../worker/media/suggest.js");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const BASE = "a".repeat(40);
const limiter = (ok = true) => ({ keys: [], async limit({ key }) { this.keys.push(key); return { success: ok }; } });
const senv = (extra = {}) => ({ ...env, GITHUB_REPO: "khensolomon/zaideih", GITHUB_APP_KEY: privateKey, SUGGEST_LIMIT: limiter(), ...extra });
const suggestion = (extra = {}) => ({ base: BASE, note: "Fix a title", lines: ['album "A": title "A " → "A"'], files: { "assets/data/albums.json": "[]" }, ...extra });
const postAs = (body, token = "ghu_guest") => new Request(`${W}/auth/suggest`, { method: "POST", headers: { Origin: "https://zaideih.com", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

function fakeApi() {
	const calls = [];
	const fetchImpl = async (url, init) => {
		const path = url.replace("https://api.github.com", "");
		const body = init.body ? JSON.parse(init.body) : null;
		calls.push({ path, method: init.method, auth: init.headers.Authorization, body });
		const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
		if (path === "/user") return init.headers.Authorization === "Bearer ghu_guest" ? J({ login: "Guest1", id: 42 }) : J({ message: "Bad credentials" }, 401);
		if (path === "/repos/khensolomon/zaideih/installation") return J({ id: 7 });
		if (path === "/app/installations/7/access_tokens") return J({ token: "ghs_inst", expires_at: new Date(Date.now() + 3600e3).toISOString() }, 201);
		if (path === `/repos/khensolomon/zaideih/git/commits/${BASE}`) return J({ tree: { sha: "t0" } });
		if (path.endsWith("/git/blobs")) return J({ sha: "b1" }, 201);
		if (path.endsWith("/git/trees")) return J({ sha: "t1" }, 201);
		if (path.endsWith("/git/commits")) return J({ sha: "c1" }, 201);
		if (path.endsWith("/git/refs")) return J({}, 201);
		if (path.endsWith("/pulls")) return J({ number: 88, html_url: "https://github.com/khensolomon/zaideih/pull/88" }, 201);
		return J({ message: `unexpected ${path}` }, 500);
	};
	return { calls, fetchImpl };
}

test("the App's JWT is RS256, signed with its key, issued by the client id", async () => {
	const jwt = await appJwt("Iv23test", privateKey, 1_000_000);
	const [h, b, sig] = jwt.split(".");
	assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "RS256", typ: "JWT" });
	assert.deepEqual(JSON.parse(Buffer.from(b, "base64url")), { iat: 999_940, exp: 1_000_540, iss: "Iv23test" });
	assert.ok(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, "base64url")));
	await assert.rejects(appJwt("x", "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----"), /PKCS#8/);
});

test("a suggestion may change only the catalog's data files", () => {
	assert.throws(() => checkSuggestion(suggestion({ files: { "package.json": "{}" } })), /cannot be changed by a suggestion/);
	assert.throws(() => checkSuggestion(suggestion({ files: { ".github/workflows/ci.yml": "x" } })), /cannot be changed/);
	assert.throws(() => checkSuggestion(suggestion({ base: "main" })), /base must be/);
	assert.throws(() => checkSuggestion(suggestion({ note: "" })), /note must be/);
	assert.throws(() => checkSuggestion(suggestion({ lines: [] })), /lines must/);
	assert.deepEqual(checkSuggestion(suggestion({ note: "Hi <b>there</b>\nnext" })).note, "Hi bthere/b next");
});

test("a suggestion becomes a pull request by the App, authored by the person", async () => {
	resetInstallation();
	const api = fakeApi();
	const e = senv();
	const res = await handleAuth(postAs(suggestion()), e, { fetchImpl: api.fetchImpl, now: () => 1_700_000_000_000 });
	assert.equal(res.status, 201);
	assert.deepEqual(await res.json(), { number: 88, url: "https://github.com/khensolomon/zaideih/pull/88", branch: `suggest-guest1-${(1_700_000_000_000).toString(36)}` });
	assert.deepEqual(e.SUGGEST_LIMIT.keys, ["suggest:42"]);
	assert.equal(api.calls[0].auth, "Bearer ghu_guest", "the person is checked with their own token");
	const writes = api.calls.filter((c) => c.method === "POST" && c.path.startsWith("/repos/"));
	assert.ok(writes.every((c) => c.auth === "Bearer ghs_inst"), "writes use the installation token");
	const tokenReq = api.calls.find((c) => c.path.endsWith("/access_tokens"));
	assert.deepEqual(tokenReq.body, { repositories: ["zaideih"], permissions: { contents: "write", pull_requests: "write" } });
	const commit = api.calls.find((c) => c.path.endsWith("/git/commits"));
	assert.deepEqual(commit.body.author.name, "Guest1");
	assert.equal(commit.body.author.email, "42+Guest1@users.noreply.github.com");
	assert.deepEqual(commit.body.parents, [BASE]);
	const pr = api.calls.find((c) => c.path.endsWith("/pulls"));
	assert.equal(pr.body.title, "Suggestion: Fix a title");
	assert.match(pr.body.body, /Suggested by @Guest1/);

	// The installation token is reused while it lasts.
	await handleAuth(postAs(suggestion()), e, { fetchImpl: api.fetchImpl, now: () => 1_700_000_000_000 });
	assert.equal(api.calls.filter((c) => c.path.endsWith("/access_tokens")).length, 1);
});

test("suggestions are refused without a sign-in, over the limit, or without setup", async () => {
	resetInstallation();
	const api = fakeApi();
	const noAuth = await handleAuth(new Request(`${W}/auth/suggest`, { method: "POST", headers: { Origin: "https://zaideih.com" }, body: JSON.stringify(suggestion()) }), senv(), { fetchImpl: api.fetchImpl });
	assert.equal(noAuth.status, 401);
	const bad = await handleAuth(postAs(suggestion(), "ghu_fake"), senv(), { fetchImpl: api.fetchImpl });
	assert.equal(bad.status, 401);
	const limited = await handleAuth(postAs(suggestion()), senv({ SUGGEST_LIMIT: limiter(false) }), { fetchImpl: api.fetchImpl });
	assert.equal(limited.status, 429);
	assert.equal(api.calls.filter((c) => c.method === "POST").length, 0, "nothing written");
	const unset = await handleAuth(postAs(suggestion()), { ...env }, { fetchImpl: api.fetchImpl });
	assert.equal(unset.status, 503);
	assert.match((await unset.json()).error, /missing GITHUB_REPO, GITHUB_APP_KEY, SUGGEST_LIMIT/);
	const path = await handleAuth(postAs(suggestion({ files: { "tools/build.mjs": "x" } })), senv(), { fetchImpl: api.fetchImpl });
	assert.equal(path.status, 403);
});
