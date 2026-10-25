import assert from "node:assert/strict";
import { test } from "node:test";
import { splitHymns, titleCase } from "../src/core/songbook-import.js";

const PAGES = `TEDIM LABU
42

145
LUNGMUANNA KA NEI
1. Lungmuanna ka nei hi,
Jesu a ka hi;

2. Ka lungdam hi,
Ka la sa hi.

146 PASIAN HONG IT
1. Pasian hong it hi
2. Hong it lai hi

149
THUKHUN THAK
Thukhun thak hong pia`;

test("splitHymns: hymns at their numbers, titles beside or under them, verse numbers left in the words", () => {
	const { entries, notes } = splitHymns(PAGES);
	assert.deepEqual(entries.map((e) => [e.number, e.title, e.firstLine]), [
		[145, "Lungmuanna Ka Nei", "Lungmuanna ka nei hi,"],
		[146, "Pasian Hong It", "Pasian hong it hi"],
		[149, "Thukhun Thak", "Thukhun thak hong pia"],
	]);
	assert.equal(entries[0].text, "1. Lungmuanna ka nei hi,\nJesu a ka hi;\n\n2. Ka lungdam hi,\nKa la sa hi.");
	assert.deepEqual(notes, [
		"2 lines before the first song number were left out.",
		"Numbers 147 to 148 are not in these pages.",
	]);
});

test("splitHymns: `from` names the first hymn; a verse number alone is not taken for a hymn after it", () => {
	assert.deepEqual(splitHymns(PAGES, { from: 146 }).entries.map((e) => e.number), [146, 149]);
	const { entries, notes } = splitHymns("12\nNGAH LUNG\n1\nKa lungdam hi\n13 HONG IT\nHong it hi");
	assert.deepEqual(entries.map((e) => [e.number, e.text]), [[12, "1\nKa lungdam hi"], [13, "Hong it hi"]]);
	assert.deepEqual(notes, []);
	assert.deepEqual(splitHymns("Hong it hi\n2 Hong").notes, ["2 lines before the first song number were left out."]);
	assert.deepEqual(splitHymns("", {}), { entries: [], notes: [] });
	assert.throws(() => splitHymns("x", { from: 0 }), /first number/);
	assert.throws(() => splitHymns(null), /must be text/);
});

test("titleCase only changes titles written in capitals", () => {
	assert.equal(titleCase("LUNGMUANNA KA NEI"), "Lungmuanna Ka Nei");
	assert.equal(titleCase("Lungmuanna ka nei"), "Lungmuanna ka nei");
});
