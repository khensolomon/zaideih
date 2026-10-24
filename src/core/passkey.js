/**
 * The browser's side of passkeys (docs/accounts.md): making one, and using
 * one to sign in, with the options the audio Worker gave (worker/media/
 * passkeys.js). The Worker's challenge is fetched before the tap (core/
 * account.js passkeyOptions): Safari lets a page ask for a passkey only in
 * direct answer to a tap, so nothing may be waited for in between.
 */
import { AccountError } from "./account.js";

const toBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const toText = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** True where this browser can make and use passkeys. */
export const passkeysAvailable = () => typeof globalThis.PublicKeyCredential === "function" && typeof globalThis.navigator?.credentials?.create === "function";

/** The browser's refusals, in words; cancelling is AccountError("cancelled"). */
function why(err) {
	if (err?.name === "NotAllowedError" || err?.name === "AbortError") return new AccountError("cancelled");
	if (err?.name === "InvalidStateError") return new AccountError("this device already has a passkey for your account");
	if (err?.name === "SecurityError") return new AccountError(`passkeys do not work on ${location.host}`);
	return new AccountError(`the passkey did not work (${err?.message ?? err})`);
}

/** Makes a passkey on this device: answers what /auth/passkey/register takes. */
export async function makePasskey(opts) {
	let cred;
	try {
		cred = await navigator.credentials.create({
			publicKey: {
				challenge: toBytes(opts.challenge),
				rp: opts.rp,
				user: { id: toBytes(opts.user.id), name: opts.user.name, displayName: opts.user.displayName },
				pubKeyCredParams: opts.algorithms.map((alg) => ({ type: "public-key", alg })),
				authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
				attestation: "none",
				excludeCredentials: opts.exclude.map((id) => ({ type: "public-key", id: toBytes(id) })),
				timeout: opts.timeout,
			},
		});
	} catch (err) {
		throw why(err);
	}
	return { id: cred.id, clientDataJSON: toText(cred.response.clientDataJSON), attestationObject: toText(cred.response.attestationObject) };
}

/** Signs in with a passkey of this device (or one shared through the person's password manager). */
export async function usePasskey(opts) {
	let cred;
	try {
		cred = await navigator.credentials.get({ publicKey: { challenge: toBytes(opts.challenge), rpId: opts.rpId, userVerification: "required", timeout: opts.timeout } });
	} catch (err) {
		throw why(err);
	}
	return {
		id: cred.id,
		clientDataJSON: toText(cred.response.clientDataJSON),
		authenticatorData: toText(cred.response.authenticatorData),
		signature: toText(cred.response.signature),
	};
}
