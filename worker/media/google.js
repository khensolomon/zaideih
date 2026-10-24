/**
 * Sign in with Google (docs/accounts.md): OpenID Connect, authorization code
 * with PKCE, finished by the Worker, which holds the client secret.
 *
 *   GET  /auth/google/login     ?return=<page URL>&nonce=<n>&challenge=<PKCE S256>
 *                               Redirects to Google's sign-in.
 *   GET  /auth/google/callback  Google returns here; redirects to
 *                               <page URL>#/account?google=<code>&nonce=<n>,
 *                               or #/account?google-error=<message>.
 *   POST /auth/google/token     {code, verifier, link?} -> a Zaideih session,
 *                               as POST /auth/session answers it (accounts.js)
 *
 * Google's tokens are read once and never kept or given to the page: the ID
 * token comes straight from Google's token endpoint over TLS, which OpenID
 * Connect Core 3.1.3.7 accepts in place of checking its signature; its
 * issuer, audience and expiry are still checked. Only the person's Google id
 * (`sub`), name, and email with Google's word on whether it is verified are
 * used.
 *
 * Bindings: GOOGLE_CLIENT_ID (var), GOOGLE_CLIENT_SECRET (secret). Without
 * them these routes answer 503 naming what is missing.
 */
import { safePicture } from "./accounts.js";
import { MemberError } from "./members.js";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export function googleConfig(env) {
	const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((k) => !env[k]);
	if (missing.length) throw new MemberError(`Google sign-in is not set up on this Worker: missing ${missing.join(", ")}`, 503);
	return { clientId: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
}

/** Google's authorize address for a sign-in that returns to `callback` with `state`. */
export function googleAuthorizeUrl({ clientId, callback, state, challenge }) {
	const to = new URL(AUTHORIZE);
	to.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callback,
		response_type: "code",
		scope: "openid email profile",
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
		prompt: "select_account",
	});
	return to.href;
}

const b64urlJson = (part) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));

/** The person in an ID token from Google's token endpoint, checked; as signIn() takes it (accounts.js). */
export function googleIdentity(idToken, clientId, nowSeconds) {
	let claims;
	try {
		claims = b64urlJson(String(idToken).split(".")[1]);
	} catch {
		throw new MemberError("Google answered with an ID token that cannot be read", 502);
	}
	if (!ISSUERS.has(claims.iss)) throw new MemberError(`the ID token is not from Google (${claims.iss})`, 502);
	const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!aud.includes(clientId)) throw new MemberError("the ID token is for another application", 502);
	if (!(claims.exp > nowSeconds)) throw new MemberError("the ID token has expired; sign in again", 401);
	if (typeof claims.sub !== "string" || !claims.sub) throw new MemberError("the ID token names nobody", 502);
	const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
	return {
		provider: "google",
		subject: claims.sub,
		login: null,
		name: (typeof claims.name === "string" && claims.name.trim()) || email?.split("@")[0] || "Google user",
		fullName: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
		picture: safePicture(claims.picture),
		email,
		emailVerified: Boolean(email) && claims.email_verified === true,
	};
}

/** Exchanges the code for the person, at Google's token endpoint. */
export async function googleExchange({ clientId, secret }, { code, verifier, callback }, fetchImpl, nowSeconds) {
	const res = await fetchImpl(TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: callback, grant_type: "authorization_code", code_verifier: verifier }),
	});
	const answer = await res.json().catch(() => null);
	if (!res.ok || !answer?.id_token) {
		const why = answer?.error_description ?? answer?.error ?? `HTTP ${res.status}`;
		throw new MemberError(`Google did not sign you in: ${why}`, res.status >= 500 ? 502 : 400);
	}
	return googleIdentity(answer.id_token, clientId, nowSeconds);
}
