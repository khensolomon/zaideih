import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, fakeR2, sqlite, tokenCheck } from "./helpers/fakes.mjs";

globalThis.caches ??= { default: { match: async () => undefined, put: async () => {} } };
const { handleAuth } = await import("../worker/media/auth.js");
const { handleEdits, forgetCurrent } = await import("../worker/media/audio-edits.js");
const { default: worker } = await import("../worker/media/script.js");
const { scan } = await import("../worker/media/mp3.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = { "gh-owner": { id: 1, login: "khen" }, "gh-ann": { id: 42, login: "ann" }, "gh-ed": { id: 43, login: "ed" } };
const github = async (url, init) => {
	const checked = tokenCheck(url, init);
	if (checked) return checked;
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	return url.endsWith("/user") ? new Response(JSON.stringify(p)) : new Response("{}", { status: 403 });
};
/* A constant-bitrate MP3 of `n` frames (128 kbps, 44.1 kHz), each ~26.12 ms. */
function mp3(n) {
	const f = new Uint8Array(417);
	f.set([0xff, 0xfb, 0x90, 0x00]);
	const out = new Uint8Array(417 * n);
	for (let i = 0; i < n; i++) out.set(f, i * 417);
	return out;
}

test("audio studio: the Audio right cuts a song as a version, the original kept; audio plays the current or the asked version", { skip }, async () => {
	const env = { DB: fakeD1(), BUCKET: fakeR2(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: ORIGIN, ALLOWED_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s" };
	const clock = 1_800_000_000_000;
	const sessions = {};
	const signIn = async (t) => (sessions[t] ??= (await (await handleAuth(new Request(`${W}/auth/session`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" }), env, { fetchImpl: github, now: () => clock })).json()));
	const call = async (who, method, path, body) => {
		const headers = { Origin: ORIGIN };
		if (who) headers.Authorization = `Bearer ${(await signIn(who)).token}`;
		if (body) headers["Content-Type"] = "application/json";
		const res = await handleEdits(new Request(`${W}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, null, { now: () => clock });
		return { status: res.status, body: await res.json() };
	};
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

	// The public index, and what plays.
	const index = (await call(null, "GET", "/edits")).body.tracks;
	assert.deepEqual(index, { 7: [1, made.body.made.durationMs] });
	const now = await play("/audio/7");
	assert.deepEqual([now.status, now.version, now.cache], [200, "1", "private, max-age=300"]);
	assert.equal(now.bytes.length, made.body.made.bytes);
	const orig = await play("/audio/7?v=0");
	assert.deepEqual([orig.version, orig.bytes.length], ["0", original.length]);
	assert.equal((await play("/audio/7?v=5")).status, 404);

	// Restore: the original again, then version 1 again.
	assert.equal((await call("gh-ed", "POST", "/edits/7/restore", { version: 0, base: 1 })).body.current, 0);
	assert.deepEqual((await call(null, "GET", "/edits")).body.tracks, { 7: [0, null] });
	assert.equal((await play("/audio/7")).bytes.length, original.length);
	const back = await call("gh-ed", "POST", "/edits/7/restore", { version: 1, base: 0 });
	assert.equal(back.body.current, 1);
	assert.deepEqual(back.body.log.map((l) => [l.action, l.version]), [["restore", 1], ["restore", 0], ["cut", 1]]);
	assert.equal((await call("gh-ann", "GET", "/edits/7")).status, 403);
});
