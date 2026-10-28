/**
 * Passkeys (docs/accounts.md): signing in with the device's own lock (face,
 * fingerprint, PIN) through WebAuthn. A passkey is added to an account while
 * signed in, and then signs in to it alone.
 *
 * Routes (POST, under /auth, CORS for AUTH_ORIGINS, see auth.js):
 *   /auth/passkey/options   {kind: "create"} with the session, or {kind: "get"}
 *                           -> a challenge (single use, CHALLENGE_S) and what the
 *                           browser needs to make or use a passkey
 *   /auth/passkey/register  {id, clientDataJSON, attestationObject}, with the session
 *                           -> the member's sign-ins (as /auth/me)
 *   /auth/passkey/signin    {id, clientDataJSON, authenticatorData, signature}
 *                           -> a Zaideih session (as /auth/session)
 *
 * Checked on every use: the challenge is one this Worker gave for that kind
 * and has not been used; the page's origin is in AUTH_ORIGINS and the one
 * the browser reports; the relying party is the page's site (zaideih.com
 * for zaideih.com and its subdomains, the host itself otherwise); the user
 * was present and verified (face, fingerprint or PIN); and, signing in, the
 * signature over the authenticator data and the client data is the stored
 * public key's. Attestation is not asked for ("none"): which device made a
 * passkey is not Zaideih's concern. ES256 and RS256 keys are accepted.
 *
 * D1: passkeys (public keys), passkey_challenges; each passkey is also a
 * sign-in in member_logins (provider "passkey", subject its credential id).
 */
import { issueSession, me } from "./accounts.js";
import { MemberError } from "./members.js";

const CHALLENGE_S = 300;
const RP_NAME = "Zaideih";
const ES256 = -7;
const RS256 = -257;

/* -------------------------------------------------------------- bytes ---- */

export const b64url = {
	encode: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
	decode: (text) => {
		if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new MemberError("expected base64url");
		return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
	},
};

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * A minimal CBOR decoder (RFC 8949) for what WebAuthn sends: unsigned and
 * negative integers, byte and text strings, arrays, maps, and simple values.
 * Answers [value, offset after it].
 */
export function cbor(bytes, at = 0) {
	const head = bytes[at];
	if (head === undefined) throw new MemberError("the passkey's data ends too soon");
	const major = head >> 5;
	const info = head & 31;
	let pos = at + 1;
	let n;
	if (info < 24) n = info;
	else if (info === 24) { n = bytes[pos]; pos += 1; }
	else if (info === 25) { n = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; }
	else if (info === 26) { n = ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]; pos += 4; }
	else throw new MemberError("the passkey's data uses a CBOR form not expected here");
	switch (major) {
		case 0: return [n, pos];
		case 1: return [-1 - n, pos];
		case 2: return [bytes.slice(pos, pos + n), pos + n];
		case 3: return [new TextDecoder().decode(bytes.slice(pos, pos + n)), pos + n];
		case 4: {
			const out = [];
			for (let i = 0; i < n; i++) { const [v, next] = cbor(bytes, pos); out.push(v); pos = next; }
			return [out, pos];
		}
		case 5: {
			const out = new Map();
			for (let i = 0; i < n; i++) {
				const [k, afterKey] = cbor(bytes, pos);
				const [v, afterValue] = cbor(bytes, afterKey);
				out.set(k, v);
				pos = afterValue;
			}
			return [out, pos];
		}
		case 7: return [info === 20 ? false : info === 21 ? true : null, pos];
		default: throw new MemberError("the passkey's data uses a CBOR form not expected here");
	}
}

/** The authenticator data: { rpIdHash, flags, signCount, credentialId?, publicKey? (COSE map) }. */
export function authData(bytes) {
	if (bytes.length < 37) throw new MemberError("the passkey's authenticator data is too short");
	const out = {
		rpIdHash: bytes.slice(0, 32),
		flags: bytes[32],
		signCount: ((bytes[33] << 24) >>> 0) + (bytes[34] << 16) + (bytes[35] << 8) + bytes[36],
	};
	if (out.flags & 0x40) {
		const len = (bytes[53] << 8) | bytes[54];
		out.credentialId = bytes.slice(55, 55 + len);
		[out.publicKey] = cbor(bytes, 55 + len);
	}
	return out;
}

/** A COSE public key as a JWK WebCrypto imports, with its algorithm. */
export function coseKey(cose) {
	const alg = cose.get(3);
	if (alg === ES256 && cose.get(1) === 2 && cose.get(-1) === 1) {
		return { alg, jwk: { kty: "EC", crv: "P-256", x: b64url.encode(cose.get(-2)), y: b64url.encode(cose.get(-3)), ext: true } };
	}
	if (alg === RS256 && cose.get(1) === 3) {
		return { alg, jwk: { kty: "RSA", n: b64url.encode(cose.get(-1)), e: b64url.encode(cose.get(-2)), alg: "RS256", ext: true } };
	}
	throw new MemberError(`this passkey's key type (algorithm ${alg}) is not supported; ES256 and RS256 are`, 400);
}

/** An ECDSA signature in DER (as WebAuthn gives it) as the 64 raw bytes WebCrypto checks. */
export function derToRaw(der) {
	if (der[0] !== 0x30) throw new MemberError("the passkey's signature is not DER");
	let pos = 2;
	const part = () => {
		if (der[pos] !== 0x02) throw new MemberError("the passkey's signature is not DER");
		const len = der[pos + 1];
		let v = der.slice(pos + 2, pos + 2 + len);
		pos += 2 + len;
		while (v.length > 32 && v[0] === 0) v = v.slice(1);
		const out = new Uint8Array(32);
		out.set(v, 32 - v.length);
		return out;
	};
	const r = part();
	const s = part();
	const raw = new Uint8Array(64);
	raw.set(r, 0);
	raw.set(s, 32);
	return raw;
}

export async function verifySignature({ alg, jwk }, signature, data) {
	if (alg === ES256) {
		const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
		return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(signature), data);
	}
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
	return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
}

/* ---------------------------------------------------------------- site ---- */

/** The relying party for a page's origin: zaideih.com for it and its subdomains, the host otherwise. */
export function rpIdFor(origin) {
	const host = new URL(origin).hostname;
	return host === "zaideih.com" || host.endsWith(".zaideih.com") ? "zaideih.com" : host;
}

/* ----------------------------------------------------------- challenge ---- */

async function newChallenge(env, { kind, memberId, rpId, nowSeconds }) {
	await env.DB.prepare("DELETE FROM passkey_challenges WHERE created_at < ?1").bind(nowSeconds - CHALLENGE_S).run();
	const challenge = b64url.encode(crypto.getRandomValues(new Uint8Array(32)));
	await env.DB.prepare("INSERT INTO passkey_challenges (challenge, kind, member_id, rp_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(challenge, kind, memberId, rpId, nowSeconds).run();
	return challenge;
}

/** The client data, checked against a challenge of this kind, taken once. Answers { client, challengeRow }. */
async function checkClientData(env, clientDataJSON, { type, origin, nowSeconds }) {
	let client;
	const raw = b64url.decode(clientDataJSON);
	try {
		client = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		throw new MemberError("the passkey's client data is not JSON");
	}
	if (client.type !== type) throw new MemberError(`expected a ${type} response`);
	if (client.origin !== origin) throw new MemberError(`the passkey was used on ${client.origin}, not ${origin}`, 403);
	// Taken and removed in one statement: two requests can never both use it.
	const row = await env.DB.prepare("DELETE FROM passkey_challenges WHERE challenge = ?1 RETURNING *").bind(String(client.challenge)).first();
	if (!row) throw new MemberError("this passkey request is unknown or already used; try again", 400);
	if (row.created_at < nowSeconds - CHALLENGE_S) throw new MemberError("this passkey request took too long; try again", 400);
	if (row.kind !== (type === "webauthn.create" ? "create" : "get")) throw new MemberError("this passkey request was for something else", 400);
	return { client, raw, challengeRow: row };
}

/* -------------------------------------------------------------- routes ---- */

/**
 * The passkey routes (called by auth.js, which checks the origin and
 * answers errors). `memberOf()` answers the session's member, or throws.
 * Answers [status, body].
 */
export async function handlePasskey(env, route, body, { origin, memberOf, nowSeconds }) {
	if (!env.DB) throw new MemberError("passkeys are not set up on this Worker: missing the D1 binding DB", 503);
	const rpId = rpIdFor(origin);
	const rpIdHash = await sha256(new TextEncoder().encode(rpId));

	if (route === "/auth/passkey/options") {
		if (body.kind === "get") {
			return [200, { challenge: await newChallenge(env, { kind: "get", memberId: null, rpId, nowSeconds }), rpId, timeout: CHALLENGE_S * 1000 }];
		}
		if (body.kind !== "create") throw new MemberError('kind must be "create" or "get"');
		const memberId = await memberOf();
		const m = await env.DB.prepare("SELECT id, name FROM members WHERE id = ?1").bind(memberId).first();
		const existing = (await env.DB.prepare("SELECT credential_id FROM passkeys WHERE member_id = ?1").bind(memberId).all()).results ?? [];
		return [200, {
			challenge: await newChallenge(env, { kind: "create", memberId, rpId, nowSeconds }),
			rp: { id: rpId, name: RP_NAME },
			// The member id, as WebAuthn's user handle: bytes, not personal data.
			user: { id: b64url.encode(new TextEncoder().encode(String(memberId))), name: m.name, displayName: m.name },
			algorithms: [ES256, RS256],
			exclude: existing.map((r) => r.credential_id),
			timeout: CHALLENGE_S * 1000,
		}];
	}

	if (route === "/auth/passkey/register") {
		const memberId = await memberOf();
		const { client, challengeRow } = await checkClientData(env, body.clientDataJSON, { type: "webauthn.create", origin, nowSeconds });
		if (challengeRow.member_id !== memberId) throw new MemberError("this passkey request was for another account", 403);
		if (challengeRow.rp_id !== rpId) throw new MemberError("this passkey request was for another site", 403);
		let attestation;
		try {
			[attestation] = cbor(b64url.decode(body.attestationObject));
		} catch (err) {
			if (err instanceof MemberError) throw err;
			throw new MemberError("the passkey's attestation cannot be read");
		}
		const data = authData(attestation.get("authData"));
		if (!same(data.rpIdHash, rpIdHash)) throw new MemberError("the passkey was made for another site", 403);
		if (!(data.flags & 0x01)) throw new MemberError("the passkey was made without you present");
		if (!(data.flags & 0x04)) throw new MemberError("the passkey was made without unlocking the device (face, fingerprint or PIN)");
		if (!data.credentialId || !data.publicKey) throw new MemberError("the passkey sent no key");
		const id = b64url.encode(data.credentialId);
		if (body.id !== undefined && body.id !== id) throw new MemberError("the passkey's id does not match its data");
		const key = coseKey(data.publicKey);
		const taken = await env.DB.prepare("SELECT member_id FROM passkeys WHERE credential_id = ?1").bind(id).first();
		if (taken) throw new MemberError("this passkey is already on an account", 409);
		await env.DB.batch([
			env.DB.prepare("INSERT INTO passkeys (credential_id, member_id, jwk, alg, sign_count, created_at, last_used) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)")
				.bind(id, memberId, JSON.stringify(key.jwk), key.alg, data.signCount, nowSeconds),
			env.DB.prepare("INSERT INTO member_logins (provider, subject, member_id, login, email, email_verified, created_at, last_used) VALUES ('passkey', ?1, ?2, NULL, NULL, 0, ?3, ?3)")
				.bind(id, memberId, nowSeconds),
		]);
		void client;
		return [200, await me(env, memberId)];
	}

	if (route === "/auth/passkey/signin") {
		const id = String(body.id ?? "");
		const stored = await env.DB.prepare("SELECT p.*, m.name FROM passkeys p JOIN members m ON m.id = p.member_id WHERE p.credential_id = ?1").bind(id).first();
		const { raw, challengeRow } = await checkClientData(env, body.clientDataJSON, { type: "webauthn.get", origin, nowSeconds });
		if (!stored) throw new MemberError("this passkey is not on any Zaideih account (it may have been removed); sign in another way", 401);
		if (challengeRow.rp_id !== rpId) throw new MemberError("this passkey request was for another site", 403);
		const authBytes = b64url.decode(body.authenticatorData);
		const data = authData(authBytes);
		if (!same(data.rpIdHash, rpIdHash)) throw new MemberError("the passkey is for another site", 403);
		if (!(data.flags & 0x01) || !(data.flags & 0x04)) throw new MemberError("the passkey was used without unlocking the device (face, fingerprint or PIN)", 401);
		const signed = new Uint8Array(authBytes.length + 32);
		signed.set(authBytes, 0);
		signed.set(await sha256(raw), authBytes.length);
		const ok = await verifySignature({ alg: stored.alg, jwk: JSON.parse(stored.jwk) }, b64url.decode(body.signature), signed);
		if (!ok) throw new MemberError("the passkey's signature is not valid", 401);
		// A counter that went backwards means a copied key; devices that keep no counter send 0.
		if (data.signCount !== 0 || stored.sign_count !== 0) {
			if (data.signCount <= stored.sign_count) throw new MemberError("this passkey's counter went backwards; it may have been copied. Sign in another way.", 401);
		}
		await env.DB.prepare("UPDATE passkeys SET sign_count = ?1, last_used = ?2 WHERE credential_id = ?3").bind(data.signCount, nowSeconds, id).run();
		return [200, await issueSession(env, { provider: "passkey", subject: id, login: null, name: stored.name, email: null, emailVerified: false }, {}, nowSeconds)];
	}
	return [404, { error: `no route ${route}` }];
}
