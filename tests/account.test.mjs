import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_KEY, createAccount, GOOGLE_PENDING_KEY } from "../src/core/account.js";
import { SESSION_KEY, TOKEN_KEY, WHO_KEY } from "../src/core/access.js";

const memory = (init = {}) => {
	const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]));
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
const signedIn = (login = "ann") => memory({
	[WHO_KEY]: { login, level: "guest", via: "github" },
	[SESSION_KEY]: { access_token: "ghu_x", expires_at: Date.now() + 3600e3 },
});

function worker() {
	const calls = [];
	let n = 0;
	const fetchImpl = async (url, init) => {
		calls.push([url, init.headers.Authorization, init.body]);
		if (url.endsWith("/session")) return new Response(JSON.stringify({ token: `zs_${++n}`, expires_at: Date.now() + 90 * 86400e3, member: { id: 7, name: "ann" } }));
		if (url.endsWith("/session/end")) return new Response(null, { status: 204 });
		if (url.endsWith("/google/token")) return new Response(JSON.stringify({ token: `zs_g${++n}`, expires_at: Date.now() + 90 * 86400e3, member: { id: 7, name: "Ann A" } }));
		return new Response("{}", { status: 404 });
	};
	return { calls, fetchImpl };
}

test("the session is got once from the GitHub sign-in, then kept", async () => {
	const local = signedIn();
	const w = worker();
	const account = createAccount({ authUrl: "https://w/auth", local, githubToken: async () => "ghu_x", fetchImpl: w.fetchImpl });
	const [a, b] = await Promise.all([account.token(), account.token()]);
	assert.deepEqual([a, b], ["zs_1", "zs_1"], "parallel calls share one exchange");
	assert.equal(await account.token(), "zs_1");
	assert.deepEqual(w.calls, [["https://w/auth/session", "Bearer ghu_x", "{}"]]);
	assert.deepEqual(account.member, { id: 7, name: "ann" });
});

test("a refused session is got again once; another person's is never used", async () => {
	const local = signedIn();
	const w = worker();
	const account = createAccount({ authUrl: "https://w/auth", local, githubToken: async () => "ghu_x", fetchImpl: w.fetchImpl });
	await account.token();
	const seen = [];
	const res = await account.send(async (t) => { seen.push(t); return new Response("{}", { status: seen.length === 1 ? 401 : 200 }); });
	assert.equal(res.status, 200);
	assert.deepEqual(seen, ["zs_1", "zs_2"]);
	// Someone else signs in on this device: a new session for them.
	local.setItem(WHO_KEY, JSON.stringify({ login: "bo", level: "guest", via: "github" }));
	assert.equal(await account.token(), "zs_3");
});

test("a fine-grained token works too; signing out ends the session at the Worker", async () => {
	const local = memory({ [WHO_KEY]: { login: "ann", level: "editor", via: "token" }, [TOKEN_KEY]: "github_pat_x" });
	const w = worker();
	const account = createAccount({ authUrl: "https://w/auth", local, githubToken: async () => { throw new Error("not used"); }, fetchImpl: w.fetchImpl });
	await account.token();
	assert.equal(w.calls[0][1], "Bearer github_pat_x");
	await account.signOut();
	assert.deepEqual(w.calls[1].slice(0, 2), ["https://w/auth/session/end", "Bearer zs_1"]);
	assert.equal(local.getItem(ACCOUNT_KEY), null);
	await assert.rejects(createAccount({ authUrl: "x", local: memory(), githubToken: async () => "" }).token(), /sign in first/);
});

test("Google: the tab keeps the verifier; only that tab's code becomes a session", async () => {
	const local = memory();
	const tab = memory();
	const w = worker();
	const account = createAccount({ authUrl: "https://w/auth", local, tab, githubToken: async () => "", fetchImpl: w.fetchImpl });
	assert.equal(account.signedIn, false);
	const go = new URL(await account.google.start("https://zaideih.com/"));
	assert.equal(go.origin + go.pathname, "https://w/auth/google/login");
	assert.equal(go.searchParams.get("return"), "https://zaideih.com/");
	const pending = JSON.parse(tab.getItem(GOOGLE_PENDING_KEY));
	await assert.rejects(account.google.finish({ code: "c", nonce: "other" }), /not started from this tab/);
	assert.equal(tab.getItem(GOOGLE_PENDING_KEY), null, "a pending sign-in is used once");
	tab.setItem(GOOGLE_PENDING_KEY, JSON.stringify(pending));
	await account.google.finish({ code: "c", nonce: pending.nonce });
	assert.deepEqual(JSON.parse(w.calls.at(-1)[2]), { code: "c", verifier: pending.verifier });
	assert.equal(w.calls.at(-1)[1], undefined, "no token is sent to get one");
	assert.equal(account.signedIn, true);
	assert.equal(await account.token(), "zs_g1");
	assert.deepEqual(account.member, { id: 7, name: "Ann A" });
	assert.match(account.key, /^google:7$/);
});

test("adding Google to a GitHub sign-in links it, and the session stays the GitHub login's", async () => {
	const local = signedIn();
	const tab = memory();
	const w = worker();
	const account = createAccount({ authUrl: "https://w/auth", local, tab, githubToken: async () => "ghu_x", fetchImpl: w.fetchImpl });
	await account.token();
	await account.google.start("https://zaideih.com/", { link: true });
	const { nonce } = JSON.parse(tab.getItem(GOOGLE_PENDING_KEY));
	await account.google.finish({ code: "c", nonce });
	assert.equal(JSON.parse(w.calls.at(-1)[2]).link, "zs_1");
	assert.equal(account.key, "github:ann");
});

test("waiting for a sign-in from the home screen: the Worker's code, an error, or giving up", async () => {
	const { waitForSignIn } = await import("../src/core/account.js");
	let n = 0;
	const answers = [204, 204, { code: "abc" }];
	const fetchImpl = async (url, init) => {
		assert.equal(url, "https://w/auth/wait");
		assert.deepEqual(JSON.parse(init.body), { nonce: "N" });
		const a = answers[Math.min(n++, answers.length - 1)];
		return a === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(a));
	};
	const listeners = {};
	const doc = { visibilityState: "visible", addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
	const w = waitForSignIn({ authUrl: "https://w/auth", nonce: "N", fetchImpl, everyMs: 5, doc });
	assert.equal(await w.promise, "abc");
	assert.equal(n, 3);
	assert.equal(listeners.visibilitychange, undefined, "stops listening once done");

	const refused = waitForSignIn({ authUrl: "https://w/auth", nonce: "N", fetchImpl: async () => new Response(JSON.stringify({ error: "access_denied" })), everyMs: 1, doc });
	await assert.rejects(refused.promise, /not signed in: access_denied/);

	let t = 0;
	const slow = waitForSignIn({ authUrl: "https://w/auth", nonce: "N", fetchImpl: async () => new Response(null, { status: 204 }), everyMs: 1, timeoutMs: 10, now: () => (t += 6), doc });
	await assert.rejects(slow.promise, /not finished in time/);

	const c = waitForSignIn({ authUrl: "https://w/auth", nonce: "N", fetchImpl: async () => new Response(null, { status: 204 }), everyMs: 50, doc });
	c.cancel();
	await assert.rejects(c.promise, /cancelled/);
});
