import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChanges, cleanValue, describe, DraftError, indexData, setChange, sourceText } from "../src/admin/draft.js";
import { healthChecks, tidyText } from "../src/admin/health.js";
import { releaseFiles } from "../tools/lib/version.mjs";

const data = () => ({
	albums: [{ ui: "a1", ab: "Agape", gr: [2], yr: [1987], lg: 1, tk: [{ t: "Hong len in", a: [10], d: 200, p: 5, i: 1 }, { t: "Two", a: [11], d: 100, p: 1, i: 2 }] }],
	artists: [{ id: 10, name: "Lianbawi", aka: "", type: 2, thesaurus: [] }, { id: 11, name: "Thangno", type: 2 }],
});
const category = { lang: [{ id: 1, name: "zola" }, { id: 3, name: "mizo" }], genre: [{ id: 2, name: "Gospel" }, { id: 4, name: "Tribal" }], artist: [{ id: 2, name: "Male" }, { id: 3, name: "Female" }] };

test("values are checked and made canonical", () => {
	assert.equal(cleanValue({ kind: "album", field: "ab" }, "  Agape No.1 "), "Agape No.1");
	assert.throws(() => cleanValue({ kind: "album", field: "ab" }, "  "), DraftError);
	assert.equal(cleanValue({ kind: "album", field: "yr" }, ""), null);
	assert.throws(() => cleanValue({ kind: "album", field: "yr" }, "87"), /1900/);
	assert.throws(() => cleanValue({ kind: "album", field: "lg" }, "9", category), /unknown language/);
	assert.deepEqual(cleanValue({ kind: "album", field: "gr" }, ["2", "4", "2"], category), [2, 4]);
	assert.deepEqual(cleanValue({ kind: "artist", field: "thesaurus" }, "a, b ,, a"), ["a", "b"]);
	assert.equal(cleanValue({ kind: "track", field: "t" }, "ဟေ့်".normalize("NFD")), "ဟေ့်".normalize("NFC"));
	assert.throws(() => cleanValue({ kind: "track", field: "zz" }, 1), /unknown field/);
});

test("a change back to the source value leaves the draft", () => {
	const index = indexData(data());
	let changes = setChange([], index, { kind: "album", id: "a1", field: "ab", value: "Agape No.1" });
	changes = setChange(changes, index, { kind: "album", id: "a1", field: "ab", value: "Agape II" });
	assert.equal(changes.length, 1);
	assert.equal(changes[0].value, "Agape II");
	changes = setChange(changes, index, { kind: "album", id: "a1", field: "ab", value: "Agape" });
	assert.deepEqual(changes, []);
	assert.throws(() => setChange([], index, { kind: "track", id: 99, field: "t", value: "x" }), /does not exist/);
});

test("changes apply to copies, and missing records are named", () => {
	const src = data();
	const changes = [
		{ kind: "album", id: "a1", field: "yr", value: null },
		{ kind: "track", id: 2, field: "h", value: true },
		{ kind: "track", id: 1, field: "a", value: [10, 11] },
		{ kind: "artist", id: 11, field: "thesaurus", value: ["Thang No"] },
		{ kind: "track", id: 77, field: "t", value: "gone" },
	];
	const out = applyChanges(src, changes);
	assert.deepEqual(out.albums[0].yr, []);
	assert.equal(out.albums[0].tk[1].h, true);
	assert.deepEqual(out.albums[0].tk[0].a, [10, 11]);
	assert.deepEqual(out.artists[1].thesaurus, ["Thang No"]);
	assert.equal(out.missing.length, 1);
	assert.match(out.missing[0].reason, /track 77/);
	assert.deepEqual(src.albums[0].yr, [1987], "the source is untouched");
	const shown = applyChanges(out, [{ kind: "track", id: 2, field: "h", value: false }]);
	assert.equal("h" in shown.albums[0].tk[1], false, "showing again removes the field");
});

test("descriptions read as sentences", () => {
	const index = indexData(data());
	const names = { artist: (id) => index.artist.get(id)?.name, genre: (id) => category.genre.find((g) => g.id === id)?.name };
	assert.equal(describe({ kind: "album", id: "a1", field: "ab", value: "Agape II" }, index), 'album "Agape": title "Agape" → "Agape II"');
	assert.equal(describe({ kind: "track", id: 2, field: "h", value: true }, index), 'Hide the song "Two" (Agape)');
	assert.equal(describe({ kind: "track", id: 1, field: "a", value: [10, 11] }, index, names), 'song "Hong len in": artists Lianbawi → Lianbawi, Thangno');
	assert.equal(describe({ kind: "album", id: "a1", field: "gr", value: [4] }, index, names), 'album "Agape": genres Gospel → Tribal');
});

test("source files keep the repository's format, and releases use the shared writer", () => {
	assert.equal(sourceText([{ a: 1 }], "[]"), '[\n  {\n    "a": 1\n  }\n]');
	assert.equal(sourceText([], "[]\n"), "[]\n");
	const files = releaseFiles({
		"package.json": '{\n\t"name": "z",\n\t"version": "26.10.22.2"\n}\n',
		"platforms/desktop/package.json": '{\n\t"version": "26.10.22.2"\n}\n',
		"CHANGELOG.md": "# Version\n\n## v26.10.22.2\n\n- before\n",
	}, "26.10.22.3", ["Catalog fixes"]);
	assert.match(files["package.json"], /"version": "26.10.22.3"/);
	assert.ok(files["CHANGELOG.md"].startsWith("# Version\n\n## v26.10.22.3\n\n- Catalog fixes\n\n## v26.10.22.2"));
});

/* ---------------------------------------------------------------- health ---- */

test("tidyText corrects stray spaces and the Unicode form, and leaves clean text alone", () => {
	assert.equal(tidyText(" Agape  No.1 "), "Agape No.1");
	assert.equal(tidyText("Café"), "Café");
	assert.equal(tidyText("Agape No.1"), null);
	assert.equal(tidyText(undefined), null);
});

test("healthChecks lists what needs a look, with fixes that apply to the draft", () => {
	const data = {
		albums: [
			{ ui: "a1", ab: "First  album", yr: [], gr: [], lg: 1, tk: [{ i: 1, t: "Song ", a: [], d: 0 }, { i: 2, t: "Hidden", a: [10], d: 200, h: true }] },
			{ ui: "a2", ab: "Second", yr: [1990], gr: [3], lg: 1, tk: [{ i: 3, t: "Fine", a: [11], d: 180 }] },
		],
		artists: [{ id: 10, name: "Lam Cin" }, { id: 11, name: "Lamcin" }, { id: 12, name: "Nobody" }],
	};
	const byId = Object.fromEntries(healthChecks(data).map((c) => [c.id, c]));
	assert.equal(byId.text.total, 2);
	assert.deepEqual(byId.text.fixes, [
		{ kind: "album", id: "a1", field: "ab", value: "First album" },
		{ kind: "track", id: 1, field: "t", value: "Song" },
	]);
	assert.equal(byId["no-artist"].total, 1);
	assert.equal(byId["no-duration"].total, 1, "the hidden song is not counted");
	assert.deepEqual(byId["no-year"].items.map((i) => i.id), ["a1"]);
	assert.deepEqual(byId["no-genre"].items.map((i) => i.id), ["a1"]);
	assert.deepEqual(byId["duplicate-artist"].items.map((i) => i.id), [10, 11]);
	assert.deepEqual(byId.hidden.items.map((i) => [i.id, i.open]), [[2, { kind: "album", id: "a1" }]]);
	assert.deepEqual(byId["unused-artist"].items.map((i) => i.id), [12]);
	assert.ok(!("fixes" in byId["no-year"]));
	// The fixes are valid draft changes.
	const index = indexData(data);
	let changes = [];
	for (const f of byId.text.fixes) changes = setChange(changes, index, f);
	assert.equal(changes.length, 2);
});
