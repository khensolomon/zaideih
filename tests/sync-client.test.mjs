import assert from "node:assert/strict";
import { test } from "node:test";
import { collapse, createSync, MAX_CHANGES } from "../src/core/sync.js";

/** A device: its kept state, its library, and a server that answers as told. */
function device({ member = 7, online = true, library = { likes: [], playlists: [] } } = {}) {
	let state = { outbox: [], since: 0, member: null };
	const sent = [];
	const applied = [];
	const d = {
		member, online, library, sent, applied,
		answer: (body) => ({ since: body.since + 1, likes: [], playlists: [] }),
		get state() { return state; },
	};
	d.engine = createSync({
		load: async () => structuredClone(state),
		save: async (s) => { state = structuredClone(s); },
		local: async () => d.library,
		apply: async (remote, pending) => { applied.push({ remote, pending: [...pending] }); return remote.likes.length + remote.playlists.length > 0; },
		send: async (body) => { sent.push(structuredClone(body)); return d.answer(body); },
		member: async () => d.member,
		online: () => d.online,
		now: () => 1000,
	});
	return d;
}

test("collapse keeps the latest change per song and per playlist", () => {
	const out = collapse([
		{ kind: "like", track: 1, liked: true, at: 1 },
		{ kind: "playlist", uid: "a", at: 1 },
		{ kind: "like", track: 1, liked: false, at: 2 },
		{ kind: "like", track: 2, liked: true, at: 3 },
	]);
	assert.deepEqual(out.map((c) => [c.kind, c.track ?? c.uid, c.at]), [["like", 1, 2], ["playlist", "a", 1], ["like", 2, 3]]);
});

test("the first sync of an account sends what the device has, marked offline", async () => {
	const d = device({ library: { likes: [{ id: 5, at: 900 }], playlists: [{ uid: "0123456789abcdef", name: "Road", tracks: [5], updated: 950, version: 0 }] } });
	await d.engine.run();
	assert.equal(d.sent.length, 1);
	assert.deepEqual(d.sent[0].changes.map((c) => [c.kind, c.offline, c.at]), [["like", true, 900], ["playlist", true, 950]]);
	assert.equal(d.sent[0].changes[1].base, 0);
	assert.deepEqual(d.state, { outbox: [], since: 1, member: 7 });
	// Next time, only what changed.
	await d.engine.run();
	assert.deepEqual(d.sent[1], { since: 1, changes: [] });
});

test("signed out, nothing is sent and the next account starts afresh", async () => {
	const d = device();
	await d.engine.run();
	d.member = null;
	await d.engine.run();
	assert.equal(d.sent.length, 1);
	assert.deepEqual(d.state, { outbox: [], since: 0, member: null });
});

test("a change made offline, or one that could not be sent, is an offline change", async () => {
	const d = device();
	await d.engine.run();
	d.online = false;
	await d.engine.note({ kind: "like", track: 3, liked: true });
	assert.equal(d.state.outbox[0].offline, true);
	d.online = true;
	await d.engine.note({ kind: "like", track: 4, liked: true });
	assert.equal(d.state.outbox[1].offline, false);
	d.answer = () => { throw new Error("no network"); };
	await assert.rejects(d.engine.run(), /no network/);
	assert.deepEqual(d.state.outbox.map((c) => c.offline), [true, true]);
	d.answer = (body) => ({ since: body.since + 1, likes: [], playlists: [] });
	await d.engine.run();
	assert.deepEqual(d.state.outbox, []);
});

test("more than a request holds is sent in turn; changes still waiting are kept from what comes back", async () => {
	const d = device();
	await d.engine.run();
	for (let i = 1; i <= MAX_CHANGES + 3; i++) await d.engine.note({ kind: "like", track: i, liked: true });
	// The server answers the first batch with a change to song 27, which still waits here.
	d.answer = (body) => ({ since: body.since + 1, likes: body.since === 1 ? [{ track: 27, liked: false, at: 1 }] : [], playlists: [] });
	await d.engine.run();
	const batches = d.sent.slice(1).map((b) => b.changes.length);
	assert.deepEqual(batches, [MAX_CHANGES, 3]);
	assert.ok(d.applied[1].pending.includes("like:27"), "song 27 was still waiting, so it keeps the device's change");
	assert.deepEqual(d.state.outbox, []);
});

test("a change made while a request is out stays in the outbox", async () => {
	const d = device();
	await d.engine.run();
	await d.engine.note({ kind: "like", track: 1, liked: true, at: 10 });
	let release;
	const gate = new Promise((r) => { release = r; });
	d.answer = async (body) => { await gate; return { since: body.since + 1, likes: [], playlists: [] }; };
	const running = d.engine.run();
	await new Promise((r) => setTimeout(r, 5));
	await d.engine.note({ kind: "like", track: 1, liked: false, at: 20 });
	release();
	await running;
	// The unlike was sent next, not dropped with the like it replaced.
	assert.deepEqual(d.sent.at(-1).changes.map((c) => [c.track, c.liked]), [[1, false]]);
	assert.deepEqual(d.state.outbox, []);
});

test("forget clears the sync state", async () => {
	const d = device();
	await d.engine.run();
	await d.engine.note({ kind: "like", track: 1, liked: true });
	await d.engine.forget();
	assert.deepEqual(d.state, { outbox: [], since: 0, member: null });
});
