/**
 * The Zaideih session on this device (docs/accounts.md): what the audio
 * Worker's own routes (personal libraries) accept, instead of a GitHub token.
 *
 * It comes from one of two places, and is kept in localStorage with where
 * it came from (`via`):
 *   google      Sign in with Google (google.start(), then google.finish()
 *               on the account page Google returns to)
 *   github:<l>  the GitHub sign-in of login <l> (or the fine-grained token),
 *               exchanged at <auth>/session when first needed; dropped when
 *               another GitHub login is signed in on the device
 * A session the Worker refuses is dropped and, from GitHub, got once more.
 *
 * Pure apart from the injected fetch and storage: tested in Node (tests/account.test.mjs).
 */
import { readWho, TOKEN_KEY } from "./access.js";

export const ACCOUNT_KEY = "zaideih.account";
export const GOOGLE_PENDING_KEY = "zaideih.account.google";

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const challengeOf = async (verifier) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

export class AccountError extends Error {}

/**
 * True in an app added to the home screen. Its sign-in opens in a browser
 * sheet that cannot hand the result back to the app, so the app takes the
 * code from the Worker instead (waitForSignIn).
 */
export const homeScreenApp = () => globalThis.matchMedia?.("(display-mode: standalone)").matches === true || globalThis.navigator?.standalone === true;

/**
 * Waits for a sign-in started with `wait` to come back: asks the Worker
 * (POST <auth>/wait) every `everyMs`, and at once when the app is shown
 * again, until it answers the code or an error, or `timeoutMs` passes.
 * Answers { promise (the code), cancel() }.
 */
export function waitForSignIn({ authUrl, nonce, fetchImpl = (...a) => fetch(...a), everyMs = 2000, timeoutMs = 600_000, doc = globalThis.document, now = () => Date.now() }) {
	let cancel;
	const promise = new Promise((resolve, reject) => {
		let timer = 0;
		let done = false;
		const deadline = now() + timeoutMs;
		const end = (fn, value) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			doc?.removeEventListener?.("visibilitychange", onShow);
			fn(value);
		};
		const check = async () => {
			clearTimeout(timer);
			if (done) return;
			try {
				const res = await fetchImpl(`${authUrl}/wait`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce }), cache: "no-store" });
				if (res.status === 200) {
					const a = await res.json();
					return a.code ? end(resolve, a.code) : end(reject, new AccountError(`not signed in: ${a.error}`));
				}
				if (res.status !== 204) {
					const a = await res.json().catch(() => null);
					return end(reject, new AccountError(a?.error ?? `the sign-in service answered HTTP ${res.status}`));
				}
			} catch { /* offline for a moment: asked again below */ }
			if (now() > deadline) return end(reject, new AccountError("the sign-in was not finished in time; try again"));
			if (!done) timer = setTimeout(check, everyMs);
		};
		function onShow() { if (doc.visibilityState === "visible") check(); }
		doc?.addEventListener?.("visibilitychange", onShow);
		cancel = () => end(reject, new AccountError("cancelled"));
		timer = setTimeout(check, everyMs);
	});
	return { promise, cancel: () => cancel() };
}

/**
 * @param {{ authUrl: string, local: Storage, tab?: Storage, githubToken: () => Promise<string>, fetchImpl?: typeof fetch, now?: () => number }} options
 *   githubToken answers the GitHub sign-in's current token (src/workspace/session.js);
 *   tab (sessionStorage) keeps a Google sign-in's verifier while Google is open
 */
export function createAccount({ authUrl, local, tab = null, githubToken, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
	const read = () => {
		let v = null;
		try { v = JSON.parse(local.getItem(ACCOUNT_KEY) ?? "null"); } catch { /* none */ }
		if (!v?.token) return null;
		// Kept before Google sign-in existed: { for: <GitHub login> }.
		if (!v.via && v.for) v.via = `github:${v.for}`;
		return v;
	};
	const write = (value) => {
		try {
			if (value === null) local.removeItem(ACCOUNT_KEY);
			else local.setItem(ACCOUNT_KEY, JSON.stringify(value));
		} catch { /* this visit only: got again next time */ }
	};

	async function post(path, token, body = {}) {
		let res;
		try {
			res = await fetchImpl(`${authUrl}/${path}`, {
				method: "POST",
				headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
				body: JSON.stringify(body),
				cache: "no-store",
			});
		} catch (err) {
			throw new AccountError(`the sign-in service could not be reached (${err.message})`);
		}
		if (res.status === 204) return null;
		const answer = await res.json().catch(() => null);
		if (!res.ok) throw new AccountError(answer?.error ?? `the sign-in service answered HTTP ${res.status}`);
		return answer;
	}

	/** The GitHub sign-in this device has, or null. */
	function github() {
		const who = readWho(local);
		if (!who) return null;
		if (who.via === "token") {
			const token = JSON.parse(local.getItem(TOKEN_KEY) ?? "null");
			return token ? { login: who.login, token: async () => token } : null;
		}
		return { login: who.login, token: githubToken };
	}

	const keep = (s, via) => {
		write({ token: s.token, expires_at: s.expires_at, member: s.member, via });
		return s;
	};
	/** The kept session when it is still the one to use: live, and not another GitHub login's. */
	const current = () => {
		const kept = read();
		if (!kept || kept.expires_at <= now()) return null;
		const gh = github();
		if (gh && kept.via.startsWith("github:") && kept.via !== `github:${gh.login}`) return null;
		return kept;
	};

	let getting = null;

	const account = {
		/** The session token, got from the GitHub sign-in first when this device has none. */
		async token() {
			const kept = current();
			if (kept) return kept.token;
			const gh = github();
			if (!gh) { write(null); throw new AccountError("sign in first (Account)"); }
			// One exchange at a time: parallel calls share it.
			getting ??= gh.token()
				.then((t) => post("session", t))
				.then((s) => keep(s, `github:${gh.login}`).token)
				.finally(() => { getting = null; });
			return getting;
		},

		/** True when this device is signed in: a session, or a GitHub sign-in to get one from. */
		get signedIn() {
			return Boolean(current() || github());
		},

		/** Who is signed in, as a short key that changes when someone else signs in (for refreshing what is shown). */
		get key() {
			const kept = current();
			// A GitHub login names its person already; a Google session is named by its member.
			if (kept) return kept.via.startsWith("github:") ? kept.via : `${kept.via}:${kept.member?.id ?? ""}`;
			const gh = github();
			return gh ? `github:${gh.login}` : "";
		},

		/** The member this device's session is for: { id, name }, or null. */
		get member() {
			return current()?.member ?? null;
		},

		/**
		 * After a GitHub sign-in on the account page: a session for it, added
		 * to the signed-in account with `link` (Add GitHub).
		 */
		async fromGitHub({ link = false } = {}) {
			const gh = github();
			if (!gh) throw new AccountError("the GitHub sign-in did not finish; try again");
			const linkTo = link ? current()?.token : null;
			const s = await post("session", await gh.token(), linkTo ? { link: linkTo } : {});
			return keep(s, `github:${gh.login}`);
		},

		google: {
			/**
			 * The address to go to for signing in with Google; `link` adds Google
			 * to the signed-in account; `wait` leaves the code at the Worker (waitForSignIn).
			 */
			async start(returnTo, { link = false, wait = false } = {}) {
				if (!authUrl) throw new AccountError("sign-in is not built into this version");
				if (!tab) throw new AccountError("Google sign-in needs a browser tab");
				const verifier = random();
				const nonce = random();
				tab.setItem(GOOGLE_PENDING_KEY, JSON.stringify({ verifier, nonce, link }));
				return `${authUrl}/google/login?${new URLSearchParams({ return: returnTo, nonce, challenge: await challengeOf(verifier), ...(wait ? { wait: "1" } : {}) })}`;
			},
			/** Back from Google: the code for a session; refuses a code this tab did not ask for. */
			async finish({ code, nonce }) {
				let pending = null;
				try { pending = JSON.parse(tab?.getItem(GOOGLE_PENDING_KEY) ?? "null"); } catch { /* none */ }
				tab?.removeItem(GOOGLE_PENDING_KEY);
				if (!pending || pending.nonce !== nonce) throw new AccountError("this sign-in was not started from this tab; sign in again");
				const linkTo = pending.link ? current()?.token : null;
				const s = await post("google/token", null, { code, verifier: pending.verifier, ...(linkTo ? { link: linkTo } : {}) });
				// Added to an account signed in with GitHub: the session stays tied to that login.
				const via = linkTo && read()?.via.startsWith("github:") ? read().via : "google";
				return keep(s, via);
			},
		},

		/** What the browser needs to make ("create", signed in) or use ("get") a passkey; fetched before the tap (core/passkey.js). */
		async passkeyOptions(kind) {
			return post("passkey/options", kind === "create" ? await account.token() : null, { kind });
		},

		/** Adds a passkey made on this device to the account: answers { member, logins }. */
		async addPasskey(made) {
			return post("passkey/register", await account.token(), made);
		},

		/** Signs in with a passkey: the account's session is kept for this device. */
		async signInWithPasskey(used) {
			return keep(await post("passkey/signin", null, used), "passkey");
		},

		/** The signed-in member and their sign-ins: { member, logins }. */
		async me() {
			const res = await account.send((t) => fetchImpl(`${authUrl}/me`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}", cache: "no-store" }));
			const answer = await res.json().catch(() => null);
			if (!res.ok) throw new AccountError(answer?.error ?? `the sign-in service answered HTTP ${res.status}`);
			return answer;
		},

		/** Removes one of the member's sign-ins; answers { member, logins }. */
		async removeLogin(provider, subject) {
			return post("logins/remove", await account.token(), { provider, subject });
		},

		/**
		 * Runs `send(token)` (a fetch), and once more with a new session when
		 * the Worker answers 401 (signed out elsewhere, run out). Answers the response.
		 */
		async send(send) {
			const res = await send(await account.token());
			if (res.status !== 401) return res;
			write(null);
			return send(await account.token());
		},

		/** Signs this device's session out at the Worker and forgets it. */
		async signOut() {
			const kept = read();
			write(null);
			if (kept?.token) await post("session/end", kept.token);
		},
	};
	return account;
}
