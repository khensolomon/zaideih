import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../tools/catalog.mjs";
import { applyHolds, applyLive, buildModel } from "../src/core/catalog.js";
import { indexRaw, parseLive, patchRaw, rawValue } from "../src/core/live-catalog.js";
import { search } from "../src/core/search.js";
import { fakeD1, sqlite, tokenCheck } from "./helpers/fakes.mjs";

const category = {
	lang: [{ id: 1, name: "zola" }, { id: 2, name: "myanmar" }, { id: 3, name: "mizo" }],
	artist: [{ id: 0, name: "Unknown" }, { id: 2, name: "Male" }, { id: 3, name: "Female" }],
	album: [{ id: 0, name: "Unknown" }],
	genre: [{ id: 2, name: "Gospel" }, { id: 5, name: "Choir" }],
};
const artists = [
	{ id: 3, name: "Zamnu", aka: "", thesaurus: [], type: 3 },
	{ id: 9, name: "Unused", aka: "", thesaurus: [], type: 2 },
];
const albums = [
	{ ui: "a1", ab: "Agape No.1", gr: [2], yr: [1987], lg: 1, tk: [
		{ t: "Hong len in", a: [3], d: 252, p: 622, i: 1 },
		{ t: "Nobody", a: [], d: 95, p: 4, i: 2 },
	] },
	{ ui: "a2", ab: "Solo", gr: [], yr: [], lg: 2, tk: [{ t: "One", a: [3], d: 100, p: 9, i: 3 }] },
];
const released = () => compile({ albums, artists, category }).catalog;

test("live: a change applies on top of the released catalog only while the catalog has its base", () => {
	const raw = released();
	const index = indexRaw(raw);
	assert.equal(rawValue(index, { kind: "album", id: "a1", field: "ab" }), "Agape No.1");
	assert.equal(rawValue(index, { kind: "album", id: "a2", field: "yr" }), null);
	assert.equal(rawValue(index, { kind: "track", id: 2, field: "h" }), false);
	assert.equal(rawValue(index, { kind: "artist", id: 9, field: "name" }), undefined, "an artist without songs is not shipped");

	const changes = [
		{ kind: "album", id: "a1", field: "ab", value: "Agape No. 1", base: "Agape No.1" },
		{ kind: "album", id: "a2", field: "yr", value: 1990, base: null },
		{ kind: "album", id: "a2", field: "lg", value: 3, base: 2, refs: { langs: [[3, "mizo"]] } },
		{ kind: "album", id: "a1", field: "gr", value: [2, 5], base: [2], refs: { genres: [[2, "Gospel"], [5, "Choir"]] } },
		{ kind: "track", id: 2, field: "a", value: [9], base: [], refs: { artists: [[9, "Unused", "", 2, []]] } },
		{ kind: "artist", id: 3, field: "name", value: "Zam Nu", base: "Zamnu" },
		{ kind: "album", id: "a1", field: "yr", value: 1987, base: 1980 },
		{ kind: "album", id: "zz", field: "ab", value: "x", base: "y" },
		{ kind: "track", id: 1, field: "t", value: "Hong len in", base: "Hong len" },
	];
	const out = patchRaw(raw, changes);
	assert.deepEqual(out.applied.map((c) => `${c.kind}.${c.field}`), ["album.ab", "album.yr", "album.lg", "album.gr", "track.a", "artist.name"]);
	assert.deepEqual(out.done.map((c) => c.id), ["a1", 1], "the release has these values already");
	assert.deepEqual(out.stale.map((c) => c.id), ["zz"], "the record is gone");
	assert.equal(raw.albums[0][1], "Agape No.1", "the released catalog itself is unchanged");

	const model = buildModel(out.raw, { version: "t" });
	assert.equal(model.album("a1").title, "Agape No. 1");
	assert.equal(model.album("a2").year, 1990);
	assert.equal(model.album("a2").lang.name, "mizo");
	assert.deepEqual(model.album("a1").genres.map((g) => g.name), ["Gospel", "Choir"]);
	assert.equal(model.track(2).artists[0].name, "Unused");
	assert.equal(model.track(1).artists[0].name, "Zam Nu");

	// A later release that set the field otherwise wins: the change is stale.
	const later = released();
	later.albums[0][1] = "Agape Volume 1";
	assert.deepEqual(patchRaw(later, changes.slice(0, 1)).stale.length, 1);
});

test("live: a song hidden live leaves the catalog, and its album when it was the last", () => {
	const out = patchRaw(released(), [{ kind: "track", id: 3, field: "h", value: true, base: false }, { kind: "track", id: 2, field: "h", value: true, base: false }]);
	assert.equal(out.applied.length, 2);
	const model = buildModel(out.raw, { version: "t" });
	assert.equal(model.track(3), undefined);
	assert.equal(model.album("a2"), undefined, "its only song hidden");
	assert.deepEqual(model.album("a1").tracks.map((t) => t.id), [1]);
	assert.equal(patchRaw(released(), [{ kind: "track", id: 1, field: "h", value: false, base: true }]).applied.length, 0, "showing a song again needs a release");
});

test("live: applied to the app's model with holds and uploads kept, searched by its new name", () => {
	const model = buildModel(released(), { version: "t" });
	model.extra.tracks.set("u1", { id: "u1" });
	applyHolds(model, { at: 1, albums: { a2: { streaming: false, listed: true } } });
	const out = applyLive(model, [{ kind: "album", id: "a1", field: "ab", value: "Hymns of Agape", base: "Agape No.1" }]);
	assert.equal(out.applied.length, 1);
	assert.equal(model.album("a1").title, "Hymns of Agape");
	assert.equal(model.album("a2").off, true, "holds stay");
	assert.equal(model.track("u1").id, "u1", "uploads stay");
	assert.deepEqual(search(model, "hymns").albums.items.map((a) => a.id), ["a1"]);
	// Holds applied after keep the live change; taking it away gives the released value back.
	applyHolds(model, { at: 2, albums: { a2: { streaming: true, listed: false } } });
	assert.equal(model.album("a1").title, "Hymns of Agape");
	applyLive(model, []);
	assert.equal(model.album("a1").title, "Agape No.1");
	assert.equal(model.album("a2"), undefined, "the hidden album stays hidden");
	assert.throws(() => parseLive({ at: 1, changes: [{ kind: "album", id: "a1", field: "lyrics", value: 1, base: 0 }] }), /not \{ kind/);
});

/* ------------------------------------------------------------ Worker ---- */

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = { "gh-owner": { id: 1, login: "khen" }, "gh-ann": { id: 42, login: "ann" } };
const github = async (url, init) => {
	const checked = tokenCheck(url, init);
	if (checked) return checked;
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	return url.endsWith("/user") ? new Response(JSON.stringify(p)) : new Response("{}", { status: 403 });
};

test("live: the Catalog right makes changes live and takes them away; the public sees the changes", { skip }, async () => {
	const { handleAuth } = await import("../worker/media/auth.js");
	const { handleLive } = await import("../worker/media/live.js");
	const env = { DB: fakeD1(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s" };
	const sessions = {};
	const signIn = async (t) => (sessions[t] ??= (await (await handleAuth(new Request(`${W}/auth/session`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" }), env, { fetchImpl: github })).json()));
	const call = async (who, method, path, body) => {
		const headers = { Origin: ORIGIN };
		if (who) headers.Authorization = `Bearer ${(await signIn(who)).token}`;
		if (body) headers["Content-Type"] = "application/json";
		const res = await handleLive(new Request(`${W}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, null);
		return { status: res.status, body: await res.json(), headers: res.headers };
	};
	assert.deepEqual((await call(null, "GET", "/live")).body, { at: 0, changes: [] });
	const title = { kind: "album", id: "a1", field: "ab", value: "  Agape No. 1 ", base: "Agape No.1" };
	assert.equal((await call(null, "POST", "/live", { changes: [title] })).status, 401);
	assert.equal((await call("gh-ann", "POST", "/live", { changes: [title] })).status, 403, "a member without the right");
	assert.equal((await call("gh-owner", "POST", "/live", { changes: [{ ...title, field: "lyrics" }] })).status, 400);
	assert.equal((await call("gh-owner", "POST", "/live", { changes: [{ kind: "track", id: 1, field: "h", value: false, base: true }] })).status, 400, "showing a song again needs a release");
	assert.equal((await call("gh-owner", "POST", "/live", { changes: [{ ...title, value: "Agape No.1" }] })).status, 400, "nothing changes");
	assert.equal((await call("gh-owner", "POST", "/live", { changes: [{ kind: "album", id: "a1", field: "yr", value: 1800, base: null }] })).status, 400, "checked as the draft checks it");
	assert.equal((await call("gh-owner", "POST", "/live", { changes: [{ kind: "track", id: 2, field: "a", value: [9], base: [], refs: { artists: [[9]] } }] })).status, 400, "refs are checked");

	const made = await call("gh-owner", "POST", "/live", { changes: [title, { kind: "track", id: 2, field: "a", value: [9], base: [], refs: { artists: [[9, "Unused", "", 2, []]] } }] });
	assert.equal(made.status, 200, JSON.stringify(made.body));
	const pub = await call(null, "GET", "/live");
	assert.equal(pub.headers.get("access-control-allow-origin"), "*");
	assert.deepEqual(pub.body.changes.map((c) => [c.kind, c.id, c.field, c.value]), [["album", "a1", "ab", "Agape No. 1"], ["track", 2, "a", [9]]], "cleaned as the draft cleans it, ids typed");
	assert.deepEqual(pub.body.changes[1].refs, { artists: [[9, "Unused", "", 2, []]] });

	// The newest change of a field replaces the one before; who and when are kept for the Workspace only.
	await call("gh-owner", "POST", "/live", { changes: [{ ...title, value: "Agape One" }] });
	const detail = (await call("gh-owner", "GET", "/live/detail")).body;
	assert.deepEqual(detail.changes.map((c) => [c.kind, c.value, c.by]).sort((x, y) => x[0].localeCompare(y[0])), [["album", "Agape One", "khen"], ["track", [9], "khen"]]);
	assert.equal(detail.log.length, 3);
	assert.ok(!("by" in pub.body.changes[0]), "the public sees no names");

	assert.equal((await call("gh-owner", "POST", "/live/remove", { changes: [{ kind: "album", id: "a1", field: "ab" }], why: "nope" })).status, 400);
	const removed = await call("gh-owner", "POST", "/live/remove", { changes: [{ kind: "album", id: "a1", field: "ab" }], why: "released" });
	assert.deepEqual(removed.body.changes.map((c) => c.id), [2]);
	assert.equal((await call("gh-owner", "GET", "/live/detail")).body.log[0].action, "released");
});

test("live: a song's length changes live, and the album's total with it", () => {
	const raw = released();
	assert.equal(rawValue(indexRaw(raw), { kind: "track", id: 2, field: "d" }), 95);
	const out = patchRaw(raw, [{ kind: "track", id: 2, field: "d", value: 180, base: 95, refs: {} }]);
	assert.equal(out.applied.length, 1);
	const model = buildModel(out.raw, { version: "t" });
	assert.equal(model.tracks.get(2).duration, 180);
	assert.equal(model.albums.get("a1").duration, 252 + 180);
});
