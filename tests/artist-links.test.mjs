import assert from "node:assert/strict";
import { test } from "node:test";
import { albumsOf, radioOf, similarArtists, singsWith, withOthers } from "../src/core/artist-links.js";

/* A small catalog by hand: artists with tracks and albums, as buildModel shapes them. */
function catalog() {
	const gospel = { id: 1, name: "Gospel", albums: [] };
	const pop = { id: 2, name: "Pop", albums: [] };
	const lang = { id: 1 };
	const other = { id: 2 };
	const artists = new Map();
	const artist = (id, name) => { const a = { id, name, tracks: [], albums: [], plays: 0 }; artists.set(id, a); return a; };
	const [various, ann, ben, cai, dee, eve] = [artist(1, "Various Artists"), artist(10, "Ann"), artist(11, "Ben"), artist(12, "Cai"), artist(13, "Dee"), artist(14, "Eve")];
	let next = 1;
	const album = (title, year, l, genres, rows) => {
		const al = { id: title, title, year, lang: l, genres, tracks: [], artists: [], off: false };
		const credit = new Map();
		for (const [names, plays] of rows) {
			const t = { id: next++, title: `${title} ${next}`, album: al, artists: names, plays };
			al.tracks.push(t);
			for (const a of names) { a.tracks.push(t); a.plays += plays; if (!a.albums.includes(al)) a.albums.push(al); credit.set(a, (credit.get(a) ?? 0) + 1); }
		}
		al.artists = [...credit].sort((x, y) => y[1] - x[1]).map(([a]) => a);
		return al;
	};
	album("Ann One", 1990, lang, [gospel], [[[ann], 50], [[ann], 40], [[ann, ben], 90], [[ann, ben], 10]]);
	album("Mix", 1992, lang, [gospel], [[[ben], 5], [[cai], 5], [[ann], 7], [[various, cai], 3], [[cai], 4]]);
	album("Cai Solo", 1993, lang, [gospel], [[[cai], 30], [[cai], 30], [[cai, various], 2]]);
	album("Dee Pop", 1991, lang, [pop], [[[dee], 99], [[dee], 99], [[dee], 99]]);
	album("Eve Away", 1991, other, [gospel], [[[eve], 9], [[eve], 9], [[eve], 9]]);
	return { artists, ann, ben, cai, dee, eve, various };
}

test("artist links: sings with, with others, own albums and appears on", () => {
	const c = catalog();
	assert.deepEqual(singsWith(c.ann).map((p) => [p.artist.name, p.songs, p.plays]), [["Ben", 2, 100]]);
	assert.deepEqual(singsWith(c.cai), [], "Various Artists is a credit, not someone sung with");
	assert.deepEqual(withOthers(c.ann).map((t) => t.plays), [90, 10]);
	const { own, appearsOn } = albumsOf(c.ann);
	assert.deepEqual([own.map((a) => a.title), appearsOn.map((a) => a.title)], [["Ann One"], ["Mix"]]);
	assert.deepEqual(albumsOf(c.cai).own.map((a) => a.title).sort(), ["Cai Solo", "Mix"], "the first credit of a compilation counts it as theirs");
});

test("artist links: similar artists share a language and albums or genres", () => {
	const c = catalog();
	const similar = similarArtists(c, c.ann);
	assert.deepEqual(similar.map((x) => x.artist.name), ["Ben", "Cai"], "Dee: no genre or album in common; Eve: another language; Various: not an artist");
	assert.equal(similar[0].why, "On 2 albums together");
	assert.deepEqual(similarArtists(c, c.ann, { exclude: new Set([c.ben]) }).map((x) => x.artist.name), ["Cai"]);
});

test("artist links: a radio mixes their songs with those around them, held albums left out", () => {
	const c = catalog();
	let seed = 1;
	const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	const ids = radioOf(c.ann, [c.cai], { size: 10, random });
	const by = new Map([...c.artists.values()].flatMap((a) => a.tracks.map((t) => [t.id, t])));
	assert.equal(new Set(ids).size, ids.length, "no song twice");
	assert.ok(ids.every((id) => by.get(id)));
	const theirs = ids.filter((id) => by.get(id).artists.includes(c.ann)).length;
	assert.ok(theirs >= ids.length - theirs, "mostly theirs");
	assert.ok(ids.some((id) => !by.get(id).artists.includes(c.ann)), "someone around them too");
	c.cai.albums.find((a) => a.title === "Cai Solo").off = true;
	assert.ok(radioOf(c.ann, [c.cai], { random }).every((id) => by.get(id).album.title !== "Cai Solo"));
});
