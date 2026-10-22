import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { D1Error, isSystemTable, resetSql, schemaSql, schemaTables, wranglerRows } from "../tools/lib/d1.mjs";

const schema = await readFile(new URL("../worker/media/schema.sql", import.meta.url), "utf8");

test("the schema is one idempotent file with the Worker's tables", () => {
	assert.deepEqual(schemaTables(schema), ["tracks", "tracks_status", "plays"]);
	const sql = schemaSql(schema);
	assert.doesNotMatch(sql, /--/);
	for (const stmt of sql.split(";").map((x) => x.trim()).filter(Boolean)) assert.match(stmt, /^CREATE (TABLE|INDEX) IF NOT EXISTS/);
	assert.throws(() => schemaSql("-- nothing"), D1Error);
});

test("reset drops every table but Cloudflare's own, recreates the schema and loads the paths", () => {
	const sql = resetSql({
		tables: ["_cf_METADATA", "django_session", "plays", "tracks", "tracks_status"],
		schema,
		tracks: "INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (1, 'a', 'b.mp3', 0);",
		plays: [{ track_id: 1, day: "2026-10-21", n: 5 }, { track_id: 2, day: "2026-10-22", n: 1 }],
	});
	assert.doesNotMatch(sql, /_cf_METADATA/);
	for (const t of ["django_session", "plays", "tracks", "tracks_status"]) assert.match(sql, new RegExp(`DROP TABLE IF EXISTS "${t}";`));
	const order = ["DROP TABLE", "CREATE TABLE IF NOT EXISTS tracks", "INSERT INTO tracks", "INSERT INTO plays"].map((s) => sql.indexOf(s));
	assert.deepEqual([...order].sort((a, b) => a - b), order, "drop, create, load, then the kept plays");
	assert.match(sql, /\(1, '2026-10-21', 5\),\n\(2, '2026-10-22', 1\);/);
	assert.throws(() => resetSql({ tables: [], schema, tracks: "", plays: [{ track_id: 1, day: "x'); DROP", n: 1 }] }), D1Error);
	assert.equal(isSystemTable("sqlite_sequence"), true);
});

test("wrangler's JSON output: rows, or a clear error", () => {
	const out = '▲ [WARNING] proxy\n[{"results":[{"name":"plays"}],"success":true,"meta":{}}]';
	assert.deepEqual(wranglerRows(out), [{ name: "plays" }]);
	assert.throws(() => wranglerRows("✘ [ERROR] not logged in"), /did not print JSON/);
	assert.throws(() => wranglerRows('[{"success":false,"error":"no such table"}]'), /no such table/);
});
