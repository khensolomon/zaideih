import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSE_TITLES, titleCloseness, titleKey } from "../src/core/titles.js";

test("titleKey compares titles without case, spaces or punctuation", () => {
	assert.equal(titleKey("Hong Len In!"), titleKey("hong len-in"));
	assert.equal(titleKey("Honglen In"), titleKey("Hong len in"));
});

test("titleCloseness finds the same song with its title written another way", () => {
	const k = (s) => titleKey(s);
	assert.equal(titleCloseness(k("Hong len in"), k("Hong Len In")), 1);
	assert.ok(titleCloseness(k("သားသမီးတိုင်းအတွက်ယေရှု"), k("သားသမီးတိုင်းရဲ့ယေရှု")) >= CLOSE_TITLES, "a word changed");
	assert.ok(titleCloseness(k("Topa ngak ta un"), k("Topa ngak ta un (Live)")) >= CLOSE_TITLES, "a subtitle added");
	assert.ok(titleCloseness(k("Hong len in"), k("Hong leng aw")) < CLOSE_TITLES, "another song");
	assert.equal(titleCloseness(k("Hong len in"), k("Zeisu")), 0);
	assert.equal(titleCloseness("", k("x")), 0);
});
