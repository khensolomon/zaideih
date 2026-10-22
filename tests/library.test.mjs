import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, fakeLimiter, fakeR2, sqlite } from "./helpers/fakes.mjs";

const { checkNewUpload, handleLibrary, handleSignedAudio, looksLike, signedUrl, verifySigned } = await import("../worker/media/library.js");
const { forgetMembers, roleOf } = await import("../worker/media/members.js");
const { default: worker } = await import("../worker/media/script.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = {
	"tok-owner": { user: { id: 1, login: "khensolomon" }, permissions: { admin: true, push: true } },
	"tok-ann": { user: { id: 42, login: "ann" }, permissions: { pull: true } },
	"tok-mod": { user: { id: 7, login: "modi" }, permissions: { push: true } },
	"tok-spam": { user: { id: 99, login: "spammer" }, permissions: { pull: true } },
};
const github = async (url, init) => {
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
	if (url.endsWith("/user")) return new Response(JSON.stringify(p.user));
	return new Response(JSON.stringify({ permissions: p.permissions }));
};
function setup(extra = {}) {
	forgetMembers();
	const env = {
		DB: fakeD1(), BUCKET: fakeR2(), UPLOAD_LIMIT: fakeLimiter(),
		GITHUB_REPO: "khensolomon/zaideih", AUTH_ORIGINS: ORIGIN,
		UPLOAD_MAX_BYTES: "1000", UPLOAD_QUOTA_BYTES: "2500", AUDIO_SIGNING_KEY: "test-signing-key",
		...extra,
	};
	let clock = 1_800_000_000_000;
	const call = (token, method, path, body, headers = {}) => {
		const init = { method, headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } };
		if (body !== undefined) init.body = body instanceof Uint8Array ? body : JSON.stringify(body);
		if (body instanceof Uint8Array) init.headers["Content-Length"] = String(body.length);
		return handleLibrary(new Request(`${W}${path}`, init), env, { fetchImpl: github, now: () => clock });
	};
	return { env, call, tick: (ms) => { clock += ms; } };
}
const mp3 = (n) => { const b = new Uint8Array(n); b.set([0x49, 0x44, 0x33]); return b; };
const song = (extra = {}) => ({ fileName: "Song.mp3", size: 600, format: "mp3", duration: 181.4, title: "Song", artist: "Ann", album: "Tape 1990", year: 1990, track: 1, ...extra });

async function upload(call, token, details, bytes) {
	const made = await call(token, "POST", "/library/uploads", details);
	assert.equal(made.status, 201, await made.clone().text());
	const { id, upload: path } = await made.json();
	return { id, res: await call(token, "PUT", path, bytes) };
}

test("roles come from the repository owner and permission", () => {
	assert.equal(roleOf("KhenSolomon", { pull: true }, "khensolomon/zaideih"), "owner");
	assert.equal(roleOf("x", { maintain: true }, "khensolomon/zaideih"), "admin");
	assert.equal(roleOf("x", { push: true }, "khensolomon/zaideih"), "editor");
	assert.equal(roleOf("x", { pull: true }, "khensolomon/zaideih"), "member");
});

test("files are recognised by their first bytes", () => {
	const b = (s, at = 0) => { const a = new Uint8Array(16); a.set([...s].map((c) => c.charCodeAt(0)), at); return a; };
	assert.ok(looksLike("mp3", b("ID3")));
	assert.ok(looksLike("mp3", Uint8Array.from([0xff, 0xfb, 0x90, 0x00])));
	assert.ok(looksLike("m4a", b("ftyp", 4)));
	assert.ok(looksLike("flac", b("fLaC")));
	const wav = b("RIFF"); wav.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
	assert.ok(looksLike("wav", wav));
	assert.ok(looksLike("ogg", b("OggS")));
	assert.ok(!looksLike("mp3", b("<html")));
	assert.ok(!looksLike("wav", b("RIFF")));
});

test("oversized and unsupported files are refused with a reason for the person", () => {
	assert.throws(() => checkNewUpload(song({ fileName: "Tape.wav", format: "wav", size: 312_000_000 }), { maxBytes: 95_000_000 }), /"Tape.wav" is 312 MB; one file can be at most 95 MB\. Save it as MP3/);
	assert.throws(() => checkNewUpload(song({ fileName: "a.wma", format: "wma" }), { maxBytes: 1000 }), /not a supported format\. Upload MP3, M4A \(AAC\), FLAC, WAV or Ogg/);
	assert.throws(() => checkNewUpload(song({ duration: 0 }), { maxBytes: 1000 }), /no readable length/);
	assert.throws(() => checkNewUpload(song({ title: " " }), { maxBytes: 1000 }), /title cannot be empty/);
	assert.throws(() => checkNewUpload(song({ year: 1820 }), { maxBytes: 1000 }), /year must be a whole number from 1900 to 2100/);
	assert.equal(checkNewUpload(song(), { maxBytes: 1000 }).duration, 181);
});

test("signed addresses expire and cannot be altered", async () => {
	const url = new URL(await signedUrl(W, 12, "k", 1000));
	assert.equal(url.pathname, "/u/12");
	const e = url.searchParams.get("e"), s = url.searchParams.get("s");
	assert.equal(await verifySigned("12", e, s, "k", 1000), true);
	assert.equal(await verifySigned("13", e, s, "k", 1000), false, "another upload");
	assert.equal(await verifySigned("12", e, s, "other", 1000), false, "another key");
	assert.equal(await verifySigned("12", String(Number(e) + 1), s, "k", 1000), false, "a later expiry");
	assert.equal(await verifySigned("12", e, s, "k", Number(e) + 1), false, "expired");
});

test("a member uploads, lists, plays, edits and deletes their music", { skip }, async () => {
	const { env, call } = setup();
	const { id, res } = await upload(call, "tok-ann", song(), mp3(600));
	assert.equal(res.status, 200, await res.clone().text());
	assert.ok(env.BUCKET.objects.has(`users/42/${id}.mp3`));

	const lib = await (await call("tok-ann", "GET", "/library")).json();
	assert.deepEqual(lib.space, { used: 600, quota: 2500, maxFile: 1000 });
	assert.equal(lib.member.login, "ann");
	assert.equal(lib.uploads.length, 1);
	assert.equal(lib.uploads[0].title, "Song");
	assert.equal(lib.uploads[0].duration, 181);

	// The signed address plays, with ranges, without a sign-in.
	const u = new URL(lib.uploads[0].url);
	const full = await handleSignedAudio(new Request(u), env, id);
	assert.equal(full.status, 200);
	assert.equal(full.headers.get("content-type"), "audio/mpeg");
	assert.equal((await full.arrayBuffer()).byteLength, 600);
	const part = await handleSignedAudio(new Request(u, { headers: { Range: "bytes=0-9" } }), env, id);
	assert.equal(part.status, 206);
	assert.equal(part.headers.get("content-range"), "bytes 0-9/600");
	const routed = await worker.fetch(new Request(u), env, { waitUntil() {} });
	assert.equal(routed.status, 200, "the Worker routes /u/<id>");
	const forged = await handleSignedAudio(new Request(`${W}/u/${id}?e=9999999999&s=${"a".repeat(43)}`), env, id);
	assert.equal(forged.status, 403);

	const edited = await call("tok-ann", "PATCH", `/library/uploads/${id}`, { title: "Song  (live) ", year: null });
	assert.equal((await edited.json()).title, "Song (live)");
	const others = await call("tok-spam", "PATCH", `/library/uploads/${id}`, { title: "mine now" });
	assert.equal(others.status, 404, "nobody else edits it");

	assert.equal((await call("tok-spam", "DELETE", `/library/uploads/${id}`)).status, 404, "nobody else deletes it");
	assert.equal((await call("tok-ann", "DELETE", `/library/uploads/${id}`)).status, 204);
	assert.equal(env.BUCKET.objects.size, 0);
	assert.equal((await handleSignedAudio(new Request(u), env, id)).status, 404);
});

test("the Worker checks the limits again and refuses a file that is not what it claims", { skip }, async () => {
	const { env, call } = setup();
	const big = await call("tok-ann", "POST", "/library/uploads", song({ size: 1001 }));
	assert.equal(big.status, 413);
	assert.match((await big.json()).error, /one file can be at most/);

	await upload(call, "tok-ann", song({ size: 1000 }), mp3(1000));
	await upload(call, "tok-ann", song({ size: 1000 }), mp3(1000));
	const full = await call("tok-ann", "POST", "/library/uploads", song({ size: 600 }));
	assert.equal(full.status, 413);
	assert.match((await full.json()).error, /does not fit: 0\.5 MB of your 0\.0 MB is left|does not fit/);

	// The owner has no limit.
	await upload(call, "tok-owner", song({ size: 1000 }), mp3(1000));
	await upload(call, "tok-owner", song({ size: 1000 }), mp3(1000));
	const { res } = await upload(call, "tok-owner", song({ size: 1000 }), mp3(1000));
	assert.equal(res.status, 200);

	// An HTML page renamed to .mp3: deleted, with the reason.
	const fake = new TextEncoder().encode("<html>".padEnd(500, " "));
	const { id, res: bad } = await upload(call, "tok-mod", song({ size: 500 }), fake);
	assert.equal(bad.status, 415);
	assert.match((await bad.json()).error, /is not a MP3 file/);
	assert.equal(await env.DB.prepare("SELECT id FROM uploads WHERE id = ?1").bind(id).first(), null);
	assert.ok(![...env.BUCKET.objects.keys()].some((k) => k.endsWith(`/${id}.mp3`)));

	// A size that does not match the announcement.
	const made = await (await call("tok-mod", "POST", "/library/uploads", song({ size: 500 }))).json();
	const wrong = await call("tok-mod", "PUT", made.upload, mp3(400));
	assert.equal(wrong.status, 400);
	assert.match((await wrong.json()).error, /400 bytes, but 500 were announced/);
});

test("a half-done upload is cleared after an hour", { skip }, async () => {
	const { env, call, tick } = setup();
	await call("tok-ann", "POST", "/library/uploads", song());
	assert.equal((await (await call("tok-ann", "GET", "/library")).json()).space.used, 600, "counts while it may still arrive");
	tick(3601e3);
	const lib = await (await call("tok-ann", "GET", "/library")).json();
	assert.equal(lib.space.used, 0);
	assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads").first()).n, 0);
});

test("moderation: the owner grants rights; moderators block and delete; the owner's library stays private", { skip }, async () => {
	const { env, call } = setup();
	const spam = await upload(call, "tok-spam", song({ title: "BUY NOW" }), mp3(600));
	const owners = await upload(call, "tok-owner", song({ title: "Bought album" }), mp3(600));
	await call("tok-mod", "GET", "/library");

	assert.equal((await call("tok-mod", "GET", "/library/members")).status, 403, "not yet a moderator");
	const grant = await call("tok-owner", "POST", "/library/members/7", { moderator: true });
	assert.equal(grant.status, 200);
	assert.equal((await grant.json()).member.moderator, true);
	assert.equal((await call("tok-mod", "POST", "/library/members/42", { moderator: true })).status, 403, "only the owner grants rights");

	const members = (await (await call("tok-mod", "GET", "/library/members")).json()).members;
	assert.deepEqual(members.map((m) => [m.login, m.uploads, m.used]).sort(), [["khensolomon", 1, 600], ["modi", 0, 0], ["spammer", 1, 600]]);
	assert.equal((await call("tok-mod", "GET", "/library/members/1")).status, 403, "the owner's library is private");
	assert.equal((await (await call("tok-mod", "GET", "/library/members/99")).json()).uploads[0].title, "BUY NOW");

	// Block: the spammer's music stops at once and their requests say why.
	const lib = await (await call("tok-spam", "GET", "/library")).json();
	assert.equal((await call("tok-mod", "POST", "/library/members/99", { blocked: true })).status, 400, "a reason is required");
	assert.equal((await call("tok-mod", "POST", "/library/members/99", { blocked: true, reason: "spam" })).status, 200);
	const closed = await call("tok-spam", "GET", "/library");
	assert.equal(closed.status, 403);
	assert.equal((await closed.json()).error, "Your library is closed by modi: spam");
	assert.equal((await handleSignedAudio(new Request(lib.uploads[0].url), env, spam.id)).status, 403);
	assert.equal((await call("tok-mod", "POST", "/library/members/1", { blocked: true, reason: "x" })).status, 403, "nobody blocks the owner");

	// Moderators delete others' uploads, never the owner's.
	assert.equal((await call("tok-mod", "DELETE", `/library/uploads/${owners.id}`)).status, 404);
	assert.equal((await call("tok-mod", "DELETE", `/library/uploads/${spam.id}`)).status, 204);
	assert.equal((await call("tok-mod", "POST", "/library/members/99", { blocked: false })).status, 200);
	assert.equal((await call("tok-spam", "GET", "/library")).status, 200, "unblocked");

	// A moderator cannot block another moderator; the owner can.
	await call("tok-ann", "GET", "/library");
	assert.equal((await call("tok-owner", "POST", "/library/members/42", { moderator: true })).status, 200);
	assert.equal((await call("tok-mod", "POST", "/library/members/42", { blocked: true, reason: "x" })).status, 403);
	assert.equal((await call("tok-owner", "POST", "/library/members/42", { blocked: true, reason: "x" })).status, 200);
});

test("library requests need a sign-in, an allowed origin and the setup", { skip }, async () => {
	const { call } = setup();
	assert.equal((await call(null, "GET", "/library")).status, 401);
	assert.equal((await call("tok-bad", "GET", "/library")).status, 401);
	const elsewhere = await handleLibrary(new Request(`${W}/library`, { headers: { Origin: "https://evil.example", Authorization: "Bearer tok-ann" } }), setup().env, { fetchImpl: github });
	assert.equal(elsewhere.status, 403);
	const { call: unset } = setup({ AUDIO_SIGNING_KEY: undefined, UPLOAD_LIMIT: undefined });
	const res = await unset("tok-ann", "GET", "/library");
	assert.equal(res.status, 503);
	assert.match((await res.json()).error, /missing AUDIO_SIGNING_KEY, UPLOAD_LIMIT/);
	const limited = setup({ UPLOAD_LIMIT: fakeLimiter(false) });
	assert.equal((await limited.call("tok-ann", "POST", "/library/uploads", song())).status, 429);
});
