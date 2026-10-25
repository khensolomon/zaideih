import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublish, segment } from "../src/workspace/publish.js";
import { validateMedia, checkCoverage } from "../tools/lib/media.mjs";

const data = () => ({
	albums: [{ ui: "aaaaaaaaaaaaaaaa", ab: "Old", gr: [], yr: [], lg: 1, tk: [{ t: "x", a: [1], d: 1, p: 3, i: 40 }] }],
	artists: [{ name: "Ann", correction: [], thesaurus: [], type: 3, id: 1 }],
	media: { format: 1, root: "music", albums: [["aaaaaaaaaaaaaaaa", "zola/Old", [[40, "x.mp3"]]]] },
	category: { lang: [{ id: 0, name: "untitle" }, { id: 1, name: "zola" }], genre: [{ id: 2, name: "Gospel" }] },
});
const request = { id: 3, login: "ann", songs: [
	{ upload: 11, title: "One", artist: "Ann", fileName: "One.mp3", duration: 181.4 },
	{ upload: 12, title: "Two", artist: "ann, Ben", fileName: "one.mp3", duration: 200 },
] };
const form = { title: "Tape: 1990", year: "1990", lang: 1, genres: [2], songs: [{ upload: 12, title: "Two (live)", artists: "ann, Ben" }] };

test("a request becomes a new album, songs, artists and paths the catalog accepts", () => {
	const out = buildPublish(data(), request, form, { reserved: new Set([41]), ui: () => "0123456789abcdef" });
	const album = out.albums.at(-1);
	assert.deepEqual(album, { ui: "0123456789abcdef", ab: "Tape: 1990", gr: [2], yr: [1990], lg: 1, tk: [
		{ t: "One", a: [1], d: 181, p: 0, i: 42 }, { t: "Two (live)", a: [1, 2], d: 200, p: 0, i: 43 },
	] });
	assert.deepEqual(out.newArtists, [{ name: "Ben", correction: [], thesaurus: [], type: 0, id: 2 }]);
	assert.deepEqual(out.approve.tracks, [
		{ upload: 11, track: 42, key: "music/zola/Tape 1990/One.mp3" },
		{ upload: 12, track: 43, key: "music/zola/Tape 1990/one (2).mp3" },
	]);
	assert.deepEqual(validateMedia(out.media), []);
	assert.deepEqual(checkCoverage(out.albums, out.media), []);
	assert.match(out.lines[0], /Published "Tape: 1990" \(2 songs, zola, 1990\), from @ann's library/);

	// A second attempt keeps what the first placed.
	const again = buildPublish(data(), request, { ...form, title: "Tape 1990" }, { assigned: out.approve, ui: () => "ffffffffffffffff" });
	assert.deepEqual(again.approve, out.approve);
	assert.equal(again.media.albums.at(-1)[1], "zola/Tape 1990");
});

test("a request is refused before anything happens when it cannot be published", () => {
	assert.throws(() => buildPublish(data(), request, { ...form, lang: 0 }), /language/);
	assert.throws(() => buildPublish(data(), request, { ...form, title: "Old" }), /music\/zola\/Old\/ is already an album's folder/);
	assert.throws(() => buildPublish(data(), request, { ...form, year: "1800" }), /year/);
	assert.throws(() => buildPublish(data(), { ...request, songs: [{ ...request.songs[0], artist: "" }] }, { ...form, songs: [] }), /needs an artist/);
	assert.throws(() => segment(".."), /cannot be used/);
});
