import assert from "node:assert/strict";
import { test } from "node:test";
import { folderProblem, inPlace, inPlaceFolder, trackKey } from "../src/core/media-keys.js";
import { MediaError, pointInPlace, validateMedia } from "../tools/lib/media.mjs";

test("media keys: the catalog's own folder, or in place where the files are in storage", () => {
	assert.equal(trackKey("zola/Agape", "1.mp3"), "music/zola/Agape/1.mp3");
	assert.equal(trackKey("/Google Music/Album A", "01 One.mp3"), "Google Music/Album A/01 One.mp3");
	assert.equal(inPlaceFolder("Google Music/Album A/"), "/Google Music/Album A");
	assert.ok(inPlace("/x/y") && !inPlace("x/y"));
	assert.equal(folderProblem("zola/Agape"), null);
	assert.equal(folderProblem("/Google Music/Album A"), null);
	for (const bad of ["", "/", "a//b", "/a/../b", "a\\b", "/users/42", "/edits/7", "/music/zola/x"]) assert.ok(folderProblem(bad), bad || "(empty)");
	assert.match(folderProblem("/music/zola/x"), /write it as "zola\/x"/);
});

test("media.json accepts albums in place, never under uploads or the studio's versions", () => {
	const media = (folder) => ({ format: 1, root: "music", albums: [["a", folder, [[1, "x.mp3"]]]] });
	assert.deepEqual(validateMedia(media("/Archive/Tape")), []);
	assert.equal(validateMedia(media("/users/3")).length, 1);
	assert.equal(validateMedia({ ...media("zola/x"), root: "other" }).length, 1, "the catalog's root is music");
});

test("an album copied under music/ is pointed back at its originals in storage", () => {
	const media = { format: 1, root: "music", albums: [["a", "english/Miaow", [[7, "One.mp3"], [8, "Two.mp3"]]], ["b", "/Taken", [[9, "x.mp3"]]]] };
	const out = pointInPlace(media, "a", "Khen/Miaow/");
	assert.deepEqual(out.media.albums[0], ["a", "/Khen/Miaow", [[7, "One.mp3"], [8, "Two.mp3"]]]);
	assert.deepEqual(out.moves, [{ id: 7, from: "music/english/Miaow/One.mp3", to: "Khen/Miaow/One.mp3" }, { id: 8, from: "music/english/Miaow/Two.mp3", to: "Khen/Miaow/Two.mp3" }]);
	assert.equal(media.albums[0][1], "english/Miaow", "the input is unchanged");
	assert.deepEqual(validateMedia(out.media), []);
	assert.throws(() => pointInPlace(media, "z", "x"), MediaError);
	assert.throws(() => pointInPlace(media, "b", "x"), /already in place/);
	assert.throws(() => pointInPlace(media, "a", "Taken"), /already an album's folder/);
	assert.throws(() => pointInPlace(media, "a", "users/1"), /cannot be under/);
});
