import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../tools/catalog.mjs";
import { applyHolds, buildModel } from "../src/core/catalog.js";
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

test("play totals add to the catalog's counts and re-rank albums, artists and tops", async () => {
	const { applyTotals, parseTotals, totalsUrl } = await import("../src/core/playcounts.js");
	const { buildModel } = await import("../src/core/catalog.js");
	const raw = {
		lang: [[1, "zola"]], genre: [[1, "Gospel"]], artistType: [[2, "Male"]],
		artists: [[10, "A", "", 2, []], [11, "B", "", 2, []]],
		albums: [["al1", "One", 1, [1], 1990, [[1, "x", [10], 100, 50], [2, "y", [11], 100, 40]]]],
	};
	const m = buildModel(raw, { version: "t" });
	assert.equal(m.topTracks[0].id, 1);
	applyTotals(m, parseTotals({ v: 1, updated: 1, tracks: [[2, 30, 5], [999, 4, 4], ["bad", 1, 1]] }));
	assert.equal(m.tracks.get(2).plays, 70);
	assert.equal(m.tracks.get(2).recent, 5);
	assert.equal(m.tracks.get(1).plays, 50, "untouched tracks keep their catalog count");
	assert.equal(m.topTracks[0].id, 2);
	assert.equal(m.albums.get("al1").plays, 120);
	assert.equal(m.artists.get(11).plays, 70);
	assert.equal(m.langs.get(1).topArtists[0].artist.id, 11);
	applyTotals(m, parseTotals({ v: 1, tracks: [] }));
	assert.equal(m.tracks.get(2).plays, 40, "applying again starts from the catalog count, never adds twice");
	assert.throws(() => parseTotals({ tracks: [] }), /format/);
	assert.equal(totalsUrl("", "https://media.zaideih.com/audio/{id}"), "https://media.zaideih.com/plays");
	assert.equal(totalsUrl("https://x.example/plays", ""), "https://x.example/plays");
});

test("hidden tracks stay in the source but are not shipped; an album with only hidden tracks is left out", () => {
	const category = { lang: [{ id: 1, name: "zola" }], genre: [{ id: 2, name: "Gospel" }], artist: [{ id: 2, name: "Male" }], album: [] };
	const artists = [{ id: 10, name: "A", type: 2 }, { id: 11, name: "B", type: 2 }];
	const albums = [
		{ ui: "x", ab: "X", gr: [2], yr: [1990], lg: 1, tk: [{ t: "one", a: [10], d: 1, p: 1, i: 1 }, { t: "two", a: [11], d: 1, p: 1, i: 2, h: true }] },
		{ ui: "y", ab: "Y", gr: [2], yr: [], lg: 1, tk: [{ t: "three", a: [10], d: 1, p: 1, i: 3, h: true }] },
	];
	const { catalog, stats } = compile({ albums, artists, category });
	assert.deepEqual(catalog.albums.map((a) => a[0]), ["x"]);
	assert.deepEqual(catalog.albums[0][5].map((t) => t[0]), [1]);
	assert.deepEqual(catalog.artists.map((a) => a[0]), [10], "an artist only on hidden tracks is not shipped");
	assert.equal(stats.hidden, 2);
	assert.throws(() => compile({ albums: [{ ...albums[0], tk: [{ ...albums[0].tk[0], h: "yes" }] }], artists, category }), /hidden \(h\) must be true or false/);
});

test("holds: an album not listed leaves the catalog with its songs and lonely artists; streaming off marks it; given back, it returns", () => {
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "test" });
	model.extra.tracks.set("u1", { id: "u1" });
	const zamnu = [...model.artists.values()].find((a) => a.name === "Zamnu").id;
	assert.equal(applyHolds(model, { at: 1, albums: { a1: { streaming: false, listed: true } } }), false, "streaming off: no rebuild");
	assert.equal(model.album("a1").off, true);
	assert.equal(model.album("a2").off, false);

	assert.equal(applyHolds(model, { at: 2, albums: { a1: { streaming: true, listed: false } } }), true);
	assert.equal(model.album("a1"), undefined);
	assert.equal(model.track(1), undefined);
	assert.deepEqual([...model.langs.values()].map((l) => l.albums.length), [0, 1]);
	assert.equal(model.artists.get(zamnu).tracks.length, 1, "Zamnu keeps the song of the other album");
	assert.equal(model.track("u1")?.id, "u1", "uploads stay");

	assert.equal(applyHolds(model, { at: 3, albums: { a1: { streaming: true, listed: false }, a2: { streaming: true, listed: false } } }), true);
	assert.equal(model.artists.has(zamnu), false, "an artist with no song left is left out");

	assert.equal(applyHolds(model, { at: 4, albums: {} }), true);
	assert.equal(model.album("a1").tracks.length, 2);
	assert.equal(model.album("a1").off, false);
	assert.equal(model.artists.get(zamnu).tracks.length, 2);
});

test("My music: the person's own uploads are searched only when asked, the catalog itself untouched", async () => {
	const { withMine } = await import("../src/core/search.js");
	const { shapeUploads } = await import("../src/core/uploads.js");
	const { catalog } = compile({ albums, artists, category });
	const model = buildModel(catalog, { version: "test" });
	assert.equal(withMine(model), model, "no uploads: the catalog itself");
	const { tracks: ut, albums: ua } = shapeUploads([{ id: 5, title: "Hong lungdam", album: "Home songs", artist: "Me", duration: 100 }]);
	for (const t of ut) model.extra.tracks.set(t.id, t);
	for (const a of ua) model.extra.albums.set(a.id, a);
	assert.deepEqual(search(model, "lungdam").tracks.items.map((t) => t.id), []);
	const mine = withMine(model);
	assert.deepEqual(search(mine, "lungdam").tracks.items.map((t) => t.id), ["u5"]);
	assert.deepEqual(search(mine, "home songs").albums.items.map((a) => a.id), ["u-album-1"]);
	const byArtist = search(withMine(model), "Me");
	assert.deepEqual([byArtist.tracks.items.map((t) => t.id), byArtist.albums.items.map((a) => a.id)], [["u5"], ["u-album-1"]], "found by the artist's name too");
	assert.equal(model.tracks.has("u5"), false, "the catalog's own lists are untouched");
});
