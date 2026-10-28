/**
 * Stand-ins for the Worker's bindings in tests: D1 over node:sqlite (real
 * SQL, the schema from worker/media/schema.sql), R2 over a Map, and a rate
 * limiter. node:sqlite needs Node 22.13 or later; `sqlite` is null before.
 */
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try {
	({ DatabaseSync } = await import("node:sqlite"));
} catch (err) {
	// Older Node: the tests that need it are skipped on a laptop, but never on CI, where a skip would pass for a test that did not run.
	if (process.env.CI) throw new Error(`node:sqlite is not available (${err.message}); the Worker tests need Node 22.13 or later`);
}
export const sqlite = DatabaseSync;

/** A D1-like database with the Worker's schema. */
export function fakeD1() {
	const db = new DatabaseSync(":memory:");
	const schema = readFileSync(new URL("../../worker/media/schema.sql", import.meta.url), "utf8")
		.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
	db.exec(schema);
	// Queries as D1 counts them against its limit per Worker invocation (50 on the Free
	// plan): each first/all/run is one, and a whole batch() is one.
	const counter = { queries: 0, inBatch: false };
	const count = () => { if (!counter.inBatch) counter.queries += 1; };
	const statement = (sql, args = []) => ({
		bind: (...a) => statement(sql, a),
		async first() { count(); return db.prepare(sql).get(...args) ?? null; },
		async all() { count(); return { results: db.prepare(sql).all(...args) }; },
		async run() {
			count();
			const r = db.prepare(sql).run(...args);
			return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
		},
	});
	return {
		raw: db,
		counter,
		prepare: (sql) => statement(sql),
		withSession: () => ({ prepare: (sql) => statement(sql) }),
		// All or nothing, as D1 runs a batch in one transaction.
		async batch(list) {
			counter.queries += 1;
			counter.inBatch = true;
			db.exec("BEGIN");
			try {
				const out = [];
				for (const s of list) out.push(await s.run());
				db.exec("COMMIT");
				return out;
			} catch (err) {
				db.exec("ROLLBACK");
				throw err;
			} finally {
				counter.inBatch = false;
			}
		},
	};
}

/** An R2-like bucket in memory. */
export function fakeR2() {
	const objects = new Map();
	const read = async (body) => {
		if (body instanceof Uint8Array) return body;
		if (typeof body === "string") return new TextEncoder().encode(body);
		if (body instanceof ArrayBuffer) return new Uint8Array(body);
		return new Uint8Array(await new Response(body).arrayBuffer());
	};
	return {
		objects,
		async put(key, body, options = {}) { objects.set(key, { bytes: await read(body), type: options.httpMetadata?.contentType }); },
		async get(key, options = {}) {
			const o = objects.get(key);
			if (!o) return null;
			const r = options.range;
			const offset = r?.offset ?? 0;
			const length = r?.length ?? o.bytes.length - offset;
			const part = o.bytes.slice(offset, offset + length);
			return {
				size: o.bytes.length,
				range: r ? { offset, length: part.length } : undefined,
				body: new Response(part).body,
				arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength),
				writeHttpMetadata() {},
			};
		},
		// One key, or several at once (R2 takes up to 1,000 in one call).
		async delete(key) { for (const k of [key].flat()) objects.delete(k); },
		async head(key) { const o = objects.get(key); return o ? { size: o.bytes.length } : null; },
		/** Like R2's list(): objects under a prefix, and with a delimiter the "folders" one level down. */
		async list({ prefix = "", delimiter, limit = 1000 } = {}) {
			const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
			const folders = new Set();
			const direct = [];
			for (const k of keys) {
				const rest = k.slice(prefix.length);
				const cut = delimiter ? rest.indexOf(delimiter) : -1;
				if (cut >= 0) folders.add(prefix + rest.slice(0, cut + 1));
				else direct.push({ key: k, size: objects.get(k).bytes.length });
			}
			return { objects: direct.slice(0, limit), delimitedPrefixes: [...folders], truncated: direct.length > limit, cursor: direct.length > limit ? "next" : undefined };
		},
	};
}

export function fakeLimiter(ok = true) {
	return { keys: [], async limit({ key }) { this.keys.push(key); return { success: typeof ok === "function" ? ok(key) : ok }; } };
}

/**
 * GitHub's "Check a token" (POST /applications/<client id>/token), as the Worker asks it
 * for a GitHub sign-in (accounts.js issuedToZaideih): a token named "pat-…" stands for a
 * personal or other app's token (404); any other is Zaideih's own (200). Null for other addresses.
 */
export function tokenCheck(url, init) {
	if (!/\/applications\/[^/]+\/token$/.test(url)) return null;
	const token = JSON.parse(init.body).access_token;
	return token.startsWith("pat-") ? new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }) : new Response(JSON.stringify({ token }), { status: 200 });
}
