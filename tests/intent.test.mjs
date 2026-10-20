import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../tools/catalog.mjs";
import { buildModel } from "../src/core/catalog.js";
import { answer, describe, parseIntent } from "../src/core/intent.js";

const category = {
	lang: [{ id: 1, name: "zola" }, { id: 2, name: "myanmar" }],
	artist: [{ id: 0, name: "Unknown" }, { id: 2, name: "Male" }, { id: 3, name: "Female" }],
	album: [{ id: 0, name: "Unknown" }],
	genre: [{ id: 2, name: "Gospel" }, { id: 16, name: "Pop" }],
};
const artists = [
	{ id: 3, name: "Zamnu", aka: "", thesaurus: [], type: 3 },
	{ id: 4, name: "Lianbawi", aka: "", thesaurus: [], type: 2 },
];
const albums = [
	{ ui: "a1", ab: "Agape No.1", gr: [2], yr: [1987], lg: 1, tk: [
		{ t: "Hong len in", a: [4], d: 252, p: 622, i: 1 },
		{ t: "Lung Damna", a: [3], d: 95, p: 40, i: 2 },
	] },
	{ ui: "a2", ab: "Agape No.2", gr: [2], yr: [1989], lg: 1, tk: [{ t: "Thupha", a: [4], d: 100, p: 900, i: 3 }] },
	{ ui: "a3", ab: "ပြည့်", gr: [16], yr: [2004], lg: 2, tk: [{ t: "ရေလှိုင်း", a: [3], d: 100, p: 9000, i: 4 }] },
];
const model = buildModel(compile({ albums, artists, category }).catalog, { version: "t" });
const label = (q) => describe(parseIntent(model, q), (l) => l.name[0].toUpperCase() + l.name.slice(1));

test("questions are read into kind, order and filters", () => {
	assert.equal(label("who is the most played artist"), "Most played artists");
	assert.equal(label("zola gospel albums"), "Most played Zola gospel albums");
	assert.equal(label("newest albums by lianbawi"), "Newest albums by Lianbawi");
	assert.equal(label("lianbawi songs"), "Most played songs by Lianbawi");
	assert.equal(label("albums from the 80s"), "Most played albums from the 1980s");
	assert.equal(label("top songs 1987"), "Most played songs from 1987");
	assert.equal(label("burmese songs"), "Most played Myanmar songs");
	assert.equal(label("most played"), "Most played songs");
});

test("ordinary title searches are not questions", () => {
	for (const q of ["agape", "best friend", "new life", "hong len in", "lianbawi", ""]) assert.equal(parseIntent(model, q), null, q);
});

test("answers list the matching records in order", () => {
	const names = (q) => answer(model, parseIntent(model, q)).items.map((x) => x.name ?? x.title);
	assert.deepEqual(names("most played artists"), ["Zamnu", "Lianbawi"]);
	assert.deepEqual(names("most played zola artists"), ["Lianbawi", "Zamnu"]);
	assert.deepEqual(names("newest albums by lianbawi"), ["Agape No.2", "Agape No.1"]);
	assert.deepEqual(names("oldest albums"), ["Agape No.1", "Agape No.2", "ပြည့်"]);
	assert.deepEqual(names("songs by zamnu"), ["ရေလှိုင်း", "Lung Damna"]);
	assert.deepEqual(names("gospel songs from 1987"), ["Hong len in", "Lung Damna"]);
	assert.equal(answer(model, parseIntent(model, "pop albums from 1987")).total, 0);
});
