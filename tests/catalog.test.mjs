import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../tools/catalog.mjs";
import { buildModel } from "../src/core/catalog.js";
import { closest, correction, didYouMean, editDistance, search, suggestions } from "../src/core/search.js";
import { normalize } from "../src/core/text.js";

const category = {
	lang: [{ id: 1, name: "zola" }, { id: 2, name: "myanmar" }],
	artist: [{ id: 0, name: "Unknown" }, { id: 2, name: "Male" }, { id: 3, name: "Female" }],
	album: [{ id: 0, name: "Unknown" }],
	genre: [{ id: 2, name: "Gospel" }],
};
const artists = [
	{ id: 3, name: "Zamnu", aka: "ဇမ်နူး", thesaurus: ["zam nu"], type: 3 },
	{ id: 9, name: "Unused", thesaurus: [], type: 2 },
];
const albums = [
	{ ui: "a1", ab: "Agape No.1", gr: [2], yr: [1987], lg: 1, tk: [
		{ t: "Hong len in", a: [3], d: 252, p: 622, i: 1 },
		{ t: "Nobody", a: [], d: 95, p: 4, i: 2 },
	] },
	{ ui: "a2", ab: "ပြည့်", gr: [], yr: [], lg: 2, tk: [{ t: "ရေလှိုင်း", a: [3], d: 100, p: 9000, i: 3 }] },
];

test("compile emits compact catalog and drops unreferenced artists", () => {
	const { catalog, stats } = compile({ albums, artists, category });
	assert.equal(stats.albums, 2);
	assert.equal(stats.tracks, 3);
	assert.equal(stats.artists, 1);
	assert.equal(stats.artistsUnused, 1);
	assert.deepEqual(catalog.albums[0][5][1], [2, "Nobody", [], 95, 4]);
});

test("compile normalizes text to NFC and counts it", () => {
	const { catalog, stats } = compile({ albums, artists, category });
	assert.equal(catalog.albums[1][1], "ပြည့်");
	assert.equal(stats.normalized, 1);
});

test("compile fails on every broken reference at once", () => {
	const broken = structuredClone(albums);
	broken[0].tk[0].a = [404];
	broken[0].lg = 77;
	broken[1].tk[0].i = 1;
	assert.throws(() => compile({ albums: broken, artists, category }), (err) => {
		assert.match(err.message, /3 error/);
		assert.match(err.message, /unknown artist id 404/);
		assert.match(err.message, /unknown language id 77/);
		assert.match(err.message, /duplicate track id 1/);
		return true;
	});
});

test("search matches thesaurus, aka and space-free spellings", () => {
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "t" });
	for (const q of ["zam nu", "zamnu", "ဇမ်နူး", "ZAMNU"]) {
		assert.equal(search(model, q).artists.items[0]?.name, "Zamnu", q);
	}
	assert.equal(search(model, "hong len").tracks.items[0].title, "Hong len in");
	assert.equal(search(model, "   "), null);
});

test("normalize strips zero-width characters and Latin diacritics only", () => {
	assert.equal(normalize("Cáfé Song!"), "cafe song");
	assert.equal(normalize("တ​စ္ဆေ"), "တစ္ဆေ");
	assert.equal(normalize("ကို"), "ကို");
});

test("suggestions mix artists, albums and songs", () => {
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "t" });
	const kinds = suggestions(model, "zam").map((s) => s.kind);
	assert.deepEqual(kinds, ["artist"]);
	const mixed = suggestions(model, "agape").map((s) => s.kind);
	assert.ok(mixed.includes("album"));
	assert.deepEqual(suggestions(model, "  "), []);
});

test("correction finds a close artist or album for a typo", () => {
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "t" });
	assert.equal(correction(model, "zamnuu"), "Zamnu");
	assert.equal(correction(model, "agpe no1"), "Agape No.1");
	assert.equal(correction(model, "xyzzyq"), null);
	assert.equal(correction(model, "za"), null);
});

test("closest finds near spellings of names, titles and words", () => {
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "t" });
	assert.equal(closest(model, "zamnuu").artists[0]?.name, "Zamnu");
	assert.equal(closest(model, "agape no 2").albums[0]?.title, "Agape No.1");
	assert.equal(closest(model, "hong lem").tracks[0]?.title, "Hong len in", "word by word, with the last word typed part way");
	assert.deepEqual(closest(model, "qqqqqq"), { artists: [], albums: [], tracks: [] });
	assert.deepEqual(closest(model, "zm"), { artists: [], albums: [], tracks: [] });
});

test("suggestions add close matches when little matches exactly", () => {
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "t" });
	const picks = suggestions(model, "zamnuu");
	assert.equal(picks[0]?.item.name, "Zamnu");
	assert.ok(picks.every((p) => p.near));
	assert.ok(suggestions(model, "zamnu").every((p) => !p.near));
});

test("didYouMean falls back to the closest song title", () => {
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "t" });
	assert.equal(didYouMean(model, "zamnuu"), "Zamnu");
	assert.equal(didYouMean(model, "hong lem"), "Hong len in");
	assert.equal(didYouMean(model, "qqqqqq"), null);
});

test("editDistance counts edits and stops early past the limit", () => {
	assert.equal(editDistance("kitten", "sitting", 3), 3);
	assert.equal(editDistance("abc", "abc", 1), 0);
	assert.equal(editDistance("abc", "abcdef", 1), 2);
	assert.equal(editDistance("abc", "abcdef", 1, 3), 0, "compares a prefix when given a length");
});
