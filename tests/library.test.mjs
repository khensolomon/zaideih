import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, fakeLimiter, fakeR2, sqlite } from "./helpers/fakes.mjs";

const { checkNewUpload, handleLibrary, handleSignedAudio, looksLike, signedUrl, verifySigned } = await import("../worker/media/library.js");
const { handleAuth } = await import("../worker/media/auth.js");
const { default: worker } = await import("../worker/media/script.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = {
	"tok-owner": { user: { id: 1, login: "khensolomon" }, permissions: { admin: true, push: true } },
	"tok-ann": { user: { id: 42, login: "ann" }, permissions: { pull: true } },
	"tok-mod": { user: { id: 7, login: "modi" }, permissions: { push: true } },
	"tok-spam": { user: { id: 99, login: "spammer" }, permissions: { pull: true } },
	"tok-co": { user: { id: 5, login: "lian" }, permissions: { pull: true } },
};
const github = async (url, init) => {
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
	if (url.endsWith("/user")) return new Response(JSON.stringify(p.user));
	if (url.endsWith("/user/emails")) return p.emails ? new Response(JSON.stringify(p.emails)) : new Response("{}", { status: 403 });
	return new Response(JSON.stringify({ permissions: p.permissions }));
};
/**
 * A database as migration 0001 leaves it: everyone in PEOPLE is a member
 * whose id is their GitHub id, with their GitHub sign-in. `call(token, …)`
 * signs in with that GitHub token first (POST /auth/session), as the app does.
 */
function setup(extra = {}, { seed = true } = {}) {
	const env = {
		DB: fakeD1(), BUCKET: fakeR2(), UPLOAD_LIMIT: fakeLimiter(),
		GITHUB_REPO: "khensolomon/zaideih", AUTH_ORIGINS: ORIGIN, OWNER_GITHUB_ID: "1",
		GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "secret",
		UPLOAD_MAX_BYTES: "1000", UPLOAD_QUOTA_BYTES: "2500", AUDIO_SIGNING_KEY: "test-signing-key",
		...extra,
	};
	if (seed) {
		for (const { user } of Object.values(PEOPLE)) {
			env.DB.raw.prepare("INSERT INTO members (id, name, first_seen, last_seen) VALUES (?, ?, 1, 1)").run(user.id, user.login);
			env.DB.raw.prepare("INSERT INTO member_logins (provider, subject, member_id, login, created_at, last_used) VALUES ('github', ?, ?, ?, 1, 1)").run(String(user.id), user.id, user.login);
		}
	}
	let clock = 1_800_000_000_000;
	const sessions = new Map();
	const signIn = async (token, body = {}) => handleAuth(new Request(`${W}/auth/session`, {
		method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
	}), env, { fetchImpl: github, now: () => clock });
	const sessionOf = async (token) => {
		if (!token || !PEOPLE[token]) return token;
		if (!sessions.has(token)) {
			const res = await signIn(token);
			assert.equal(res.status, 200, await res.clone().text());
			sessions.set(token, (await res.json()).token);
		}
		return sessions.get(token);
	};
	const call = async (token, method, path, body, headers = {}) => {
		const session = await sessionOf(token);
		const init = { method, headers: { Origin: ORIGIN, ...(session ? { Authorization: `Bearer ${session}` } : {}), ...headers } };
		if (body !== undefined) init.body = body instanceof Uint8Array ? body : JSON.stringify(body);
		if (body instanceof Uint8Array) init.headers["Content-Length"] = String(body.length);
		return handleLibrary(new Request(`${W}${path}`, init), env, { now: () => clock });
	};
	return { env, call, signIn, sessionOf, tick: (ms) => { clock += ms; } };
}
const mp3 = (n) => { const b = new Uint8Array(n); b.set([0x49, 0x44, 0x33]); return b; };
const song = (extra = {}) => ({ fileName: "Song.mp3", size: 600, format: "mp3", duration: 181.4, title: "Song", artist: "Ann", album: "Tape 1990", year: 1990, track: 1, ...extra });

async function upload(call, token, details, bytes) {
	const made = await call(token, "POST", "/library/uploads", details);
	assert.equal(made.status, 201, await made.clone().text());
	const { id, upload: path } = await made.json();
	return { id, res: await call(token, "PUT", path, bytes) };
}


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

test("rights: the owner and co-owners give and take them; each right allows its own part", { skip }, async () => {
	const { env, call } = setup();
	const spam = await upload(call, "tok-spam", song({ title: "BUY NOW" }), mp3(600));
	const owners = await upload(call, "tok-owner", song({ title: "Bought album" }), mp3(600));
	for (const t of ["tok-mod", "tok-ann", "tok-co"]) await call(t, "GET", "/library");

	assert.equal((await call("tok-mod", "GET", "/library/members")).status, 403, "no right yet");
	const grant = await call("tok-owner", "POST", "/library/members/7", { rights: { moderate: true } });
	assert.equal(grant.status, 200);
	assert.deepEqual((await grant.json()).member.rights, ["moderate"]);
	assert.equal((await call("tok-mod", "POST", "/library/members/42", { rights: { review: true } })).status, 403, "a moderator gives no rights");
	assert.equal((await call("tok-owner", "POST", "/library/members/42", { rights: { owner: true } })).status, 400, "unknown right");

	const members = (await (await call("tok-mod", "GET", "/library/members")).json()).members;
	const row = (login) => members.find((m) => m.login === login);
	assert.equal(row("khensolomon").owner, true);
	assert.deepEqual(row("khensolomon").rights, ["manage", "review", "moderate", "storage", "lyrics", "albums", "songbooks"]);
	assert.deepEqual([row("spammer").uploads, row("spammer").used], [1, 600]);
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
	assert.equal((await call("tok-mod", "DELETE", `/library/uploads/${owners.id}`)).status, 404, "nor deletes the owner's uploads");
	assert.equal((await call("tok-mod", "DELETE", `/library/uploads/${spam.id}`)).status, 204);
	assert.equal((await call("tok-mod", "POST", "/library/members/99", { blocked: false })).status, 200);

	// Review publishing alone lists members but does not moderate.
	await call("tok-owner", "POST", "/library/members/42", { rights: { review: true } });
	assert.equal((await call("tok-ann", "GET", "/library/members")).status, 200);
	assert.equal((await call("tok-ann", "POST", "/library/members/99", { blocked: true, reason: "x" })).status, 403);

	// A co-owner gives and takes any right, also from others with rights, but never touches the owner.
	await call("tok-owner", "POST", "/library/members/5", { rights: { manage: true } });
	assert.equal((await call("tok-co", "POST", "/library/members/7", { rights: { moderate: false, storage: true } })).status, 200);
	assert.deepEqual((await (await call("tok-mod", "GET", "/library")).json()).member.rights, ["storage"]);
	assert.equal((await call("tok-co", "POST", "/library/members/42", { blocked: true, reason: "holds rights" })).status, 200, "co-owners block members with rights");
	assert.equal((await call("tok-co", "POST", "/library/members/1", { rights: { manage: false } })).status, 403);
	assert.equal((await call("tok-co", "GET", "/library/members/1")).status, 403, "the owner's library stays private to co-owners too");

	// A moderator cannot block someone who holds a right.
	await call("tok-owner", "POST", "/library/members/7", { rights: { moderate: true } });
	assert.equal((await call("tok-mod", "POST", "/library/members/5", { blocked: true, reason: "x" })).status, 403);

	// The flag from before rights existed still counts, until Moderate members is taken.
	env.DB.raw.prepare("UPDATE members SET moderator = 1 WHERE id = 99").run();
	assert.equal((await call("tok-spam", "GET", "/library/members")).status, 200);
	await call("tok-owner", "POST", "/library/members/99", { rights: { moderate: false } });
	assert.equal((await call("tok-spam", "GET", "/library/members")).status, 403);
});

test("storage: files already in R2 join a library where they are, wherever they are kept", { skip }, async () => {
	const { env, call } = setup();
	const put = (key, n = 300) => env.BUCKET.put(key, mp3(n));
	await put("Google Music/Album A/01 One.mp3");
	await put("Google Music/Album A/02 Two.mp3");
	await env.BUCKET.put("Google Music/Album A/cover.jpg", "x");
	await put("private/7/mine.mp3");
	await put("shared/pau/song.mp3");
	await put("music/zola/Agape/1.mp3");
	await put("users/42/1.mp3");

	// The owner (and co-owners) browse the whole bucket, except members' uploads.
	const top = await (await call("tok-owner", "GET", "/library/storage")).json();
	assert.equal(top.root, "");
	assert.deepEqual(top.folders.map((f) => f.name), ["Google Music", "music", "private", "shared"]);
	assert.equal((await call("tok-owner", "GET", `/library/storage?prefix=${encodeURIComponent("users/42/")}`)).status, 403, "users/ is the members' own");
	const album = await (await call("tok-owner", "GET", `/library/storage?prefix=${encodeURIComponent("Google Music/Album A/")}`)).json();
	assert.deepEqual(album.files.map((f) => [f.name, f.size, f.format, f.added]), [["01 One.mp3", 300, "mp3", false], ["02 Two.mp3", 300, "mp3", false]]);
	assert.equal(album.others, 1, "the cover is not listed");

	// Its signed address reads the file, with ranges and CORS, so the app can read tags and length.
	const k = new URL(album.files[0].url);
	const part = await worker.fetch(new Request(k, { headers: { Range: "bytes=0-2", Origin: ORIGIN } }), env, { waitUntil() {} });
	assert.equal(part.status, 206);
	assert.equal(part.headers.get("access-control-allow-origin"), ORIGIN);
	assert.equal(new TextDecoder().decode(await part.arrayBuffer()), "ID3");
	const forged = await worker.fetch(new Request(`${W}${k.pathname}?e=9999999999&s=${"a".repeat(43)}`), env, { waitUntil() {} });
	assert.equal(forged.status, 403);
	assert.equal((await worker.fetch(new Request(`${W}/k/${Buffer.from("users/42/1.mp3").toString("base64url")}?e=1&s=x`), env, { waitUntil() {} })).status, 404, "uploads are never read through /k/");

	// Adding: no copy, no space used; listed as added.
	const items = album.files.map((f, i) => ({ key: f.key, title: f.name, album: "Album A", track: i + 1, duration: 200 }));
	const add = await call("tok-owner", "POST", "/library/storage/add", { items });
	assert.equal(add.status, 201);
	assert.equal((await add.json()).added.length, 2);
	const lib = await (await call("tok-owner", "GET", "/library")).json();
	assert.equal(lib.uploads.length, 2);
	assert.equal(lib.space.used, 0);
	assert.equal(env.BUCKET.objects.size, 7, "nothing copied");
	assert.equal((await (await call("tok-owner", "GET", `/library/storage?prefix=${encodeURIComponent("Google Music/Album A/")}`)).json()).files[0].added, true);
	assert.equal((await call("tok-owner", "POST", "/library/storage/add", { items: items.slice(0, 1) })).status, 409, "a file joins one library once");
	assert.equal((await call("tok-owner", "POST", "/library/storage/add", { items: [{ key: "users/42/1.mp3", title: "x", duration: 9 }] })).status, 403, "nor can an upload be taken");
	assert.equal((await handleSignedAudio(new Request(lib.uploads[0].url), env, lib.uploads[0].id)).status, 200, "it plays");

	// Taking it out of the library leaves the file where it is kept.
	assert.equal((await call("tok-owner", "DELETE", `/library/uploads/${lib.uploads[0].id}`)).status, 204);
	assert.ok(env.BUCKET.objects.has("Google Music/Album A/01 One.mp3"));

	// Storage right: one folder, private/<github id>/ until the owner sets another.
	await call("tok-mod", "GET", "/library");
	assert.equal((await call("tok-mod", "GET", "/library/storage")).status, 403, "no right, no storage");
	await call("tok-owner", "POST", "/library/members/7", { rights: { storage: true } });
	const mine = await (await call("tok-mod", "GET", "/library/storage")).json();
	assert.equal(mine.root, "private/7/");
	assert.deepEqual(mine.files.map((f) => f.name), ["mine.mp3"]);
	for (const prefix of ["", "private/", "Google Music/", "private/7/../google/", "private/7", "users/"]) {
		assert.ok([400, 403].includes((await call("tok-mod", "GET", `/library/storage?prefix=${encodeURIComponent(prefix)}`)).status), prefix || "(top)");
	}
	assert.equal((await call("tok-mod", "POST", "/library/storage/add", { items: [{ key: "Google Music/Album A/02 Two.mp3", title: "x", duration: 9 }] })).status, 403);
	assert.equal((await call("tok-mod", "POST", "/library/storage/add", { items: [{ key: "private/7/mine.mp3", title: "Mine", duration: 0 }] })).status, 400, "length is required");
	assert.equal((await call("tok-mod", "POST", "/library/storage/add", { items: [{ key: "private/7/mine.mp3", title: "Mine", duration: 61 }] })).status, 201);

	// The owner moves a member's folder to wherever their music is kept; never users/ or the whole bucket.
	assert.equal((await call("tok-owner", "POST", "/library/members/7", { folder: "users/" })).status, 403);
	assert.equal((await call("tok-owner", "POST", "/library/members/7", { folder: "" })).status, 200, "empty resets to the default");
	assert.equal((await call("tok-owner", "POST", "/library/members/7", { folder: "shared/pau" })).status, 400, "a folder ends with /");
	const moved = await call("tok-owner", "POST", "/library/members/7", { folder: "shared/pau/" });
	assert.equal((await moved.json()).member.folder, "shared/pau/");
	assert.equal((await call("tok-mod", "POST", "/library/members/7", { folder: "Google Music/" })).status, 403, "only the owner and co-owners set folders");
	const theirs = await (await call("tok-mod", "GET", "/library/storage")).json();
	assert.equal(theirs.root, "shared/pau/");
	assert.deepEqual(theirs.files.map((f) => f.name), ["song.mp3"]);
});

test("library requests need a sign-in, an allowed origin and the setup", { skip }, async () => {
	const { call } = setup();
	assert.equal((await call(null, "GET", "/library")).status, 401);
	assert.equal((await call("tok-bad", "GET", "/library")).status, 401);
	const other = setup();
	const elsewhere = await handleLibrary(new Request(`${W}/library`, { headers: { Origin: "https://evil.example", Authorization: `Bearer ${await other.sessionOf("tok-ann")}` } }), other.env);
	assert.equal(elsewhere.status, 403);
	const { call: unset } = setup({ AUDIO_SIGNING_KEY: undefined, UPLOAD_LIMIT: undefined });
	const res = await unset("tok-ann", "GET", "/library");
	assert.equal(res.status, 503);
	assert.match((await res.json()).error, /missing AUDIO_SIGNING_KEY, UPLOAD_LIMIT/);
	const limited = setup({ UPLOAD_LIMIT: fakeLimiter(false) });
	assert.equal((await limited.call("tok-ann", "POST", "/library/uploads", song())).status, 429);
});

test("asking to publish: a member asks, a reviewer listens and approves, the release settles it", { skip }, async () => {
	const { env, call } = setup({ UPLOAD_QUOTA_BYTES: "5000" });
	const a = await upload(call, "tok-ann", song({ title: "One", track: 1 }), mp3(600));
	const b = await upload(call, "tok-ann", song({ title: "Two", track: 2, fileName: "Two.mp3" }), mp3(600));
	await upload(call, "tok-ann", song({ title: "Other", album: "Elsewhere" }), mp3(600));
	await call("tok-mod", "GET", "/library");

	assert.equal((await call("tok-ann", "POST", "/library/requests", { album: "Nope", lang: 1 })).status, 404);
	assert.equal((await call("tok-ann", "POST", "/library/requests", { album: "Tape 1990" })).status, 400, "a language is required");
	const asked = await call("tok-ann", "POST", "/library/requests", { album: "Tape 1990", lang: 1, note: "I recorded it" });
	assert.equal(asked.status, 201, await asked.clone().text());
	const { id, songs } = await asked.json();
	assert.equal(songs, 2);
	assert.equal((await call("tok-ann", "POST", "/library/requests", { album: "Tape 1990", lang: 1 })).status, 409, "asked once");
	assert.equal((await call("tok-ann", "PATCH", `/library/uploads/${a.id}`, { album: "x" })).status, 409, "frozen while waiting");
	assert.equal((await call("tok-ann", "DELETE", `/library/uploads/${a.id}`)).status, 409);

	// A member sees their own; without the right, nobody else's, and cannot decide.
	const own = await (await call("tok-ann", "GET", "/library/requests")).json();
	assert.equal(own.reviewer, false);
	assert.deepEqual(own.requests.map((r) => [r.album, r.status, r.songs.length]), [["Tape 1990", "open", 2]]);
	assert.deepEqual((await (await call("tok-mod", "GET", "/library/requests")).json()).requests, []);
	assert.equal((await call("tok-mod", "POST", `/library/requests/${id}/reject`, { reason: "no" })).status, 403);
	assert.equal((await (await call("tok-ann", "GET", "/library")).json()).requests[0].status, "open");

	await call("tok-owner", "POST", "/library/members/7", { rights: { review: true } });
	const queue = await (await call("tok-mod", "GET", "/library/requests")).json();
	assert.equal(queue.reviewer, true);
	const req = queue.requests.find((r) => r.id === id);
	assert.equal(req.login, "ann");
	assert.equal((await handleSignedAudio(new Request(req.songs[0].url), env, req.songs[0].upload)).status, 200, "the reviewer listens");

	const tracks = [{ upload: a.id, track: 30001, key: "music/tape-1990/One.mp3" }, { upload: b.id, track: 30002, key: "music/tape-1990/Two.mp3" }];
	const approve = (body) => call("tok-mod", "POST", `/library/requests/${id}/approve`, body);
	assert.equal((await approve({ album: "z", tracks })).status, 400, "a catalog album id");
	assert.equal((await approve({ album: "0123456789abcdef", tracks: tracks.slice(0, 1) })).status, 400, "every song");
	assert.equal((await approve({ album: "0123456789abcdef", tracks: [tracks[0], { ...tracks[1], key: "users/x.mp3" }] })).status, 400, "under music/");
	assert.equal((await approve({ album: "0123456789abcdef", tracks: [tracks[0], { ...tracks[1], key: "music/../x.mp3" }] })).status, 400);
	env.DB.raw.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (30002, 'x', 'y.mp3', 0)").run();
	assert.equal((await approve({ album: "0123456789abcdef", tracks })).status, 409, "track id in use");
	env.DB.raw.prepare("DELETE FROM tracks WHERE id = 30002").run();
	await env.BUCKET.put("music/tape-1990/Two.mp3", mp3(10));
	assert.equal((await approve({ album: "0123456789abcdef", tracks })).status, 409, "nothing is overwritten");
	assert.ok(!env.BUCKET.objects.has("music/tape-1990/One.mp3"), "nothing copied before the checks pass");
	await env.BUCKET.delete("music/tape-1990/Two.mp3");

	const ok = await approve({ album: "0123456789abcdef", tracks });
	assert.equal(ok.status, 200, await ok.clone().text());
	assert.equal(env.BUCKET.objects.get("music/tape-1990/One.mp3").bytes.length, 600);
	assert.equal(env.BUCKET.objects.get("music/tape-1990/One.mp3").type, "audio/mpeg");
	assert.equal((await approve({ album: "0123456789abcdef", tracks })).status, 409, "once");
	assert.equal((await call("tok-mod", "POST", `/library/requests/${id}/pr`, { url: "https://evil.example/pull/1" })).status, 400);
	assert.equal((await call("tok-mod", "POST", `/library/requests/${id}/pr`, { url: "https://github.com/khensolomon/zaideih/pull/90" })).status, 204);
	assert.equal((await call("tok-ann", "DELETE", `/library/uploads/${a.id}`)).status, 409, "a published song stays credited");

	let lib = await (await call("tok-ann", "GET", "/library")).json();
	assert.deepEqual([lib.requests[0].status, lib.requests[0].pr, lib.requests[0].reviewer], ["approved", "https://github.com/khensolomon/zaideih/pull/90", "modi"]);
	assert.deepEqual(lib.uploads.filter((u) => u.album === "Tape 1990").map((u) => u.status), ["published", "published"]);

	// The release loads the tracks; the uploaded copies go and the library points at the catalog's files.
	for (const t of tracks) env.DB.raw.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (?, 'tape-1990', ?, 0)").run(t.track, t.key.split("/").pop());
	lib = await (await call("tok-ann", "GET", "/library")).json();
	assert.equal(lib.requests[0].status, "released");
	assert.ok(!env.BUCKET.objects.has(`users/42/${a.id}.mp3`));
	const one = lib.uploads.find((u) => u.id === a.id);
	assert.equal(one.status, "released");
	assert.equal((await handleSignedAudio(new Request(one.url), env, a.id)).status, 200, "it still plays, from the catalog's file");
	const used = (await (await call("tok-ann", "GET", "/library")).json()).space.used;
	assert.equal(used, 600, "published songs no longer use the member's space");
});

test("asking to publish: MP3 only, withdrawing and rejecting give the songs back", { skip }, async () => {
	const { env, call } = setup();
	await upload(call, "tok-ann", song({ title: "One" }), mp3(600));
	const flac = Uint8Array.from([..."fLaC"].map((c) => c.charCodeAt(0)).concat(Array(596).fill(0)));
	await upload(call, "tok-ann", song({ title: "Two", fileName: "Two.flac", format: "flac" }), flac);
	const refused = await call("tok-ann", "POST", "/library/requests", { album: "Tape 1990", lang: 1 });
	assert.equal(refused.status, 415);
	assert.match((await refused.json()).error, /Only MP3 can be published\. "Two.flac" is FLAC/);
	const two = (await (await call("tok-ann", "GET", "/library")).json()).uploads.find((u) => u.format === "flac");
	await call("tok-ann", "DELETE", `/library/uploads/${two.id}`);

	const { id } = await (await call("tok-ann", "POST", "/library/requests", { album: "Tape 1990", lang: 1 })).json();
	assert.equal((await call("tok-spam", "DELETE", `/library/requests/${id}`)).status, 403);
	assert.equal((await call("tok-ann", "DELETE", `/library/requests/${id}`)).status, 204);
	assert.equal((await call("tok-ann", "DELETE", `/library/requests/${id}`)).status, 409);
	let lib = await (await call("tok-ann", "GET", "/library")).json();
	assert.equal(lib.uploads[0].status, "private");
	assert.equal(lib.requests[0].status, "withdrawn");

	// The owner holds every right: asks and decides; a rejection says why.
	const again = await (await call("tok-ann", "POST", "/library/requests", { album: "Tape 1990", lang: 1 })).json();
	assert.equal((await call("tok-owner", "POST", `/library/requests/${again.id}/reject`, {})).status, 400, "a reason");
	assert.equal((await call("tok-owner", "POST", `/library/requests/${again.id}/reject`, { reason: "Not your recording" })).status, 200);
	lib = await (await call("tok-ann", "GET", "/library")).json();
	assert.deepEqual([lib.requests[0].status, lib.requests[0].reason, lib.uploads[0].status], ["rejected", "Not your recording", "private"]);
	assert.equal(env.BUCKET.objects.size, 1);
});
