/**
 * Sign in with GitHub for the Workspace, finished by the audio Worker's
 * /auth routes (worker/media/auth.js), which hold the GitHub App's secret.
 *
 *   1. start(): a PKCE verifier and a nonce are kept for this tab
 *      (sessionStorage), and the page goes to <auth>/login, which sends the
 *      browser on to GitHub.
 *   2. GitHub returns to the Worker, which returns to #/workspace?signin=<code>&nonce=<n>.
 *   3. finish(): the nonce must match this tab's; the code and verifier are
 *      exchanged at <auth>/token for an access token (8 hours) and a refresh
 *      token (6 months), kept on this device (localStorage).
 *   4. token(): the access token, renewed at <auth>/refresh when it has less
 *      than RENEW_MS left.
 *
 * Pure apart from the injected fetch and storage: tested in Node (tests/workspace.test.mjs).
 */
import { SESSION_KEY } from "../core/access.js";

export { SESSION_KEY };
export const PENDING_KEY = "zaideih.workspace.signin";
const RENEW_MS = 5 * 60_000;

export class SignInError extends Error {}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** The PKCE S256 challenge of a verifier. */
export async function challengeOf(verifier) {
	return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/**
 * @param {{ authUrl: string, local: Storage, tab: Storage, fetchImpl?: typeof fetch, now?: () => number }} options
 */
export function createSession({ authUrl, local, tab, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
	const read = (store, key) => {
		try { return JSON.parse(store.getItem(key) ?? "null"); } catch { return null; }
	};
	const write = (store, key, value) => {
		if (value === null) store.removeItem(key);
		else store.setItem(key, JSON.stringify(value));
	};

	async function call(path, body) {
		let res;
		try {
			res = await fetchImpl(`${authUrl}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
		} catch (err) {
			throw Object.assign(new SignInError(`the sign-in service could not be reached (${err.message})`), { passing: true });
		}
		if (res.status === 204) return null;
		let answer = null;
		try { answer = await res.json(); } catch { /* reported below */ }
		// A refusal (4xx) is final; the service down or busy (5xx) passes, and the sign-in is kept.
		if (!res.ok) throw Object.assign(new SignInError(answer?.error ?? `the sign-in service answered HTTP ${res.status}`), { passing: res.status >= 500 });
		return answer;
	}

	const keep = (t) => {
		write(local, SESSION_KEY, t);
		return t;
	};

	let renewing = null;

	return {
		/** True when this device holds a sign-in that has not run out. */
		get signedIn() {
			const t = read(local, SESSION_KEY);
			if (!t?.access_token) return false;
			const live = (at) => at === null || at === undefined || at > now();
			return live(t.expires_at) || (Boolean(t.refresh_token) && live(t.refresh_expires_at));
		},

		/**
		 * The address to go to for signing in (also keeps this tab's verifier
		 * and nonce); GitHub returns to #/<to> (workspace, or account), or with
		 * `wait`, leaves the code at the Worker for this page to take (core/account.js waitForSignIn).
		 */
		async start(returnTo, { to = "workspace", wait = false } = {}) {
			if (!authUrl) throw new SignInError("sign-in with GitHub is not built into this version");
			const verifier = random();
			const nonce = random();
			write(tab, PENDING_KEY, { verifier, nonce });
			const q = new URLSearchParams({ return: returnTo, nonce, challenge: await challengeOf(verifier), to, ...(wait ? { wait: "1" } : {}) });
			return `${authUrl}/login?${q}`;
		},

		/** Exchanges the code GitHub returned; refuses a code this tab did not ask for. */
		async finish({ code, nonce }) {
			const pending = read(tab, PENDING_KEY);
			write(tab, PENDING_KEY, null);
			if (!pending || pending.nonce !== nonce) throw new SignInError("this sign-in was not started from this tab; sign in again");
			return keep(await call("token", { code, verifier: pending.verifier }));
		},

		/** The access token, renewed first when it is about to run out. */
		async token() {
			const t = read(local, SESSION_KEY);
			if (!t?.access_token) throw new SignInError("not signed in");
			if (t.expires_at === null || t.expires_at === undefined || t.expires_at - now() > RENEW_MS) return t.access_token;
			if (!t.refresh_token || (t.refresh_expires_at && t.refresh_expires_at <= now())) {
				write(local, SESSION_KEY, null);
				throw new SignInError("the GitHub sign-in has run out; sign in again");
			}
			// One renewal at a time: parallel calls share it.
			renewing ??= call("refresh", { refresh_token: t.refresh_token })
				.then(keep, (err) => {
					// Offline, or the service down a moment: kept, and renewed on the next try.
					if (err.passing) throw new SignInError(`the GitHub sign-in could not be renewed just now (${err.message}); try again in a moment`);
					write(local, SESSION_KEY, null);
					throw new SignInError(`the GitHub sign-in could not be renewed (${err.message}); sign in again`);
				})
				.finally(() => { renewing = null; });
			return (await renewing).access_token;
		},

		/** Forgets the sign-in on this device and revokes the token at GitHub. */
		async signOut() {
			const t = read(local, SESSION_KEY);
			write(local, SESSION_KEY, null);
			if (t?.access_token) await call("signout", { access_token: t.access_token });
		},
	};
}
