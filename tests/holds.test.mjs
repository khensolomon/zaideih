import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, sqlite } from "./helpers/fakes.mjs";
import { harness, W } from "./helpers/worker.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { handleHolds, heldTracks, forgetHeld } = await import("../worker/media/holds.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const PEOPLE = { "gh-owner": { id: 1, login: "khen" }, "gh-ann": { id: 42, login: "ann" }, "gh-rev": { id: 43, login: "rev" } };
const setup = () => harness({ people: PEOPLE, handler: handleHolds, handleAuth });

test("holds: the Albums right holds an album back and gives it back; the public sees only what is held", { skip }, async () => {
	const { env, call, signIn, tick } = setup();
	forgetHeld();
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (11, 'a', '1.mp3', 0), (12, 'a', '2.mp3', 0), (21, 'b', '1.mp3', 0)").run();

	assert.deepEqual((await call(null, "GET", "/holds")).body, { at: 0, albums: {} });
	assert.equal((await call(null, "POST", "/holds/abc", { streaming: false, listed: true, reason: "x", tracks: [11] })).status, 401);
	assert.equal((await call("gh-ann", "POST", "/holds/abc", { streaming: false, listed: true, reason: "x", tracks: [11] })).status, 403, "a member without the right");

	// The owner: a reason is needed to hold back; every song must be in the catalog.
	assert.equal((await call("gh-owner", "POST", "/holds/abc", { streaming: false, listed: true, tracks: [11, 12] })).status, 400);
	assert.equal((await call("gh-owner", "POST", "/holds/abc", { streaming: false, listed: true, reason: "rights", tracks: [11, 99] })).status, 404);
	assert.equal((await call("gh-owner", "POST", "/holds/a%2Fb", { streaming: false, listed: true, reason: "rights", tracks: [11] })).status, 400);
	const held = await call("gh-owner", "POST", "/holds/abc", { streaming: false, listed: true, reason: "Rights being checked", tracks: [11, 12] });
	assert.equal(held.status, 200, JSON.stringify(held.body));
	assert.deepEqual((await call(null, "GET", "/holds")).body.albums, { abc: { streaming: false, listed: true } });
	assert.deepEqual([...(await heldTracks(env))].sort(), [11, 12]);
	// The Worker refuses a held song, whatever link it comes from.
	forgetHeld();
	const { default: worker } = await import("../worker/media/script.js");
	const refused = await worker.fetch(new Request(`${W}/audio/11`, { headers: { "Sec-Fetch-Dest": "audio" } }), { ...env, BUCKET: { get: async () => { throw new Error("not reached"); } } }, { waitUntil() {} });
	assert.deepEqual([refused.status, refused.headers.get("x-zaideih-reason")], [403, "held"]);

	// The owner gives the right to a reviewer, who hides another album.
	const rev = (await signIn("gh-rev")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'albums', 'khen', 0)").bind(rev).run();
	tick(60e3);
	assert.equal((await call("gh-rev", "POST", "/holds/def", { streaming: true, listed: false, reason: "Asked by the artist", tracks: [21] })).status, 200);
	const pub = (await call(null, "GET", "/holds")).body;
	assert.deepEqual(pub.albums.def, { streaming: true, listed: false });
	assert.equal(JSON.stringify(pub).includes("Asked"), false, "reasons are not public");

	// Given back: no hold, its songs play again; the log keeps every change.
	tick(60e3);
	assert.equal((await call("gh-owner", "POST", "/holds/abc", { streaming: true, listed: true, tracks: [11, 12] })).status, 200);
	assert.deepEqual(Object.keys((await call(null, "GET", "/holds")).body.albums), ["def"]);
	assert.deepEqual([...(await heldTracks(env))], [21]);
	const detail = (await call("gh-rev", "GET", "/holds/detail")).body;
	assert.deepEqual(detail.holds.map((h) => [h.album, h.reason, h.by]), [["def", "Asked by the artist", "rev"]]);
	assert.deepEqual(detail.log.map((h) => [h.album, h.reason]), [["abc", "given back"], ["def", "Asked by the artist"], ["abc", "Rights being checked"]]);
	assert.equal((await call("gh-ann", "GET", "/holds/detail")).status, 403);
	assert.equal((await call("gh-owner", "POST", "/holds/detail", {})).status, 404);
});

test("held songs: when D1 cannot be read, the last set read is kept, and none at first", { skip }, async () => {
	forgetHeld();
	const env = { DB: fakeD1() };
	await env.DB.prepare("INSERT INTO album_hold_tracks (album_id, track_id) VALUES ('a', 7)").run();
	const errors = [];
	const quiet = console.error;
	console.error = (...a) => errors.push(a[0]);
	try {
		assert.deepEqual([...(await heldTracks(env, 1000))], [7]);
		const broken = { DB: { prepare() { return { all() { throw new Error("D1 is down"); } }; } } };
		assert.deepEqual([...(await heldTracks(broken, 1000 + 86_400_000))], [7], "the last set read is kept");
		forgetHeld();
		assert.deepEqual([...(await heldTracks(broken, 1))], [], "none at first: the catalog plays");
		assert.equal(errors.length, 2);
	} finally {
		console.error = quiet;
		forgetHeld();
	}
});
