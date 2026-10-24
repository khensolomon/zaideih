/**
 * The Zaideih session on this device (docs/accounts.md): what the audio
 * Worker's own routes (personal libraries) accept, instead of a GitHub token.
 *
 * It is got from the GitHub sign-in (or the fine-grained token) at
 * <auth>/session when first needed, kept in localStorage with the GitHub
 * login it was got for, and dropped when that login is no longer the one
 * signed in, or when the Worker refuses it (then it is got once more).
 *
 * Pure apart from the injected fetch and storage: tested in Node (tests/account.test.mjs).
 */
import { readWho, TOKEN_KEY } from "./access.js";

export const ACCOUNT_KEY = "zaideih.account";

export class AccountError extends Error {}

/**
 * @param {{ authUrl: string, local: Storage, githubToken: () => Promise<string>, fetchImpl?: typeof fetch }} options
 *   githubToken answers the GitHub sign-in's current token (src/admin/session.js)
 */
export function createAccount({ authUrl, local, githubToken, fetchImpl = (...a) => fetch(...a) }) {
	const read = () => {
		try { return JSON.parse(local.getItem(ACCOUNT_KEY) ?? "null"); } catch { return null; }
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
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

	let getting = null;

	const account = {
		/** The session token, got first when this device has none for the person signed in. */
		async token() {
			const gh = github();
			if (!gh) { write(null); throw new AccountError("sign in with GitHub on the admin page first"); }
			const kept = read();
			if (kept?.token && kept.for === gh.login && kept.expires_at > Date.now()) return kept.token;
			// One exchange at a time: parallel calls share it.
			getting ??= gh.token()
				.then((t) => post("session", t))
				.then((s) => { write({ token: s.token, expires_at: s.expires_at, member: s.member, for: gh.login }); return s.token; })
				.finally(() => { getting = null; });
			return getting;
		},

		/** The member this device's session is for: { id, name }, or null. */
		get member() {
			return read()?.member ?? null;
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
