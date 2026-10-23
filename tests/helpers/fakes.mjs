/**
 * Stand-ins for the Worker's bindings in tests: D1 over node:sqlite (real
 * SQL, the schema from worker/media/schema.sql), R2 over a Map, and a rate
 * limiter. node:sqlite needs Node 22.13 or later; `sqlite` is null before.
 */
import { readFileSync } from "node:fs";

let DatabaseSync = null;
try {
	({ DatabaseSync } = await import("node:sqlite"));
} catch { /* older Node: tests that need it are skipped */ }
export const sqlite = DatabaseSync;

/** A D1-like database with the Worker's schema. */
export function fakeD1() {
	const db = new DatabaseSync(":memory:");
	const schema = readFileSync(new URL("../../worker/media/schema.sql", import.meta.url), "utf8")
		.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
	db.exec(schema);
	const statement = (sql, args = []) => ({
		bind: (...a) => statement(sql, a),
		async first() { return db.prepare(sql).get(...args) ?? null; },
		async all() { return { results: db.prepare(sql).all(...args) }; },
		async run() {
			const r = db.prepare(sql).run(...args);
			return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
		},
	});
	return {
		raw: db,
		prepare: (sql) => statement(sql),
		withSession: () => ({ prepare: (sql) => statement(sql) }),
		async batch(list) { return Promise.all(list.map((s) => s.run())); },
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
		async delete(key) { objects.delete(key); },
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
