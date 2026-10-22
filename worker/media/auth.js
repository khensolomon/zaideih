/**
 * Sign in with GitHub for the admin page (src/admin), through the GitHub App
 * "Zaideih" (client id GITHUB_CLIENT_ID). GitHub's token endpoint needs the
 * App's client secret, which cannot live in a public page, so these routes
 * finish the sign-in; the Worker keeps no sessions and stores nothing.
 *
 * Routes (under /auth):
 *   GET  /auth/login     ?return=<page URL>&nonce=<n>&challenge=<PKCE S256>
 *                        Redirects to GitHub's authorize page.
 *   GET  /auth/callback  GitHub returns here with ?code&state (or ?error).
 *                        Redirects to <page URL>#/admin?signin=<code>&nonce=<n>,
 *                        or #/admin?signin-error=<message>.
 *   POST /auth/token     {"code", "verifier"}  -> tokens (see tokenAnswer)
 *   POST /auth/refresh   {"refresh_token"}     -> tokens
 *   POST /auth/signout   {"access_token"}      -> 204; revokes the token at GitHub
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

const GITHUB = "https://github.com";
const API = "https://api.github.com";
const USER_AGENT = "zaideih-media-worker";
const MAX_BODY = 4096;
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
		throw new AuthError("return must be the admin page's URL");
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

async function readJson(request) {
	const text = await request.text();
	if (text.length > MAX_BODY) throw new AuthError("request body too large", 413);
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
				headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" },
			});
		}

		if (route === "/auth/login" && request.method === "GET") {
			const back = returnUrl(url.searchParams.get("return"), cfg.origins);
			const nonce = url.searchParams.get("nonce") ?? "";
			const challenge = url.searchParams.get("challenge") ?? "";
			if (!TOKENISH.test(nonce) || !TOKENISH.test(challenge)) throw new AuthError("nonce and challenge must be base64url, 43 to 128 characters");
			const to = new URL(`${GITHUB}/login/oauth/authorize`);
			to.search = new URLSearchParams({
				client_id: cfg.clientId,
				redirect_uri: `${url.origin}/auth/callback`,
				state: b64url.encode(JSON.stringify({ r: back, n: nonce })),
				code_challenge: challenge,
				code_challenge_method: "S256",
			});
			return redirect(to.href);
		}

		if (route === "/auth/callback" && request.method === "GET") {
			let state;
			try {
				state = JSON.parse(b64url.decode(url.searchParams.get("state") ?? ""));
			} catch {
				throw new AuthError("the sign-in state is missing or damaged; start again from the admin page");
			}
			const back = returnUrl(state?.r, cfg.origins);
			const code = url.searchParams.get("code");
			const answer = code && TOKENISH.test(state.n ?? "")
				? new URLSearchParams({ signin: code, nonce: state.n })
				: new URLSearchParams({ "signin-error": url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "GitHub returned no code" });
			return redirect(`${back}#/admin?${answer}`);
		}

		if (request.method !== "POST" || !["/auth/token", "/auth/refresh", "/auth/signout"].includes(route)) {
			return new Response("Not Found", { status: 404 });
		}
		// Tokens are answered to the admin page's origins only.
		if (!cors) throw new AuthError("this origin may not use sign-in (AUTH_ORIGINS)", 403);
		const body = await readJson(request);

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
		if (!(err instanceof AuthError)) {
			console.error("auth failed", { route, err });
			return json(500, { error: "sign-in failed on the Worker" }, cors);
		}
		// Browser navigations get a readable page; the admin page's calls get JSON.
		if (request.method === "GET") return new Response(`Sign-in: ${err.message}`, { status: err.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
		return json(err.status, { error: err.message }, cors);
	}
}
