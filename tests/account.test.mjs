import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_KEY, createAccount } from "../src/core/account.js";
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
	await assert.rejects(createAccount({ authUrl: "x", local: memory(), githubToken: async () => "" }).token(), /sign in with GitHub on the admin page first/);
});
