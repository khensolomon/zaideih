import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, sqlite, tokenCheck } from "./helpers/fakes.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { handleHolds, heldTracks, forgetHeld } = await import("../worker/media/holds.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = { "gh-owner": { id: 1, login: "khen" }, "gh-ann": { id: 42, login: "ann" }, "gh-rev": { id: 43, login: "rev" } };
const github = async (url, init) => {
	const checked = tokenCheck(url, init);
	if (checked) return checked;
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	return url.endsWith("/user") ? new Response(JSON.stringify(p)) : new Response("{}", { status: 403 });
};

function setup() {
	const env = { DB: fakeD1(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s" };
	let clock = 1_800_000_000_000;
	const sessions = {};
	const signIn = async (t) => (sessions[t] ??= (await (await handleAuth(new Request(`${W}/auth/session`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" }), env, { fetchImpl: github, now: () => clock })).json()));
	const call = async (who, method, path, body) => {
		const headers = { Origin: ORIGIN };
		if (who) headers.Authorization = `Bearer ${(await signIn(who)).token}`;
		if (body) headers["Content-Type"] = "application/json";
		const res = await handleHolds(new Request(`${W}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, null, { now: () => clock });
		return { status: res.status, body: await res.json(), headers: res.headers };
	};
	return { env, call, signIn, tick: (s) => { clock += s * 1000; } };
}

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
	tick(60);
	assert.equal((await call("gh-rev", "POST", "/holds/def", { streaming: true, listed: false, reason: "Asked by the artist", tracks: [21] })).status, 200);
	const pub = (await call(null, "GET", "/holds")).body;
	assert.deepEqual(pub.albums.def, { streaming: true, listed: false });
	assert.equal(JSON.stringify(pub).includes("Asked"), false, "reasons are not public");

	// Given back: no hold, its songs play again; the log keeps every change.
	tick(60);
	assert.equal((await call("gh-owner", "POST", "/holds/abc", { streaming: true, listed: true, tracks: [11, 12] })).status, 200);
	assert.deepEqual(Object.keys((await call(null, "GET", "/holds")).body.albums), ["def"]);
	assert.deepEqual([...(await heldTracks(env))], [21]);
	const detail = (await call("gh-rev", "GET", "/holds/detail")).body;
	assert.deepEqual(detail.holds.map((h) => [h.album, h.reason, h.by]), [["def", "Asked by the artist", "rev"]]);
	assert.deepEqual(detail.log.map((h) => [h.album, h.reason]), [["abc", "given back"], ["def", "Asked by the artist"], ["abc", "Rights being checked"]]);
	assert.equal((await call("gh-ann", "GET", "/holds/detail")).status, 403);
	assert.equal((await call("gh-owner", "POST", "/holds/detail", {})).status, 404);
});
