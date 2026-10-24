import assert from "node:assert/strict";
import { test } from "node:test";
import { compareWords, copyWorth, lineKey, sungLines, suggestKeep } from "../src/core/lyrics-merge.js";

test("the same words are the same, however they are written", () => {
	const a = "Key: G\n\n[Verse 1]\n[G]Topa ngak ta un, [C]kam hong ciam\nVang liat na\n\n[Chorus x2]\nHallelujah, amen";
	const b = "1. [00:05.00]Topa ngak ta un kam hong ciam\nvang-liat-na!\n\nSakkik:\nHallelujah amen (x2)\nHallelujah amen";
	assert.deepEqual(compareWords(a, b), { same: true, onlyA: [], onlyB: [], lines: [3, 3] });
	assert.equal(lineKey("Hallelujah, amen ×3"), lineKey("hallelujah amen"));
	assert.deepEqual(sungLines("Line one\n\n[Chorus]\nLine one").map((l) => l.text), ["Line one"], "each line once");
});

test("different words are named, line by line", () => {
	const r = compareWords("One\nTwo\nThree", "One\nTwo, changed\nThree\nFour");
	assert.equal(r.same, false);
	assert.deepEqual(r.onlyA, ["Two"]);
	assert.deepEqual(r.onlyB, ["Two, changed", "Four"]);
	assert.equal(compareWords("", "").same, false, "nothing is not the same song");
});

test("the copy worked on most is suggested, with its reasons", () => {
	const now = 1_800_000_000;
	const rich = { text: "[Verse 1]\n[00:01.00][G]One\nTwo\nThree", versions: 7, people: 4, updated: now - 2 * 86_400, langs: 2, reports: 0 };
	const thin = { text: "One\nTwo", versions: 3, people: 1, updated: now - 400 * 86_400, langs: 1, reports: 1 };
	const s = suggestKeep(thin, rich, now);
	assert.equal(s.keep, "b");
	assert.deepEqual(s.b.reasons, ["7 versions", "by 4 people", "3 lines", "timed", "chords", "1 translation", "edited lately"]);
	assert.ok(s.a.reasons.includes("1 open report"));
	assert.equal(suggestKeep(rich, thin, now).keep, "a");
	const same = { text: "One", versions: 1, people: 1, updated: now, langs: 1, reports: 0 };
	assert.equal(suggestKeep(same, { ...same }, now).keep, "b", "a tie keeps the song chosen");
	assert.equal(copyWorth(same, now).score > 0, true);
});
