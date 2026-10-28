import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, sqlite } from "./helpers/fakes.mjs";
import { harness, ORIGIN, W, workerEnv } from "./helpers/worker.mjs";

globalThis.caches ??= { default: { match: async () => undefined, put: async () => {} } };
const { handleAuth } = await import("../worker/media/auth.js");
const { handleEdits, forgetCurrent, currentVersions } = await import("../worker/media/audio-edits.js");
const { default: worker } = await import("../worker/media/script.js");
const { cut, plan, scan } = await import("../worker/media/mp3.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const PEOPLE = { "gh-owner": { id: 1, login: "khen" }, "gh-ann": { id: 42, login: "ann" }, "gh-ed": { id: 43, login: "ed" } };
const join = (...parts) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) { out.set(p, at); at += p.length; }
	return out;
};
const id3 = () => join(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]), new Uint8Array(20).fill(7));
const id3v1 = () => { const t = new Uint8Array(128); t.set([0x54, 0x41, 0x47]); return t; };
const xing = () => { const f = mp3(1); for (const [k, c] of [..."Info"].entries()) f[36 + k] = c.charCodeAt(0); return f; };
/* A constant-bitrate MP3 of `n` frames (128 kbps, 44.1 kHz), each ~26.12 ms. */
function mp3(n) {
	const f = new Uint8Array(417);
	f.set([0xff, 0xfb, 0x90, 0x00]);
	const out = new Uint8Array(417 * n);
	for (let i = 0; i < n; i++) out.set(f, i * 417);
	return out;
}

test("audio studio: the Audio right cuts a song as a version, the original kept; audio plays the current or the asked version", { skip }, async () => {
	const { env, call, signIn } = harness({ people: PEOPLE, handler: handleEdits, handleAuth, env: workerEnv({ ALLOWED_ORIGINS: ORIGIN }) });
	const play = async (path) => {
		const res = await worker.fetch(new Request(`${W}${path}`, { headers: { "Sec-Fetch-Dest": "audio" } }), env, { waitUntil() {} });
		return { status: res.status, version: res.headers.get("x-zaideih-version"), cache: res.headers.get("cache-control"), bytes: res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null };
	};
	forgetCurrent();
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (7, 'zola/Agape', 'Hong.mp3', 0)").run();
	const original = mp3(400);
	await env.BUCKET.put("music/zola/Agape/Hong.mp3", original);
	await signIn("gh-owner");
	const ed = (await signIn("gh-ed")).member.id;

	assert.deepEqual((await call(null, "GET", "/edits")).body.tracks, {});
	assert.equal((await call("gh-ann", "POST", "/edits/7", { startMs: 1000, endMs: 9000, base: 0 })).status, 403, "the Audio studio right is needed");
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'audio', 'khen', 0)").bind(ed).run();
	assert.equal((await call("gh-ed", "POST", "/edits/7", { startMs: 9000, endMs: 1000, base: 0 })).status, 400);
	assert.equal((await call("gh-ed", "POST", "/edits/8", { startMs: 0, endMs: 1000, base: 0 })).status, 404);

	const made = await call("gh-ed", "POST", "/edits/7", { startMs: 1000, endMs: 9000, base: 0, note: "tape hiss at the start" });
	assert.equal(made.status, 201, JSON.stringify(made.body));
	assert.equal(made.body.current, 1);
	assert.equal(made.body.made.version, 1);
	assert.ok(Math.abs(made.body.made.startMs - 1000) < 27 && Math.abs(made.body.made.endMs - 9000) < 27, "snapped to frame edges");
	assert.deepEqual(env.BUCKET.objects.get("music/zola/Agape/Hong.mp3").bytes, original, "the original is untouched");
	assert.equal(scan(env.BUCKET.objects.get("edits/7/1.mp3").bytes).frames.length, Math.round(made.body.made.durationMs / ((1152 * 1000) / 44100)), "the version holds the frames cut");
	assert.equal((await call("gh-ed", "POST", "/edits/7", { startMs: 0, endMs: 5000, base: 0 })).status, 409, "made against an older version");

	// A cut planned by the studio (which has the whole file): the Worker checks its frame edges with two
	// small reads and copies the ranges, never reading the original whole; the same bytes as its own cut.
	const planned = plan(scan(original), original.length, 1000, 9000);
	const withPlan = (p) => ({ startMs: 1000, endMs: 9000, base: 1, plan: { ...p, info: p.info ? Buffer.from(p.info).toString("base64") : null } });
	const gets = [];
	const realGet = env.BUCKET.get.bind(env.BUCKET);
	env.BUCKET.get = (key, options) => { gets.push(options?.range ?? "whole"); return realGet(key, options); };
	const byPlan = await call("gh-ed", "POST", "/edits/7", withPlan(planned));
	env.BUCKET.get = realGet;
	assert.equal(byPlan.status, 201, JSON.stringify(byPlan.body));
	assert.deepEqual(env.BUCKET.objects.get("edits/7/2.mp3").bytes, cut(original, 1000, 9000).bytes, "the same recording as the Worker's own cut");
	assert.deepEqual([byPlan.body.made.startMs, byPlan.body.made.endMs, byPlan.body.made.durationMs], [made.body.made.startMs, made.body.made.endMs, made.body.made.durationMs]);
	assert.ok(!gets.includes("whole") && gets.filter((r) => r.length === 4).length === 2, `only ranges are read: ${JSON.stringify(gets)}`);
	// Plans that do not fit the recording are refused: another file's size, a cut not at a frame, a forged info frame.
	const bad = (changes) => ({ ...withPlan(planned), base: 2, plan: changes === null ? null : { ...withPlan(planned).plan, ...changes } });
	assert.equal((await call("gh-ed", "POST", "/edits/7", bad({ size: original.length + 1 }))).status, 422);
	assert.equal((await call("gh-ed", "POST", "/edits/7", bad({ sound: [planned.sound[0] + 1, planned.sound[1]] }))).status, 422);
	assert.equal((await call("gh-ed", "POST", "/edits/7", bad({ info: Buffer.from("not a frame").toString("base64") }))).status, 422);
	assert.equal((await call("gh-ed", "POST", "/edits/7", bad(null))).status, 422);
	assert.equal(await env.DB.prepare("SELECT MAX(version) AS v FROM audio_versions WHERE track_id = 7").first().then((r) => r.v), 2, "nothing was made of them");
	assert.equal((await call("gh-ed", "POST", "/edits/7/restore", { version: 1, base: 2 })).body.current, 1);
	// Files with the other parts (an ID3v2 tag, an Info frame, with and without an ID3v1 tag): each part copied once, in its place.
	let taggedCut;
	for (const [id, tagged] of [[8, join(id3(), xing(), mp3(300), id3v1())], [9, join(id3(), xing(), mp3(300))]]) {
		await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (?1, 'zola/Agape', ?2, 0)").bind(id, `${id}.mp3`).run();
		await env.BUCKET.put(`music/zola/Agape/${id}.mp3`, tagged);
		const taggedPlan = plan(scan(tagged), tagged.length, 500, 7000);
		taggedCut = await call("gh-ed", "POST", `/edits/${id}`, { startMs: 500, endMs: 7000, base: 0, plan: { ...taggedPlan, info: Buffer.from(taggedPlan.info).toString("base64") } });
		assert.equal(taggedCut.status, 201, JSON.stringify(taggedCut.body));
		assert.deepEqual(env.BUCKET.objects.get(`edits/${id}/1.mp3`).bytes, cut(tagged, 500, 7000).bytes, `song ${id}`);
	}

	// The public index, and what plays.
	const index = (await call(null, "GET", "/edits")).body.tracks;
	assert.deepEqual(index, { 7: [1, made.body.made.durationMs], 8: [1, taggedCut.body.made.durationMs], 9: [1, taggedCut.body.made.durationMs] });
	const now = await play("/audio/7");
	assert.deepEqual([now.status, now.version, now.cache], [200, "1", "private, max-age=300"]);
	assert.equal(now.bytes.length, made.body.made.bytes);
	const orig = await play("/audio/7?v=0");
	assert.deepEqual([orig.version, orig.bytes.length], ["0", original.length]);
	assert.equal((await play("/audio/7?v=5")).status, 404);

	// Restore: the original again, then version 1 again.
	assert.equal((await call("gh-ed", "POST", "/edits/7/restore", { version: 0, base: 1 })).body.current, 0);
	assert.deepEqual((await call(null, "GET", "/edits")).body.tracks, { 7: [0, null], 8: [1, taggedCut.body.made.durationMs], 9: [1, taggedCut.body.made.durationMs] });
	assert.equal((await play("/audio/7")).bytes.length, original.length);
	const back = await call("gh-ed", "POST", "/edits/7/restore", { version: 1, base: 0 });
	assert.equal(back.body.current, 1);
	assert.deepEqual(back.body.log.map((l) => [l.action, l.version]), [["restore", 1], ["restore", 0], ["restore", 1], ["cut", 2], ["cut", 1]]);
	assert.equal((await call("gh-ann", "GET", "/edits/7")).status, 403);
});

test("current versions: when D1 cannot be read, the last map read is kept, and the originals play at first", { skip }, async () => {
	forgetCurrent();
	const env = { DB: fakeD1() };
	await env.DB.prepare("INSERT INTO audio_current (track_id, version, set_by, at) VALUES (7, 0, 'x', 0)").run();
	const errors = [];
	const quiet = console.error;
	console.error = (...a) => errors.push(a[0]);
	try {
		assert.deepEqual([...(await currentVersions(env, 1000)).keys()], [7]);
		const broken = { DB: { prepare() { return { all() { throw new Error("D1 is down"); } }; } } };
		assert.deepEqual([...(await currentVersions(broken, 1000 + 86_400_000)).keys()], [7], "the last map read is kept");
		forgetCurrent();
		assert.equal((await currentVersions(broken, 1)).size, 0, "none at first: the originals play");
		assert.equal(errors.length, 2);
	} finally {
		console.error = quiet;
		forgetCurrent();
	}
});

test("the app: a song's length is its version's, the album's length follows, and the original's length comes back", async () => {
	globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
	const { applyEdits, parseEdits } = await import("../src/core/audio-edits.js");
	const album = { id: "a", tracks: [], duration: 0 };
	const t1 = { id: 1, duration: 200, album };
	const t2 = { id: 2, duration: 100, album };
	album.tracks.push(t1, t2);
	album.duration = 300;
	const catalog = { tracks: new Map([[1, t1], [2, t2]]) };
	assert.equal(applyEdits(catalog, parseEdits({ at: 1, tracks: { 1: [1, 150_400] } }).tracks), true);
	assert.deepEqual([t1.duration, t1.catalogDuration, album.duration], [150, 200, 250]);
	assert.equal(applyEdits(catalog, parseEdits({ at: 2, tracks: { 1: [0, null] } }).tracks), true, "the original again");
	assert.deepEqual([t1.duration, album.duration], [200, 300]);
	assert.equal(applyEdits(catalog, parseEdits({ at: 2, tracks: { 1: [0, null] } }).tracks), false, "nothing changed");
});
