import assert from "node:assert/strict";
import { test } from "node:test";

const edge = new Map();
globalThis.caches = { default: { match: async (req) => edge.get(req.url)?.clone(), put: async (req, res) => { edge.set(req.url, res); } } };
const { default: worker, parsePlays, playDay } = await import("../worker/media/script.js");
const { createPlayQueue, createPlayTracker } = await import("../src/core/plays.js");

const NOW = Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------ Worker ---- */

function limiter(limit) {
	const used = new Map();
	return { used, limit: async ({ key }) => { const n = (used.get(key) ?? 0) + 1; used.set(key, n); return { success: n <= limit }; } };
}

function makeEnv({ known = [7, 8] } = {}) {
	const writes = [];
	const prepare = (sql) => ({
		bind: (...args) => ({
			sql, args,
			all: async () => ({ results: args.filter((id) => known.includes(id)).map((id) => ({ id })) }),
		}),
	});
	return {
		writes,
		env: {
			PLAY_ORIGINS: "https://zaideih.com, app://zaideih",
			PLAYS_LIMIT: limiter(20),
			TRACK_LIMIT: limiter(1),
			DB: { prepare, batch: async (stmts) => { writes.push(...stmts.map((s) => s.args)); } },
		},
	};
}

const post = (env, body, { origin = "https://zaideih.com", ip = "203.0.113.5", method = "POST" } = {}) =>
	worker.fetch(new Request("https://media.zaideih.com/plays", {
		method,
		headers: { ...(origin ? { origin } : {}), "cf-connecting-ip": ip, "content-type": "text/plain" },
		body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
	}), env, { waitUntil: (p) => p });

test("plays from the app are counted per track and day", async () => {
	const { env, writes } = makeEnv();
	const res = await post(env, { v: 1, plays: [[7, NOW], [8, NOW - 86400], [7, NOW - 60]] });
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("access-control-allow-origin"), "https://zaideih.com");
	assert.deepEqual(await res.json(), { accepted: 3, rejected: [] });
	assert.deepEqual(writes.sort(), [[7, playDay(NOW), 2], [8, playDay(NOW - 86400), 1]].sort());
});

test("unknown, invalid, stale and future plays are named, the rest counted", async () => {
	const { env, writes } = makeEnv();
	const res = await post(env, { v: 1, plays: [[99, NOW], ["7", NOW], [7, NOW - 40 * 86400], [7, NOW + 7200], [8, NOW]] });
	const body = await res.json();
	assert.equal(res.status, 200);
	assert.equal(body.accepted, 1);
	assert.deepEqual(body.rejected, [[0, "unknown-track"], [1, "invalid"], [2, "too-old"], [3, "in-future"]]);
	assert.deepEqual(writes, [[8, playDay(NOW), 1]]);
});

test("a track counts at most 3 times a request and once a minute per sender", async () => {
	const { env } = makeEnv();
	const first = await (await post(env, { v: 1, plays: [[7, NOW], [7, NOW], [7, NOW], [7, NOW]] })).json();
	assert.equal(first.accepted, 3);
	assert.deepEqual(first.rejected, [[3, "repeated"]]);
	const again = await (await post(env, { v: 1, plays: [[7, NOW], [8, NOW]] })).json();
	assert.equal(again.accepted, 1);
	assert.deepEqual(again.rejected, [[0, "rate-limited"]]);
	const otherSender = await (await post(env, { v: 1, plays: [[7, NOW]] }, { ip: "198.51.100.9" })).json();
	assert.equal(otherSender.accepted, 1);
});

test("too many requests from one sender get 429", async () => {
	const { env } = makeEnv();
	env.PLAYS_LIMIT = limiter(1);
	assert.equal((await post(env, { v: 1, plays: [[7, NOW]] })).status, 200);
	const res = await post(env, { v: 1, plays: [[8, NOW]] });
	assert.equal(res.status, 429);
	assert.equal(res.headers.get("retry-after"), "60");
});

test("malformed requests are refused as a whole with the reason", async () => {
	const { env, writes } = makeEnv();
	const bad = async (body) => { const r = await post(env, body); return [r.status, await r.text()]; };
	assert.deepEqual(await bad("not json"), [400, "body is not JSON"]);
	assert.equal((await bad({ plays: [[7, NOW]] }))[0], 400);
	assert.deepEqual(await bad({ v: 1, plays: [] }), [400, "no plays"]);
	assert.match((await bad({ v: 1, plays: Array.from({ length: 51 }, () => [7, NOW]) }))[1], /at most 50/);
	assert.equal((await bad("x".repeat(9000)))[0], 413);
	assert.equal(writes.length, 0);
});

test("only the released app's origins may count", async () => {
	const { env } = makeEnv();
	assert.equal((await post(env, { v: 1, plays: [[7, NOW]] }, { origin: "http://localhost:8080" })).status, 403);
	assert.equal((await post(env, { v: 1, plays: [[7, NOW]] }, { origin: null })).status, 403);
	const pre = await post(env, null, { method: "OPTIONS", origin: "app://zaideih" });
	assert.equal(pre.status, 204);
	assert.equal(pre.headers.get("access-control-allow-origin"), "app://zaideih");
	assert.equal((await post(env, null, { method: "PUT" })).status, 405);
});

test("a missing rate limiter is a configuration error, not silent counting", async () => {
	const { env, writes } = makeEnv();
	delete env.TRACK_LIMIT;
	const res = await post(env, { v: 1, plays: [[7, NOW]] });
	assert.equal(res.status, 500);
	assert.equal(writes.length, 0);
});

test("parsePlays and playDay", () => {
	assert.equal(playDay(Date.UTC(2026, 9, 21, 23, 59) / 1000), "2026-10-21");
	assert.deepEqual(parsePlays('{"v":1,"plays":[[1,5]]}', 10), { plays: [{ index: 0, id: 1, at: 5 }], rejected: [] });
});

/* ------------------------------------------------------------ tracker ---- */

function play(tracker, from, to, { step = 0.25, playing = true, duration = 200 } = {}) {
	const counted = [];
	for (let t = from + step; t <= to + 1e-9; t += step) {
		const id = tracker.time(t, playing, duration);
		if (id !== null) counted.push(id);
	}
	return counted;
}

test("a play counts after 10 seconds of listening, once", () => {
	const tr = createPlayTracker();
	tr.load(5);
	assert.deepEqual(play(tr, 0, 9.5), []);
	assert.deepEqual(play(tr, 9.5, 30), [5]);
	tr.seek(40);
	assert.deepEqual(play(tr, 40, 60), []);
});

test("seeking forward and paused progress do not count as listening", () => {
	const tr = createPlayTracker();
	tr.load(5);
	play(tr, 0, 4);
	tr.seek(150);
	assert.deepEqual(play(tr, 150, 155), []);
	assert.equal(tr.time(190, true, 200), null); // a jump without a seek event
	assert.deepEqual(play(tr, 190, 200, { playing: false }), []);
	assert.deepEqual(play(tr, 200, 201.5), [5]);
});

test("pause and resume count once; restart and replay count again", () => {
	const tr = createPlayTracker();
	tr.load(5);
	assert.deepEqual(play(tr, 0, 12), [5]);
	assert.deepEqual(play(tr, 12, 40), []);
	tr.seek(0); // restarted from the beginning
	assert.deepEqual(play(tr, 0, 11), [5]);
	assert.equal(tr.ended(), null); // already counted
	tr.seek(0); // repeat one
	assert.deepEqual(play(tr, 0, 11), [5]);
	tr.load(6);
	assert.deepEqual(play(tr, 0, 11), [6]);
});

test("a song shorter than 10 seconds counts near its end", () => {
	const tr = createPlayTracker();
	tr.load(9);
	assert.deepEqual(play(tr, 0, 6, { duration: 6 }), [9]);
	tr.load(9);
	play(tr, 0, 2, { duration: 6 });
	assert.equal(tr.ended(), 9);
});

/* ------------------------------------------------------------ queue ---- */

function memoryStorage() {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("queued plays are sent in batches and removed once accepted", async () => {
	const sent = [];
	let t = 1_000_000_000_000;
	const q = createPlayQueue({ url: "https://x/plays", storage: memoryStorage(), now: () => t, send: async (body) => { sent.push(JSON.parse(body)); return new Response(JSON.stringify({ accepted: 1, rejected: [] })); } });
	for (let i = 0; i < 60; i++) { q.add(i + 1); t += 1000; }
	await q.flush();
	assert.equal(sent[0].plays.length, 50);
	assert.equal(q.pending().length, 10);
	await q.flush();
	assert.equal(q.pending().length, 0);
	assert.deepEqual(sent[0].plays[0], [1, 1_000_000_000]);
});

test("offline or failing sends keep plays; refused batches are dropped", async () => {
	let status = 503;
	let isOnline = false;
	const q = createPlayQueue({ url: "https://x/plays", storage: memoryStorage(), online: () => isOnline, send: async () => new Response("no", { status }) });
	const warn = console.warn;
	console.warn = () => {};
	try {
		q.add(1);
		await q.flush();
		assert.equal(q.pending().length, 1, "offline: kept");
		isOnline = true;
		await q.flush();
		assert.equal(q.pending().length, 1, "server error: kept for retry");
		status = 429;
		await q.flush();
		assert.equal(q.pending().length, 1, "rate limited: kept for retry");
		status = 404;
		await q.flush();
		assert.equal(q.pending().length, 1, "endpoint not deployed yet: kept for retry");
		status = 400;
		await q.flush();
		assert.equal(q.pending().length, 0, "refused: dropped");
	} finally {
		console.warn = warn;
	}
});

test("with no URL (dev builds) nothing is queued", () => {
	const storage = memoryStorage();
	const q = createPlayQueue({ url: "", storage });
	q.add(1);
	assert.equal(q.enabled, false);
	assert.equal(q.pending().length, 0);
});

test("GET /plays gives the totals per track, public and cached at the edge", async () => {
	edge.clear();
	let queries = 0;
	const env = { DB: { prepare: (sql) => ({ all: async () => { queries += 1; assert.match(sql, /GROUP BY track_id/); return { results: [{ id: 7, total: 12, recent: 3 }, { id: 8, total: 1, recent: 1 }] }; } }) } };
	const get = () => worker.fetch(new Request("https://media.zaideih.com/plays", { headers: { origin: "https://elsewhere.example" } }), env, { waitUntil: (p) => p });
	const res = await get();
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("access-control-allow-origin"), "*");
	assert.match(res.headers.get("cache-control"), /max-age=300/);
	const body = await res.json();
	assert.equal(body.v, 1);
	assert.equal(body.recentDays, 30);
	assert.deepEqual(body.tracks, [[7, 12, 3], [8, 1, 1]]);
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual((await (await get()).json()).tracks, body.tracks);
	assert.equal(queries, 1, "the second read comes from the edge cache");
});

test("GET /plays says so when D1 cannot be read", async () => {
	edge.clear();
	const env = { DB: { prepare: () => ({ all: async () => { throw new Error("D1 down"); } }) } };
	const err = console.error;
	console.error = () => {};
	try {
		const res = await worker.fetch(new Request("https://media.zaideih.com/plays"), env, { waitUntil: (p) => p });
		assert.equal(res.status, 503);
	} finally { console.error = err; }
});

test("GET /plays/stats gives the first day, the plays of each day and the last 7 days per song", async () => {
	edge.clear();
	const sqls = [];
	const env = { DB: { prepare: (sql) => {
		sqls.push(sql);
		return {
			first: async () => ({ day: "2026-09-01" }),
			all: async () => ({ results: /GROUP BY day/.test(sql) ? [{ day: "2026-09-01", n: 4 }, { day: "2026-09-03", n: 2 }] : [{ id: 7, n: 3 }] }),
		};
	} } };
	const get = () => worker.fetch(new Request("https://media.zaideih.com/plays/stats"), env, { waitUntil: (p) => p });
	const res = await get();
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("access-control-allow-origin"), "*");
	const body = await res.json();
	assert.equal(body.v, 1);
	assert.equal(body.first, "2026-09-01");
	assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
	assert.deepEqual(body.days, [["2026-09-01", 4], ["2026-09-03", 2]]);
	assert.deepEqual(body.week, [[7, 3]]);
	assert.ok(sqls.some((s) => /-6 days/.test(s)), "the week is today and the 6 days before");
	await new Promise((r) => setTimeout(r, 0));
	const n = sqls.length;
	await get();
	assert.equal(sqls.length, n, "the second read comes from the edge cache");
});
