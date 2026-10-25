/**
 * Sign in with GitHub for the Workspace (src/workspace), through the GitHub App
 * "Zaideih" (client id GITHUB_CLIENT_ID). GitHub's token endpoint needs the
 * App's client secret, which cannot live in a public page, so these routes
 * finish the sign-in. The GitHub tokens stay on the device; a GitHub token
 * is exchanged for a Zaideih session (accounts.js) for everything that is
 * Zaideih's own (personal libraries).
 *
 * Routes (under /auth):
 *   GET  /auth/login     ?return=<page URL>&nonce=<n>&challenge=<PKCE S256>[&to=account]
 *                        Redirects to GitHub's authorize page.
 *   GET  /auth/callback  GitHub returns here with ?code&state (or ?error).
 *                        Redirects to <page URL>#/<to>?signin=<code>&nonce=<n>,
 *                        or #/<to>?signin-error=<message>; <to> is workspace
 *                        or account ("admin", the default, for older app builds).
 *   POST /auth/token     {"code", "verifier"}  -> tokens (see tokenAnswer)
 *   POST /auth/refresh   {"refresh_token"}     -> tokens
 *   POST /auth/signout   {"access_token"}      -> 204; revokes the token at GitHub
 *   POST /auth/suggest   a suggestion from someone without write access (suggest.js)
 *   POST /auth/session   a GitHub token for a Zaideih session (accounts.js)
 *   POST /auth/session/end  signs a Zaideih session out (accounts.js)
 *   POST /auth/me, /auth/logins/remove  the signed-in member's sign-ins (accounts.js)
 *   POST /auth/passkey/options, /register, /signin  passkeys (passkeys.js)
 *   POST /auth/wait      {nonce} -> {code} | {error} | 204: the end of a sign-in
 *                        started with wait=1 (see waitPage)
 *   GET  /auth/google/login, /auth/google/callback, POST /auth/google/token
 *                        Sign in with Google (google.js)
 *   OPTIONS              CORS preflight for AUTH_ORIGINS.
 *
 * Security:
 *   - The page returned to must be on an origin in AUTH_ORIGINS, checked at
 *     login and again at the callback (state is not trusted), so the Worker
 *     never redirects anywhere else.
 *   - PKCE: the code is useless without the verifier, which never leaves the
 *     page that started the sign-in; the nonce lets that page refuse a code it
 *     did not ask for. The code travels in the URL fragment, which browsers do
 *     not send to servers.
 *   - Tokens are only ever returned in a CORS response to AUTH_ORIGINS.
 *   - What a token may do is what both the App and the user may do on the
 *     repository; GitHub enforces it, so merging still needs write access.
 *
 * Bindings (wrangler.toml): GITHUB_CLIENT_ID and AUTH_ORIGINS (vars),
 * GITHUB_CLIENT_SECRET (secret).
 */

import { suggest, SuggestError } from "./suggest.js";
import { handleSession, issueSession, sessionMember } from "./accounts.js";
import { googleAuthorizeUrl, googleConfig, googleExchange } from "./google.js";
import { handlePasskey } from "./passkeys.js";
import { MemberError } from "./members.js";

const GITHUB = "https://github.com";
const API = "https://api.github.com";
const USER_AGENT = "zaideih-media-worker";
const MAX_BODY = 4096;
const MAX_SUGGEST_BODY = 20 * 1024 * 1024;
// Pages a sign-in may return to (#/<to>).
// "admin": the Workspace's earlier address, still asked for by app builds before 26.10.25.6 (the app forwards it).
const RETURN_ROUTES = new Set(["workspace", "admin", "account"]);
// Base64url, 43 to 128 characters (RFC 7636 for the challenge; the nonce uses the same shape).
const TOKENISH = /^[A-Za-z0-9_-]{43,128}$/;

export class AuthError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

const listOf = (value) => new Set(String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean));

function config(env) {
	const missing = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "AUTH_ORIGINS"].filter((k) => !env[k]);
	if (missing.length) throw new AuthError(`sign-in is not set up on this Worker: missing ${missing.join(", ")}`, 503);
	return { clientId: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET, origins: listOf(env.AUTH_ORIGINS) };
}

/** The page URL to return to, when its origin is allowed; throws otherwise. */
export function returnUrl(value, origins) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new AuthError("return must be the Workspace's URL");
	}
	if (!origins.has(url.origin)) throw new AuthError(`${url.origin} may not sign in here (AUTH_ORIGINS)`, 403);
	return `${url.origin}${url.pathname}`;
}

const b64url = {
	encode: (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
	decode: (text) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))),
};

function redirect(location) {
	return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

function json(status, body, origin) {
	const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" });
	if (origin) headers.set("Access-Control-Allow-Origin", origin);
	return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

/** The answer to the page: the tokens with absolute expiry times (unix ms), or GitHub's own error. */
export function tokenAnswer(github, now = Date.now()) {
	if (github.error) throw new AuthError(`GitHub: ${github.error_description ?? github.error}`, 400);
	if (!github.access_token) throw new AuthError("GitHub answered without a token", 502);
	return {
		access_token: github.access_token,
		expires_at: github.expires_in ? now + github.expires_in * 1000 : null,
		refresh_token: github.refresh_token ?? null,
		refresh_expires_at: github.refresh_token_expires_in ? now + github.refresh_token_expires_in * 1000 : null,
	};
}

async function readJson(request, limit = MAX_BODY) {
	const text = await request.text();
	if (text.length > limit) throw new AuthError("request body too large", 413);
	try {
		const body = JSON.parse(text);
		if (body && typeof body === "object") return body;
	} catch { /* reported below */ }
	throw new AuthError("body must be a JSON object");
}

async function githubToken(fetchImpl, params) {
	const res = await fetchImpl(`${GITHUB}/login/oauth/access_token`, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
		body: JSON.stringify(params),
	});
	if (!res.ok) throw new AuthError(`GitHub token endpoint: HTTP ${res.status}`, 502);
	return res.json();
}

/* ------------------------------------------------- signing in from an app ---- */

// How long a code waits for the app that asked for it.
const WAIT_S = 600;

const sha256 = async (text) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))));

/**
 * The end of a sign-in started with wait=1: keeps the code (or the error)
 * for the app, under a hash of the sign-in's nonce, and tells the person to
 * go back to the app. Only the app that started the sign-in knows the nonce
 * to fetch the code, and only it holds the PKCE verifier the code needs.
 */
async function waitPage(env, { nonce, code, error, nowSeconds }) {
	if (!env.DB) throw new AuthError("signing in from the app is not set up on this Worker: missing the D1 binding DB", 503);
	await env.DB.prepare("DELETE FROM signin_waiting WHERE created_at < ?1").bind(nowSeconds - WAIT_S).run();
	await env.DB.prepare("INSERT OR REPLACE INTO signin_waiting (nonce_hash, code, error, created_at) VALUES (?1, ?2, ?3, ?4)").bind(await sha256(nonce), code, error, nowSeconds).run();
	const say = error ? `Not signed in: ${error}` : "Signed in.";
	const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
	return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Zaideih</title>
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:8px;padding:24px;text-align:center;background:#5a5a5a;color:#fff;font:18px/1.5 system-ui,-apple-system,sans-serif}h1{font-size:24px;margin:0}p{margin:0;color:#e6e6e6}</style></head>
<body><h1>${esc(say)}</h1><p>Close this window and go back to Zaideih${error ? " to try again" : "; it finishes there"}.</p></body></html>`, {
		status: error ? 400 : 200,
		headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
	});
}

/** The code (or error) kept for this nonce, once: { code } | { error } | null while the sign-in has not come back. */
async function takeWaiting(env, nonce, nowSeconds) {
	const hash = await sha256(nonce);
	const row = await env.DB.prepare("SELECT code, error, created_at FROM signin_waiting WHERE nonce_hash = ?1").bind(hash).first();
	if (!row) return null;
	await env.DB.prepare("DELETE FROM signin_waiting WHERE nonce_hash = ?1").bind(hash).run();
	if (row.created_at < nowSeconds - WAIT_S) return { error: "the sign-in took too long; try again" };
	return row.error ? { error: row.error } : { code: row.code };
}

/**
 * Handles /auth/*. `fetchImpl` is for tests.
 * @param {Request} request
 */
export async function handleAuth(request, env, { fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const route = url.pathname.replace(/\/+$/, "");
	const origin = request.headers.get("origin");
	let cfg;
	try {
		cfg = config(env);
	} catch (err) {
		return json(err.status, { error: err.message }, null);
	}
	const cors = origin && cfg.origins.has(origin) ? origin : null;

	try {
		if (request.method === "OPTIONS") {
			if (!cors) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
			return new Response(null, {
				status: 204,
				headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" },
			});
		}

		const google = route.startsWith("/auth/google/");
		if ((route === "/auth/login" || route === "/auth/google/login") && request.method === "GET") {
			const back = returnUrl(url.searchParams.get("return"), cfg.origins);
			const nonce = url.searchParams.get("nonce") ?? "";
			const challenge = url.searchParams.get("challenge") ?? "";
			if (!TOKENISH.test(nonce) || !TOKENISH.test(challenge)) throw new AuthError("nonce and challenge must be base64url, 43 to 128 characters");
			const page = google ? "account" : url.searchParams.get("to") ?? "admin";
			if (!RETURN_ROUTES.has(page)) throw new AuthError(`to must be one of ${[...RETURN_ROUTES].join(", ")}`);
			// wait=1: the app cannot be returned to (an app added to the home screen, whose sign-in opens in a browser sheet); the callback keeps the code for it (waitPage).
			const wait = url.searchParams.get("wait") === "1";
			const state = b64url.encode(JSON.stringify({ r: back, n: nonce, t: page, ...(wait ? { w: 1 } : {}) }));
			if (google) {
				let g;
				try { g = googleConfig(env); } catch (err) { throw new AuthError(err.message, err.status); }
				return redirect(googleAuthorizeUrl({ clientId: g.clientId, callback: `${url.origin}/auth/google/callback`, state, challenge }));
			}
			const to = new URL(`${GITHUB}/login/oauth/authorize`);
			to.search = new URLSearchParams({
				client_id: cfg.clientId,
				redirect_uri: `${url.origin}/auth/callback`,
				state,
				code_challenge: challenge,
				code_challenge_method: "S256",
			});
			return redirect(to.href);
		}

		if ((route === "/auth/callback" || route === "/auth/google/callback") && request.method === "GET") {
			let state;
			try {
				state = JSON.parse(b64url.decode(url.searchParams.get("state") ?? ""));
			} catch {
				throw new AuthError("the sign-in state is missing or damaged; start again from the page you signed in on");
			}
			const back = returnUrl(state?.r, cfg.origins);
			const page = RETURN_ROUTES.has(state.t) ? state.t : "admin";
			const key = google ? "google" : "signin";
			const code = url.searchParams.get("code");
			const failed = code && TOKENISH.test(state.n ?? "") ? null : url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? `${google ? "Google" : "GitHub"} returned no code`;
			if (state.w === 1 && TOKENISH.test(state.n ?? "")) return waitPage(env, { nonce: state.n, code: failed ? null : code, error: failed, nowSeconds: Math.floor(now() / 1000) });
			const answer = failed ? new URLSearchParams({ [`${key}-error`]: failed }) : new URLSearchParams({ [key]: code, nonce: state.n });
			return redirect(`${back}#/${page}?${answer}`);
		}

		if (request.method !== "POST" || !["/auth/token", "/auth/refresh", "/auth/signout", "/auth/suggest", "/auth/session", "/auth/session/end", "/auth/me", "/auth/logins/remove", "/auth/google/token", "/auth/wait", "/auth/passkey/options", "/auth/passkey/register", "/auth/passkey/signin"].includes(route)) {
			return new Response("Not Found", { status: 404 });
		}
		// Tokens are answered to the Workspace's origins only.
		if (!cors) throw new AuthError("this origin may not use sign-in (AUTH_ORIGINS)", 403);
		const body = await readJson(request, route === "/auth/suggest" ? MAX_SUGGEST_BODY : MAX_BODY);
		if (route === "/auth/suggest") return json(201, await suggest(request, env, body, { fetchImpl, now }), cors);
		if (route.startsWith("/auth/passkey/")) {
			const nowSeconds = Math.floor(now() / 1000);
			const [status, answer] = await handlePasskey(env, route, body, { origin: cors, memberOf: () => sessionMember(env, request, nowSeconds), nowSeconds });
			return json(status, answer, cors);
		}
		if (route === "/auth/wait") {
			if (!TOKENISH.test(body.nonce ?? "")) throw new AuthError("expected {nonce}");
			const got = await takeWaiting(env, body.nonce, Math.floor(now() / 1000));
			return got ? json(200, got, cors) : json(204, null, cors);
		}
		if (route === "/auth/google/token") {
			if (typeof body.code !== "string" || !body.code || !TOKENISH.test(body.verifier ?? "")) throw new AuthError("expected {code, verifier}");
			const nowSeconds = Math.floor(now() / 1000);
			const who = await googleExchange(googleConfig(env), { code: body.code, verifier: body.verifier, callback: `${url.origin}/auth/google/callback` }, fetchImpl, nowSeconds);
			return json(200, await issueSession(env, who, body, nowSeconds), cors);
		}
		if (["/auth/session", "/auth/session/end", "/auth/me", "/auth/logins/remove"].includes(route)) {
			const [status, answer] = await handleSession(request, env, route, body, { fetchImpl, nowSeconds: Math.floor(now() / 1000) });
			return json(status, answer, cors);
		}

		if (route === "/auth/token") {
			if (typeof body.code !== "string" || !body.code || !TOKENISH.test(body.verifier ?? "")) throw new AuthError("expected {code, verifier}");
			const github = await githubToken(fetchImpl, {
				client_id: cfg.clientId,
				client_secret: cfg.secret,
				code: body.code,
				code_verifier: body.verifier,
				redirect_uri: `${url.origin}/auth/callback`,
			});
			return json(200, tokenAnswer(github, now()), cors);
		}
		if (route === "/auth/refresh") {
			if (typeof body.refresh_token !== "string" || !body.refresh_token) throw new AuthError("expected {refresh_token}");
			const github = await githubToken(fetchImpl, {
				client_id: cfg.clientId,
				client_secret: cfg.secret,
				grant_type: "refresh_token",
				refresh_token: body.refresh_token,
			});
			return json(200, tokenAnswer(github, now()), cors);
		}
		// signout
		if (typeof body.access_token !== "string" || !body.access_token) throw new AuthError("expected {access_token}");
		const res = await fetchImpl(`${API}/applications/${cfg.clientId}/token`, {
			method: "DELETE",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.secret}`)}`,
				"Content-Type": "application/json",
				"User-Agent": USER_AGENT,
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({ access_token: body.access_token }),
		});
		// 404: already revoked or expired, which is the wanted end state.
		if (!res.ok && res.status !== 404) throw new AuthError(`GitHub could not revoke the token: HTTP ${res.status}`, 502);
		return json(204, null, cors);
	} catch (err) {
		if (err instanceof SuggestError || err instanceof MemberError) return json(err.status, { error: err.message }, cors);
		if (!(err instanceof AuthError)) {
			console.error("auth failed", { route, err });
			return json(500, { error: "sign-in failed on the Worker" }, cors);
		}
		// Browser navigations get a readable page; the Workspace's calls get JSON.
		if (request.method === "GET") return new Response(`Sign-in: ${err.message}`, { status: err.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
		return json(err.status, { error: err.message }, cors);
	}
}
