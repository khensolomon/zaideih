import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// Minimal stand-ins for the Workers runtime: the edge cache, D1 and R2.
const edge = new Map();
globalThis.caches = {
	default: {
		match: async (req) => edge.get(req.url)?.clone(),
		put: async (req, res) => { edge.set(req.url, res); },
	},
};

const { default: worker, parseRangeOption } = await import("../worker/media/script.js");

const AUDIO = new Uint8Array(1000).map((_, i) => i % 256);

function makeEnv({ rows = { 7: { folder_path: "zola/Agape/Agape No.1", mp3: "Hong len in.mp3" } }, objects } = {}) {
	const statusWrites = [];
	const store = objects ?? { "music/zola/Agape/Agape No.1/Hong len in.mp3": AUDIO };
	const db = {
		prepare(sql) {
			return {
				bind: (...args) => ({
					first: async () => rows[args[0]] ?? null,
					run: async () => { statusWrites.push({ sql, args }); },
				}),
			};
		},
	};
	return {
		statusWrites,
		env: {
			ALLOWED_ORIGINS: "https://zaideih.com, app://zaideih",
			DB: { ...db, withSession: () => db },
			BUCKET: {
				get: async (key, opts) => {
					const data = store[key];
					if (!data) return null;
					const offset = opts?.range?.offset ?? 0;
					const length = opts?.range?.length ?? data.length - offset;
					return {
						size: data.length,
						httpEtag: '"etag-1"',
						range: opts?.range ? { offset, length } : undefined,
						body: data.slice(offset, offset + length),
						writeHttpMetadata: () => {},
					};
				},
			},
		},
	};
}

const ctx = () => {
	const waits = [];
	return { waits, waitUntil: (p) => waits.push(p), done: () => Promise.all(waits) };
};

const call = async (path, { method = "GET", headers = {}, env } = {}) => {
	const c = ctx();
	const res = await worker.fetch(new Request(`https://media.zaideih.com${path}`, { method, headers }), env, c);
	await c.done();
	return res;
};

beforeEach(() => edge.clear());

test("audio element request streams the full file", async () => {
	const { env, statusWrites } = makeEnv();
	const res = await call("/audio/7", { env, headers: { "sec-fetch-dest": "audio" } });
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("content-length"), "1000");
	assert.equal(res.headers.get("content-type"), "audio/mpeg");
	assert.equal(res.headers.get("access-control-allow-origin"), null);
	assert.equal((await res.arrayBuffer()).byteLength, 1000);
	assert.match(statusWrites[0].sql, /served/);
});

test("range request returns 206 with Content-Range", async () => {
	const { env } = makeEnv();
	const res = await call("/audio/7", { env, headers: { "sec-fetch-dest": "audio", range: "bytes=100-199" } });
	assert.equal(res.status, 206);
	assert.equal(res.headers.get("content-range"), "bytes 100-199/1000");
	assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test("fetch() from an allowed origin gets CORS headers", async () => {
	const { env } = makeEnv();
	const res = await call("/audio/7", { env, headers: { "sec-fetch-dest": "empty", origin: "app://zaideih" } });
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("access-control-allow-origin"), "app://zaideih");
	assert.match(res.headers.get("access-control-expose-headers"), /Content-Length/);
	assert.match(res.headers.get("vary"), /Origin/);
});

test("fetch() from another origin is refused", async () => {
	const { env } = makeEnv();
	const res = await call("/audio/7", { env, headers: { "sec-fetch-dest": "empty", origin: "https://evil.example" } });
	assert.equal(res.status, 403);
	const noOrigin = await call("/audio/7", { env, headers: { "sec-fetch-dest": "empty" } });
	assert.equal(noOrigin.status, 403);
});

test("other fetch destinations are refused", async () => {
	const { env } = makeEnv();
	const res = await call("/audio/7", { env, headers: { "sec-fetch-dest": "document", origin: "https://zaideih.com" } });
	assert.equal(res.status, 403);
});

test("preflight succeeds only for allowed origins", async () => {
	const { env } = makeEnv();
	const ok = await call("/audio/7", { env, method: "OPTIONS", headers: { origin: "https://zaideih.com" } });
	assert.equal(ok.status, 204);
	assert.match(ok.headers.get("access-control-allow-headers"), /Range/);
	const bad = await call("/audio/7", { env, method: "OPTIONS", headers: { origin: "https://evil.example" } });
	assert.equal(bad.status, 403);
});

test("unknown track is 404 and is not recorded", async () => {
	const { env, statusWrites } = makeEnv();
	const res = await call("/audio/8", { env, headers: { "sec-fetch-dest": "audio" } });
	assert.equal(res.status, 404);
	assert.equal(statusWrites.length, 0);
});

test("missing R2 object is 404 and recorded as not_found", async () => {
	const { env, statusWrites } = makeEnv({ objects: {} });
	const res = await call("/audio/7", { env, headers: { "sec-fetch-dest": "audio" } });
	assert.equal(res.status, 404);
	assert.match(statusWrites[0].sql, /not_found/);
});

test("HEAD has headers but no body; bad methods and paths are rejected", async () => {
	const { env } = makeEnv();
	const head = await call("/audio/7", { env, method: "HEAD" });
	assert.equal(head.status, 200);
	assert.equal(head.headers.get("content-length"), "1000");
	assert.equal(head.body, null);
	assert.equal((await call("/audio/7", { env, method: "POST" })).status, 405);
	assert.equal((await call("/audio/0", { env })).status, 400);
	assert.equal((await call("/sync/ping", { env })).status, 404);
});

test("parseRangeOption handles open, closed and invalid ranges", () => {
	assert.deepEqual(parseRangeOption("bytes=5-"), { range: { offset: 5 } });
	assert.deepEqual(parseRangeOption("bytes=5-9"), { range: { offset: 5, length: 5 } });
	assert.equal(parseRangeOption("bytes=9-5"), undefined);
	assert.equal(parseRangeOption("bytes=-500"), undefined);
	assert.equal(parseRangeOption(null), undefined);
});
