import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCoverage, d1Sql, mediaFromDump, parseInserts, stringifyMedia, validateMedia } from "../tools/lib/media.mjs";

const DUMP = [
	"CREATE TABLE `album` (`id` int);",
	"INSERT INTO `album` VALUES (1,'a1','zola/Agape/Agape No.1'),(2,'a2','myanmar/PUKHEN/လာ...လှမ်းစို့'),(3,'a3','mizo/empty');",
	"INSERT INTO `track` VALUES (10,622,'Tu\\'n Nanga.mp3',1,1),(11,5,'It''s.MP3',1,1),(12,9,'BARENA.....mp3',2,2);",
	"INSERT INTO `auth_user` VALUES (1,'secret');",
].join("\n");

const albums = [
	{ ui: "a1", tk: [{ i: 10, t: "Tu'n Nanga" }, { i: 11, t: "It's" }] },
	{ ui: "a2", tk: [{ i: 12, t: "Barena" }] },
];

test("parseInserts handles escapes, doubled quotes and multiple tuples", () => {
	const rows = parseInserts(DUMP, "track");
	assert.deepEqual(rows.map((r) => r[2]), ["Tu'n Nanga.mp3", "It's.MP3", "BARENA.....mp3"]);
	assert.deepEqual(parseInserts(DUMP, "missing"), []);
});

test("mediaFromDump groups tracks by album and reports empty albums", () => {
	const { media, empty } = mediaFromDump(DUMP);
	assert.deepEqual(media.albums.map((a) => a[0]), ["a1", "a2"]);
	assert.deepEqual(empty.map((e) => e.uid), ["a3"]);
	assert.deepEqual(validateMedia(media), []);
	assert.deepEqual(checkCoverage(albums, media), []);
	assert.deepEqual(JSON.parse(stringifyMedia(media)), media);
});

test("validateMedia rejects unsafe paths and duplicates", () => {
	const bad = { format: 1, root: "music", albums: [
		["a1", "zola/../etc", [[1, "x.mp3"]]],
		["a2", "zola/ok", [[1, "dir/x.mp3"], [2, "notes.txt"]]],
	] };
	const errors = validateMedia(bad).join("\n");
	assert.match(errors, /unsafe: "zola\/\.\.\/etc"/);
	assert.match(errors, /duplicate track id 1/);
	assert.match(errors, /unsafe: "dir\/x.mp3"/);
	assert.match(errors, /not an \.mp3/);
});

test("checkCoverage reports missing, misplaced and unknown tracks", () => {
	const { media } = mediaFromDump(DUMP);
	const moved = structuredClone(albums);
	moved[1].tk.push({ i: 99, t: "New" });
	moved[0].tk.pop();
	moved[1].tk.push({ i: 11, t: "It's" });
	const errors = checkCoverage(moved, media).join("\n");
	assert.match(errors, /track 99 .* has no audio path/);
	assert.match(errors, /track 11 is in album a2 in albums.json but under a1/);
	const extra = checkCoverage([{ ui: "a1", tk: [{ i: 10, t: "x" }] }], media).join("\n");
	assert.match(extra, /lists track 12, which is not in albums.json/);
});

test("d1Sql escapes quotes, batches rows and can prune", () => {
	const { media } = mediaFromDump(DUMP);
	const { sql, count } = d1Sql(media, { now: 1, batch: 2, prune: true });
	assert.equal(count, 3);
	assert.equal((sql.match(/INSERT INTO tracks /g) ?? []).length, 2);
	assert.match(sql, /'Tu''n Nanga\.mp3'/);
	assert.match(sql, /DELETE FROM tracks WHERE id NOT IN \(SELECT id FROM _keep_tracks\);/);
	assert.ok(!sql.includes("auth_user"));
});
