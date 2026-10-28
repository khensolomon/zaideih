/**
 * One harness for the Worker's route tests: a fake GitHub that signs people
 * in by token (PEOPLE), the Worker's environment with its bindings faked
 * (fakes.mjs), a `signIn` that keeps one session per token, a `call` that
 * sends a JSON request as someone (or no one) to a handler, and a clock to
 * move. Each test file names its people and handler; the rest is the same.
 */
import { fakeD1, fakeR2, tokenCheck } from "./fakes.mjs";

export const W = "https://media.zaideih.com";
export const ORIGIN = "https://zaideih.com";
export const CLOCK = 1_800_000_000_000;

/** A fetch stand-in for GitHub: a token in `people` answers /user with that person; any other token is 401. */
export function fakeGitHub(people) {
	return async (url, init) => {
		const checked = tokenCheck(url, init);
		if (checked) return checked;
		const p = people[(init?.headers?.Authorization ?? "").replace("Bearer ", "")];
		if (!p) return new Response("{}", { status: 401 });
		return url.endsWith("/user") ? new Response(JSON.stringify(p)) : new Response("{}", { status: 403 });
	};
}

/** The Worker's environment: D1 and R2 faked, the owner GitHub id 1, `extra` on top. */
export function workerEnv(extra = {}) {
	return { DB: fakeD1(), BUCKET: fakeR2(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s", ...extra };
}

/**
 * The harness: { env, call, callWith, signIn, tick, now }. `handler(request,
 * env, ctx, options)` is the route handler under test (auth.js's handleAuth
 * signs people in). `call(who, method, path, body)` answers { status, body,
 * headers }; `callWith(handler, …)` the same with another handler. `tick(ms)`
 * moves the clock the handlers read through `now`. `ctxless` for a handler
 * taking (request, env, options) with no ctx (library.js).
 */
export function harness({ people, handler, handleAuth, env = workerEnv(), ctx = null, ctxless = false }) {
	const github = fakeGitHub(people);
	let clock = CLOCK;
	const now = () => clock;
	const sessions = {};
	const signIn = async (t, body = {}) => (sessions[t] ??= (await (await handleAuth(new Request(`${W}/auth/session`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, { fetchImpl: github, now })).json()));
	const callWith = async (h, who, method, path, body) => {
		const headers = { Origin: ORIGIN };
		if (who) headers.Authorization = `Bearer ${(await signIn(who)).token}`;
		if (body !== undefined) headers["Content-Type"] = "application/json";
		const request = new Request(`${W}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
		// library.js takes (request, env, { now }); the others (request, env, ctx, { now }).
		const res = await (ctxless ? h(request, env, { now }) : h(request, env, ctx, { now }));
		const text = await res.text();
		return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
	};
	return { env, github, signIn, callWith, call: (who, method, path, body) => callWith(handler, who, method, path, body), tick: (ms) => { clock += ms; }, now };
}
