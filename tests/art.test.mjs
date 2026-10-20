import assert from "node:assert/strict";
import { test } from "node:test";
import { artistArt, artistLabel, careerOf, coverArt, patternOf, shadeOf, stripOf } from "../src/ui/art.js";

const lang = { name: "zola" };
const album = (id, year, genres, durations) => {
	const a = { id, title: id, year, lang, genres: genres.map((name) => ({ name })), tracks: [] };
	a.tracks = durations.map((d, i) => ({ id: i, duration: d, plays: 10 * (i + 1), album: a }));
	return a;
};

test("cover pattern follows the genre", () => {
	assert.equal(patternOf(album("a", 1990, ["Gospel"], [1])), "rings");
	assert.equal(patternOf(album("b", 1990, ["Tribal"], [1])), "weave");
	assert.equal(patternOf(album("c", 1990, ["Pop"], [1])), "grooves");
	assert.equal(patternOf(album("d", 1990, [], [1])), "grooves");
});

test("cover shade is stable per id and stays in the grey range", () => {
	assert.equal(shadeOf("136da131360cb128"), shadeOf("136da131360cb128"));
	for (const id of ["a", "b", "c", "xyz", "136da131360cb128"]) {
		const g = shadeOf(id);
		assert.ok(g >= 30 && g <= 46, `${id}: ${g}`);
	}
});

test("song strip has one bar per song, longest song at 100%", () => {
	const a = album("strip", 1990, [], [100, 200, 50]);
	assert.deepEqual(stripOf(a), [63, 100, 44]);
	const html = String(coverArt(a, { current: 1 }));
	assert.equal(html.match(/<i style="--h:/g).length, 3);
	assert.match(html, /<i style="--h:100%" class="on">/);
});

test("career counts songs and plays per year, with empty years kept", () => {
	const a1 = album("x", 1990, [], [1, 1]);
	const a2 = album("y", 1993, [], [1]);
	const artist = { tracks: [...a1.tracks, ...a2.tracks] };
	assert.deepEqual(careerOf(artist), { from: 1990, to: 1993, songs: [2, 0, 0, 1], plays: [30, 0, 0, 10] });
	assert.deepEqual(careerOf({ tracks: [] }), { from: 0, to: 0, songs: [], plays: [] });
});

test("artist label: Latin initials, nothing for Myanmar names", () => {
	assert.equal(artistLabel("Lengtong Pauno"), "LP");
	assert.equal(artistLabel("VC. Mang"), "VM");
	assert.equal(artistLabel("Kapno"), "K");
	assert.equal(artistLabel("ရတနာဦး"), "");
});

test("artist art encodes years, albums and artist type", () => {
	const a1 = album("p", 2000, [], [1, 1, 1]);
	const a2 = album("q", 2002, [], [1]);
	const base = { name: "Test Artist", plays: 5000, tracks: [...a1.tracks, ...a2.tracks], albums: [a1, a2] };
	const male = String(artistArt({ ...base, id: 1, type: 2 }));
	assert.equal(male.match(/<line/g).length, 3, "one ray per year, 2000 to 2002");
	assert.equal(male.match(/class="ring"/g).length, 2, "two albums, two rings");
	assert.match(male, /<text[^>]*>TA<\/text>/);
	const female = String(artistArt({ ...base, id: 2, type: 3 }));
	assert.equal(female.match(/<circle cx="[\d.]+" cy="[\d.]+" r="[\d.]+" fill/g).length, 2, "dots on the two release years");
	const group = String(artistArt({ ...base, id: 3, type: 1 }));
	assert.match(group, /stroke-dasharray/);
});
