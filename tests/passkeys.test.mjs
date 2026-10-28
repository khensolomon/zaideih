import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, fakeR2, sqlite, tokenCheck } from "./helpers/fakes.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { cbor, derToRaw, rpIdFor } = await import("../worker/media/passkeys.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const sha = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));

/* A tiny CBOR encoder, enough for a COSE key and an attestation object. */
function head(major, n) {
	if (n < 24) return [(major << 5) | n];
	if (n < 256) return [(major << 5) | 24, n];
	return [(major << 5) | 25, n >> 8, n & 255];
}
function encode(v) {
	if (typeof v === "number") return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
	if (typeof v === "string") { const b = enc.encode(v); return Uint8Array.from([...head(3, b.length), ...b]); }
	if (v instanceof Uint8Array) return Uint8Array.from([...head(2, v.length), ...v]);
	if (v instanceof Map) {
		const parts = [Uint8Array.from(head(5, v.size))];
		for (const [k, x] of v) parts.push(encode(k), encode(x));
		return Uint8Array.from(parts.flatMap((p) => [...p]));
	}
	throw new Error("unsupported");
}
/* A raw ECDSA signature (WebCrypto) as DER (what authenticators send). */
function rawToDer(raw) {
	const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); return b[0] & 0x80 ? [0, ...b] : [...b]; };
	const r = int(raw.slice(0, 32));
	const s = int(raw.slice(32));
	return Uint8Array.from([0x30, r.length + s.length + 4, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}

/** A software authenticator: makes a P-256 passkey and signs with it, as a phone would. */
// flags: 0x01 user present, 0x04 user verified; 0x40 (a key attached) is added when making one.
async function authenticator({ rpId = "zaideih.com", flags = 0x05 } = {}) {
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
	const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
	const credId = crypto.getRandomValues(new Uint8Array(16));
	const rpIdHash = await sha(enc.encode(rpId));
	let count = 0;
	const authBytes = (extra = []) => Uint8Array.from([...rpIdHash, flags, ...[24, 16, 8, 0].map((s) => (count >>> s) & 255), ...extra]);
	return {
		id: b64(credId),
		setCount(n) { count = n; },
		async create(challenge, origin = ORIGIN) {
			const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
			const attested = [...new Uint8Array(16), credId.length >> 8, credId.length & 255, ...credId, ...encode(cose)];
			const data = authBytes(attested);
			data[32] = flags | 0x40;
			const att = encode(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", data]]));
			const client = enc.encode(JSON.stringify({ type: "webauthn.create", challenge, origin }));
			return { id: b64(credId), clientDataJSON: b64(client), attestationObject: b64(att) };
		},
		async get(challenge, origin = ORIGIN) {
			const client = enc.encode(JSON.stringify({ type: "webauthn.get", challenge, origin }));
			const data = authBytes();
			const signed = Uint8Array.from([...data, ...(await sha(client))]);
			const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
			return { id: b64(credId), clientDataJSON: b64(client), authenticatorData: b64(data), signature: b64(rawToDer(raw)) };
		},
	};
}

const github = async (url, init) => {
	const checked = tokenCheck(url, init);
	if (checked) return checked;
	const t = init.headers.Authorization.replace("Bearer ", "");
	if (t !== "gh-ann") return new Response("{}", { status: 401 });
	if (url.endsWith("/user")) return new Response(JSON.stringify({ id: 42, login: "ann" }));
	return new Response("{}", { status: 403 });
};
function setup() {
	const env = { DB: fakeD1(), BUCKET: fakeR2(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: `${ORIGIN},http://localhost:8080`, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s" };
	let clock = 1_800_000_000_000;
	const post = (path, body = {}, token = null, origin = ORIGIN) => handleAuth(new Request(`${W}${path}`, {
		method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
	}), env, { fetchImpl: github, now: () => clock });
	return { env, post, tick: (s) => { clock += s * 1000; } };
}
const json = async (res) => { const t = await res.text(); return { status: res.status, body: t ? JSON.parse(t) : null }; };

test("CBOR, DER and the relying party", () => {
	assert.deepEqual(cbor(Uint8Array.from([0xa2, 0x01, 0x02, 0x20, 0x43, 1, 2, 3]))[0], new Map([[1, 2], [-1, Uint8Array.from([1, 2, 3])]]));
	assert.deepEqual(cbor(Uint8Array.from([0x63, 0x61, 0x62, 0x63]))[0], "abc");
	assert.deepEqual(cbor(Uint8Array.from([0x19, 0x01, 0x00]))[0], 256);
	const raw = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 0x80 : i === 32 ? 0 : i));
	assert.deepEqual(derToRaw(rawToDer(raw)), raw);
	assert.equal(rpIdFor("https://zaideih.com"), "zaideih.com");
	assert.equal(rpIdFor("https://beta.zaideih.com"), "zaideih.com");
	assert.equal(rpIdFor("http://localhost:8080"), "localhost");
});

test("a passkey is added while signed in, then signs in alone", { skip }, async () => {
	const { env, post } = setup();
	const ann = (await json(await post("/auth/session", {}, "gh-ann"))).body;
	assert.equal((await post("/auth/passkey/options", { kind: "create" })).status, 401, "adding needs a sign-in");
	const opts = (await json(await post("/auth/passkey/options", { kind: "create" }, ann.token))).body;
	assert.deepEqual([opts.rp.id, opts.rp.name, opts.algorithms], ["zaideih.com", "Zaideih", [-7, -257]]);
	assert.equal(Buffer.from(opts.user.id, "base64url").toString(), String(ann.member.id));
	const key = await authenticator();
	const made = await key.create(opts.challenge);
	const added = await json(await post("/auth/passkey/register", made, ann.token));
	assert.equal(added.status, 200, JSON.stringify(added.body));
	assert.deepEqual(added.body.logins.map((l) => l.provider), ["github", "passkey"]);
	assert.equal((await json(await post("/auth/passkey/register", await key.create(opts.challenge), ann.token))).status, 400, "a challenge is used once");

	// Signing in: no account named, the passkey says whose it is.
	const g = (await json(await post("/auth/passkey/options", { kind: "get" }))).body;
	assert.equal(g.rpId, "zaideih.com");
	key.setCount(1);
	const s = await json(await post("/auth/passkey/signin", await key.get(g.challenge)));
	assert.equal(s.status, 200, JSON.stringify(s.body));
	assert.deepEqual([s.body.member.id, s.body.joined], [ann.member.id, "known"]);
	assert.match(s.body.token, /^zs_/);
	// The counter must go up (when it is kept), and the same response is not taken twice.
	const g2 = (await json(await post("/auth/passkey/options", { kind: "get" }))).body;
	const again = await key.get(g2.challenge);
	assert.equal((await json(await post("/auth/passkey/signin", again))).status, 401, "a counter that did not go up");
	assert.equal(env.DB.raw.prepare("SELECT sign_count FROM passkeys").get().sign_count, 1);
});

test("passkey checks: another site, another key, a forged signature, a removed passkey", { skip }, async () => {
	const { env, post, tick } = setup();
	const ann = (await json(await post("/auth/session", {}, "gh-ann"))).body;
	const key = await authenticator();
	const opts = (await json(await post("/auth/passkey/options", { kind: "create" }, ann.token))).body;
	assert.equal((await post("/auth/passkey/register", await key.create(opts.challenge, "https://evil.example"), ann.token)).status, 403, "client data from another origin");
	const opts2 = (await json(await post("/auth/passkey/options", { kind: "create" }, ann.token))).body;
	const elsewhere = await authenticator({ rpId: "evil.example" });
	assert.equal((await post("/auth/passkey/register", await elsewhere.create(opts2.challenge), ann.token)).status, 403, "made for another site");
	const opts3 = (await json(await post("/auth/passkey/options", { kind: "create" }, ann.token))).body;
	const noLock = await authenticator({ flags: 0x01 });
	assert.match((await json(await post("/auth/passkey/register", await noLock.create(opts3.challenge), ann.token))).body.error, /without unlocking the device/);
	const opts4 = (await json(await post("/auth/passkey/options", { kind: "create" }, ann.token))).body;
	assert.equal((await post("/auth/passkey/register", await key.create(opts4.challenge), ann.token)).status, 200);

	// A signature by another key, under this passkey's id.
	const other = await authenticator();
	const g = (await json(await post("/auth/passkey/options", { kind: "get" }))).body;
	const forged = { ...(await other.get(g.challenge)), id: key.id };
	assert.match((await json(await post("/auth/passkey/signin", forged))).body.error, /signature is not valid/);
	// A create challenge cannot be used to sign in; an old challenge has expired.
	const c = (await json(await post("/auth/passkey/options", { kind: "create" }, ann.token))).body;
	assert.match((await json(await post("/auth/passkey/signin", await key.get(c.challenge)))).body.error, /for something else/);
	const late = (await json(await post("/auth/passkey/options", { kind: "get" }))).body;
	tick(301);
	assert.match((await json(await post("/auth/passkey/signin", await key.get(late.challenge)))).body.error, /took too long/);
	// Removed from the account: it signs in no more.
	await post("/auth/logins/remove", { provider: "passkey", subject: key.id }, ann.token);
	assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM passkeys").get().n, 0);
	const g3 = (await json(await post("/auth/passkey/options", { kind: "get" }))).body;
	assert.match((await json(await post("/auth/passkey/signin", await key.get(g3.challenge)))).body.error, /not on any Zaideih account/);
});
