import assert from "node:assert/strict";
import { test } from "node:test";
import { albumMotif } from "../src/ui/art.js";
import { artistLine, artistsOf, motifShapes } from "../src/ui/now-art.js";

test("now-art: the motif's circles and a duet's clip are read from albumMotif", () => {
	const shapes = motifShapes('<circle cx="1" cy="2" r="3" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="0.7"/><clipPath id="lens-a"><circle cx="5" cy="6" r="7"/></clipPath><circle cx="8" cy="9" r="10" fill="currentColor" fill-opacity="0.22" clip-path="url(#lens-a)"/>');
	assert.deepEqual(shapes.map((c) => [c.cx, c.r, c.clip?.r ?? null]), [["1", "3", null], ["8", "10", "7"]]);
	assert.equal(shapes[1].fill, "currentColor");
	// A real motif: every element albumMotif writes is a circle or a clipPath around one.
	const artist = (id, type) => ({ id, type, name: `A${id}` });
	const [a, b] = [artist(10, 2), artist(11, 3)];
	const tracks = [1, 2, 3, 4].map((n) => ({ id: n, duration: 200, plays: n * 10, artists: n % 2 ? [a] : [b] }));
	const album = { id: "duet1", title: "Two", duration: 800, plays: 100, tracks, artists: [a, b], genres: [], type: 3 };
	const svg = albumMotif(album);
	const elements = svg.match(/<(\w+)/g).length - (svg.match(/<clipPath/g) ?? []).length * 2;
	assert.equal(motifShapes(svg).length, elements, "no element of the motif left out");
});

test("now-art: up to four artists named, the rest counted; Unknown and Various left out", () => {
	assert.equal(artistLine(["Ann"]), "Ann");
	assert.equal(artistLine(["A", "B", "C", "D"]), "A · B · C · D");
	assert.equal(artistLine(["A", "B", "C", "D", "E", "F"]), "A · B · C · D +2 more");
	assert.equal(artistLine([]), "");
	const ann = { id: 10, name: "Ann" };
	const unknown = { id: 0, name: "Unknown" };
	const album = { artists: [{ id: 1, name: "Various Artists" }, ann] };
	assert.deepEqual(artistsOf({ artists: [unknown], album }).map((a) => a.name), ["Ann"], "the album's when the song names nobody");
	assert.deepEqual(artistsOf({ artists: [ann, unknown], album }).map((a) => a.name), ["Ann"]);
});
