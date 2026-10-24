import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { D1Error, isSystemTable, lyricsBackup, migrationPlan, migrationSql, recordMigrationsSql, resetSql, schemaSql, schemaTables, wranglerRows } from "../tools/lib/d1.mjs";
import { sqlite } from "./helpers/fakes.mjs";

const schema = await readFile(new URL("../worker/media/schema.sql", import.meta.url), "utf8");

test("the schema is one idempotent file with the Worker's tables", () => {
	assert.deepEqual(schemaTables(schema), ["tracks", "tracks_status", "plays", "schema_migrations", "members", "member_logins", "member_sessions", "uploads", "member_rights", "member_folders", "publish_requests", "published_tracks", "signin_waiting", "passkeys", "passkey_challenges", "library_likes", "library_playlists", "library_sync", "lyrics", "lyrics_versions", "lyrics_reports", "lyrics_links", "lyrics_times"]);
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

test("reset refuses to lose personal libraries unless asked", async () => {
	const { libraryGuard } = await import("../tools/lib/d1.mjs");
	assert.equal(libraryGuard({ members: 0, uploads: 0 }, false), null);
	assert.match(libraryGuard({ members: 3, uploads: 12 }, false), /^members holds 3 rows and uploads holds 12 rows\. Personal libraries cannot be rebuilt from git.*--drop-library/);
	assert.equal(libraryGuard({ members: 3, uploads: 12 }, true), null);
});

const migration = (name) => readFile(new URL(`../worker/media/migrations/${name}`, import.meta.url), "utf8");

test("migrations run once each, and a new database records them without running them", () => {
	const names = ["0001-accounts.sql", "0002-later.sql"];
	assert.deepEqual(migrationPlan({ tables: ["members"], applied: [], migrations: names }), { run: names, record: [] });
	assert.deepEqual(migrationPlan({ tables: ["members", "schema_migrations"], applied: ["0001-accounts.sql"], migrations: names }), { run: ["0002-later.sql"], record: [] });
	assert.deepEqual(migrationPlan({ tables: [], applied: [], migrations: names }), { run: [], record: names });
	assert.throws(() => migrationPlan({ tables: ["members"], applied: ["0003-newer.sql"], migrations: names }), /does not have \(0003-newer.sql\); update the checkout/);
	assert.throws(() => migrationPlan({ tables: [], applied: [], migrations: ["accounts.sql"] }), /must look like 0001-/);
	const reset = resetSql({ tables: [], schema, tracks: "", migrations: names, nowSeconds: 5 });
	assert.match(reset, /INSERT INTO schema_migrations \(name, applied_at\) VALUES \('0002-later.sql', 5\);/);
});

test("migrations from 26.10.23: members keep their ids as accounts, with their GitHub sign-in, and the database matches the schema", { skip: !sqlite && "node:sqlite needs Node 22.13 or later" }, async () => {
	const strip = (t) => t.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
	const old = new sqlite(":memory:");
	old.exec(strip(await readFile(new URL("./fixtures/schema-26.10.23.sql", import.meta.url), "utf8")));
	old.exec(`INSERT INTO members (github_id, login, moderator, first_seen, last_seen) VALUES (1753766, 'khensolomon', 0, 10, 20), (42, 'ann', 1, 11, 21);
		INSERT INTO member_rights (github_id, kind, granted_by, granted_at) VALUES (42, 'review', 'khensolomon', 12);
		INSERT INTO member_folders (github_id, prefix, set_by, set_at) VALUES (42, 'shared/ann/', 'khensolomon', 13);
		INSERT INTO uploads (owner_id, r2_key, size, format, duration, title, file_name, status, created_at, updated_at) VALUES (42, 'users/42/1.mp3', 1, 'mp3', 1, 'One', '1.mp3', 'private', 1, 1);`);
	// Every migration in order, then the schema: as `tools/d1.mjs schema` does.
	const { readdir } = await import("node:fs/promises");
	const names = (await readdir(new URL("../worker/media/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort();
	for (const name of names) old.exec(migrationSql(name, await migration(name), 99));
	old.exec(schemaSql(schema));
	assert.deepEqual(old.prepare("SELECT id, name, moderator FROM members ORDER BY id").all().map((r) => ({ ...r })), [{ id: 42, name: "ann", moderator: 1 }, { id: 1753766, name: "khensolomon", moderator: 0 }]);
	assert.deepEqual(old.prepare("SELECT provider, subject, member_id, login, created_at FROM member_logins ORDER BY member_id").all().map((r) => ({ ...r })), [
		{ provider: "github", subject: "42", member_id: 42, login: "ann", created_at: 11 },
		{ provider: "github", subject: "1753766", member_id: 1753766, login: "khensolomon", created_at: 10 },
	]);
	assert.equal(old.prepare("SELECT member_id FROM member_rights").get().member_id, 42);
	assert.equal(old.prepare("SELECT prefix FROM member_folders WHERE member_id = 42").get().prefix, "shared/ann/");
	assert.deepEqual(old.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((r) => r.name), names);
	// A new member is numbered after the highest id.
	old.exec("INSERT INTO members (name, first_seen, last_seen) VALUES ('new', 1, 1)");
	assert.equal(old.prepare("SELECT id FROM members WHERE name = 'new'").get().id, 1753767);

	// The migrated database has the same tables and columns as one made from the schema now.
	const fresh = new sqlite(":memory:");
	fresh.exec(schemaSql(schema));
	fresh.exec(recordMigrationsSql(["0001-accounts.sql"], 1));
	const shape = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
		.map(({ name }) => [name, db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => `${c.name} ${c.type} ${c.notnull} ${c.pk}`)]));
	assert.deepEqual(shape(old), shape(fresh));
});

test("lyricsBackup keeps what is shown and every version, with member ids only", () => {
	const lyrics = [{ track: 5, version: 2, updated_at: 10, updated_by: 7, hidden_at: null }, { track: 6, version: 1, updated_at: 11, updated_by: 8, hidden_at: 12, hidden_by: "mod", hidden_reason: "wrong song" }];
	const versions = [{ track: 5, version: 1, text: "a", member_id: 7, at: 9, note: "" }, { track: 5, version: 2, text: "b", member_id: 7, at: 10, note: "" }, { track: 6, version: 1, text: "c", member_id: 8, at: 11, note: "" }];
	const b = lyricsBackup(lyrics, versions, "2026-10-24T00:00:00.000Z");
	assert.equal(b.format, "zaideih-lyrics/3");
	assert.deepEqual([b.links, b.times], [[], []]);
	assert.deepEqual(b.lyrics[1].hidden, { at: 12, by: "mod", reason: "wrong song" });
	assert.deepEqual(b.versions.map((v) => [v.track, v.version, v.by]), [[5, 1, 7], [5, 2, 7], [6, 1, 8]]);
	assert.throws(() => lyricsBackup(lyrics, versions.slice(0, 2), "x"), /song\(s\) 6/);
});
