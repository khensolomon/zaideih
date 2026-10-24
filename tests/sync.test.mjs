import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, fakeR2, sqlite } from "./helpers/fakes.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { handleLibrary } = await import("../worker/media/library.js");
const { mergeMembers } = await import("../worker/media/accounts.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = { "gh-ann": { id: 42, login: "ann" }, "gh-bo": { id: 43, login: "bo" } };
const github = async (url, init) => {
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	return url.endsWith("/user") ? new Response(JSON.stringify(p)) : new Response("{}", { status: 403 });
};
function setup() {
	const env = { DB: fakeD1(), BUCKET: fakeR2(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s", UPLOAD_MAX_BYTES: "1000", UPLOAD_QUOTA_BYTES: "2000", AUDIO_SIGNING_KEY: "k", UPLOAD_LIMIT: { limit: async () => ({ success: true }) } };
	let clock = 1_800_000_000_000;
	const sessions = {};
	const signIn = async (t) => (sessions[t] ??= (await (await handleAuth(new Request(`${W}/auth/session`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" }), env, { fetchImpl: github, now: () => clock })).json()));
	const sync = async (t, body) => {
		const s = await signIn(t);
		const res = await handleLibrary(new Request(`${W}/library/sync`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, { now: () => clock });
		const text = await res.text();
		return { status: res.status, body: text ? JSON.parse(text) : null };
	};
	return { env, sync, signIn, tick: (ms) => { clock += ms; }, at: () => clock };
}
const like = (track, liked, at) => ({ kind: "like", track, liked, at });
const pl = (uid, extra) => ({ kind: "playlist", uid, name: "Road", tracks: [1, 2], deleted: false, base: 0, offline: false, ...extra });
const U = "0123456789abcdef";

test("likes: each device sends its changes and gets everyone's since it last asked", { skip }, async () => {
	const { sync, at } = setup();
	// Phone likes two songs and an upload; the laptop, first time, gets them all.
	const phone = await sync("gh-ann", { since: 0, changes: [like(10, true, at() - 3000), like(11, true, at() - 2000), like("u7", true, at() - 1000)] });
	assert.equal(phone.status, 200, JSON.stringify(phone.body));
	assert.equal(phone.body.since, 1);
	const laptop = await sync("gh-ann", { since: 0 });
	assert.deepEqual(laptop.body.likes.map((l) => [l.track, l.liked]).sort(), [[10, true], [11, true], ["u7", true]]);
	// The laptop unlikes 11 later; the phone, asking since 1, gets just that.
	await sync("gh-ann", { since: laptop.body.since, changes: [like(11, false, at())] });
	const again = await sync("gh-ann", { since: phone.body.since });
	assert.deepEqual(again.body.likes, [{ track: 11, liked: false, at: at() }]);
	// An older change does not undo a newer one.
	await sync("gh-ann", { since: 0, changes: [like(11, true, at() - 60_000)] });
	assert.equal((await sync("gh-ann", { since: 0 })).body.likes.find((l) => l.track === 11).liked, false);
	// Another member sees none of it.
	assert.deepEqual((await sync("gh-bo", { since: 0 })).body, { since: 0, likes: [], playlists: [] });
});

test("playlists: online, the server's copy wins a conflict; offline, the most recent change wins", { skip }, async () => {
	const { sync, at, tick } = setup();
	const made = await sync("gh-ann", { since: 0, changes: [pl(U, { at: at() })] });
	assert.deepEqual(made.body.playlists.map((p) => [p.uid, p.version, p.tracks]), [[U, 1, [1, 2]]]);
	// Laptop renames it, having seen version 1: it applies.
	tick(1000);
	const renamed = await sync("gh-ann", { since: 0, changes: [pl(U, { name: "Road trip", base: 1, at: at() })] });
	assert.deepEqual(renamed.body.playlists.map((p) => [p.name, p.version]), [["Road trip", 2]]);
	// The phone, online and still at version 1, adds a song: another device changed it, so the server's copy wins and comes back.
	tick(1000);
	const stale = await sync("gh-ann", { since: made.body.since, changes: [pl(U, { tracks: [1, 2, 3], base: 1, at: at() })] });
	assert.deepEqual(stale.body.playlists.map((p) => [p.name, p.tracks, p.version]), [["Road trip", [1, 2], 2]]);
	// Made offline at version 1, but more recent than the rename: the most recent wins.
	tick(1000);
	const offline = await sync("gh-ann", { since: 0, changes: [pl(U, { tracks: [9], base: 1, offline: true, at: at() })] });
	assert.deepEqual(offline.body.playlists.map((p) => [p.name, p.tracks, p.version]), [["Road", [9], 3]]);
	// Offline but older than the server's copy: the server's stays.
	const older = await sync("gh-ann", { since: 0, changes: [pl(U, { tracks: [5], base: 1, offline: true, at: at() - 10_000 })] });
	assert.deepEqual(older.body.playlists[0].tracks, [9]);
	// A losing change comes back with the server's copy even when the device asks with the newest counter.
	const lost = await sync("gh-ann", { since: older.body.since, changes: [pl(U, { tracks: [6], base: 1, at: at() })] });
	assert.deepEqual(lost.body.playlists.map((p) => [p.tracks, p.version]), [[[9], 3]]);
	const lostLike = await sync("gh-ann", { since: lost.body.since, changes: [like(4, true, at())] });
	await sync("gh-ann", { since: 0, changes: [like(4, false, at() + 5)] });
	const stillLost = await sync("gh-ann", { since: (await sync("gh-ann", { since: 0 })).body.since, changes: [like(4, true, at() - 5)] });
	assert.deepEqual(stillLost.body.likes, [{ track: 4, liked: false, at: at() + 5 }]);
	assert.equal(lostLike.status, 200);
	// Deleted: a mark every device sees.
	tick(1000);
	const del = await sync("gh-ann", { since: 0, changes: [pl(U, { deleted: true, base: 3, at: at() })] });
	assert.deepEqual(del.body.playlists.map((p) => [p.deleted, p.tracks]), [[true, []]]);
});

test("sync refuses what it cannot keep, and a blocked member", { skip }, async () => {
	const { env, sync, at, signIn } = setup();
	assert.equal((await sync("gh-ann", { since: -1 })).status, 400);
	assert.equal((await sync("gh-ann", { since: 0, changes: Array.from({ length: 26 }, (_, i) => like(i + 1, true, at())) })).status, 400, "at most 25 a request");
	assert.match((await sync("gh-ann", { since: 0, changes: [like("x; DROP", true, at())] })).body.error, /not a song/);
	assert.match((await sync("gh-ann", { since: 0, changes: [like(1, true, at() + 2 * 86400_000)] })).body.error, /time of the change/);
	assert.match((await sync("gh-ann", { since: 0, changes: [pl("nothex", { at: at() })] })).body.error, /16 hex/);
	assert.match((await sync("gh-ann", { since: 0, changes: [pl(U, { name: " ", at: at() })] })).body.error, /needs a name/);
	const ann = await signIn("gh-ann");
	env.DB.raw.prepare("UPDATE members SET blocked_at = 1, blocked_by = 'mod', blocked_reason = 'spam' WHERE id = ?").run(ann.member.id);
	assert.equal((await sync("gh-ann", { since: 0 })).status, 403);
});

test("joining two accounts joins their libraries, and every device sees the moved rows", { skip }, async () => {
	const { env, sync, signIn, at } = setup();
	const ann = await signIn("gh-ann");
	const bo = await signIn("gh-bo");
	await sync("gh-ann", { since: 0, changes: [like(1, true, at())] });
	const annBefore = (await sync("gh-ann", { since: 0 })).body.since;
	await sync("gh-bo", { since: 0, changes: [like(2, true, at()), pl(U, { at: at() })] });
	const keep = await mergeMembers(env, ann.member.id, bo.member.id, 1);
	assert.equal(keep, ann.member.id);
	const after = await sync("gh-ann", { since: annBefore });
	assert.deepEqual(after.body.likes.map((l) => l.track), [2], "the moved like, past the counter ann's devices had seen");
	assert.deepEqual(after.body.playlists.map((p) => p.uid), [U]);
	assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM library_likes WHERE member_id = ?").get(bo.member.id).n, 0);
});
