/**
 * An artist among the others, from the catalog alone (no server): who they
 * sing with, their songs with others, their own albums and those they appear
 * on, artists like them, and a radio of them and those around them. Used by
 * the artist page (ui/views.js).
 *
 * "Unknown" and "Various Artists" (catalog NOT_ARTISTS) are credits, not
 * artists: they never count as someone sung with, or as an artist like one.
 */
import { NOT_ARTISTS } from "./catalog.js";

/** An album is the artist's own when they sing at least this share of it (or are its first credit). */
export const OWN_SHARE = 0.5;
/** Artists like one need at least this many songs, so a single guest credit does not show. */
const MIN_SONGS = 3;

const real = (a) => !NOT_ARTISTS.has(a.id);
const byPlays = (x, y) => y.plays - x.plays;

/**
 * Those `artist` shares songs with, most songs together first:
 * [{ artist, songs, plays }] (plays: of the songs together).
 */
export function singsWith(artist) {
	const together = new Map();
	for (const t of artist.tracks) {
		if (t.artists.length < 2) continue;
		for (const b of t.artists) {
			if (b === artist || !real(b)) continue;
			const v = together.get(b) ?? { artist: b, songs: 0, plays: 0 };
			v.songs += 1;
			v.plays += t.plays;
			together.set(b, v);
		}
	}
	return [...together.values()].sort((x, y) => y.songs - x.songs || y.plays - x.plays || x.artist.name.localeCompare(y.artist.name));
}

/** Their songs with someone else credited too (duets, features), most played first. */
export function withOthers(artist) {
	return artist.tracks.filter((t) => t.artists.some((b) => b !== artist && real(b))).sort(byPlays);
}

/**
 * Their albums: `own` (they sing at least OWN_SHARE of it, or are its first
 * credit) and `appearsOn` (compilations and others' albums with a song or
 * two of theirs), each newest first as on the artist.
 */
export function albumsOf(artist) {
	const own = [];
	const appearsOn = [];
	for (const al of artist.albums) {
		const theirs = al.tracks.filter((t) => t.artists.includes(artist)).length;
		const first = al.artists[0] === artist;
		(first || (al.tracks.length && theirs / al.tracks.length >= OWN_SHARE) ? own : appearsOn).push(al);
	}
	return { own, appearsOn };
}

const yearsOf = (artist) => {
	const ys = artist.albums.map((al) => al.year).filter(Boolean);
	return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
};

/** How much two spans of years overlap, 0 to 1, as a share of the shorter one. */
function overlap(a, b) {
	if (!a || !b) return 0;
	const shared = Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1;
	if (shared <= 0) return 0;
	return shared / Math.max(1, Math.min(a[1] - a[0] + 1, b[1] - b[0] + 1));
}

/**
 * Artists like `artist`, best first: in one of their languages, scored by
 * albums shared (compilations, others' albums), genres in common (Jaccard),
 * years active overlapping, and a little for being played; `exclude`: those
 * already shown (who they sing with). [{ artist, score, why }], where `why`
 * says what they share ("on 3 albums together", "Gospel", ...).
 */
export function similarArtists(catalog, artist, { exclude = new Set(), limit = 12 } = {}) {
	const langs = new Set(artist.albums.map((al) => al.lang));
	const genres = new Set(artist.albums.flatMap((al) => al.genres));
	const years = yearsOf(artist);
	const sharedAlbums = new Map();
	for (const al of artist.albums) {
		for (const b of al.artists) if (b !== artist && real(b)) sharedAlbums.set(b, (sharedAlbums.get(b) ?? 0) + 1);
	}
	const out = [];
	for (const b of catalog.artists.values()) {
		if (b === artist || !real(b) || exclude.has(b) || b.tracks.length < MIN_SONGS) continue;
		if (!b.albums.some((al) => langs.has(al.lang))) continue;
		const theirGenres = new Set(b.albums.flatMap((al) => al.genres));
		let common = 0;
		for (const g of theirGenres) if (genres.has(g)) common += 1;
		const union = genres.size + theirGenres.size - common;
		const genre = union ? common / union : 0;
		const shared = sharedAlbums.get(b) ?? 0;
		if (!genre && !shared) continue;
		const score = 1.5 * Math.min(shared, 4) / 4 + genre + 0.5 * overlap(years, yearsOf(b)) + 0.25 * Math.log10(1 + b.plays) / 6;
		const top = [...theirGenres].filter((g) => genres.has(g)).sort((x, y) => y.albums.length - x.albums.length)[0];
		out.push({ artist: b, score, why: shared ? `On ${shared} ${shared === 1 ? "album" : "albums"} together` : (top?.name ?? "") });
	}
	return out.sort((x, y) => y.score - x.score || y.artist.plays - x.artist.plays).slice(0, limit);
}

function shuffled(list, random) {
	const a = [...list];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * A radio of `artist`: their most played songs, shuffled, two of theirs to
 * one by someone around them (`around`: artists they sing with and artists
 * like them), each of those giving a few of their most played songs. Songs of
 * held albums are left out. Answers track ids, at most `size`.
 */
export function radioOf(artist, around, { size = 40, random = Math.random } = {}) {
	const playable = (t) => !t.album.off;
	const own = shuffled(artist.tracks.filter(playable).sort(byPlays).slice(0, Math.ceil(size * 0.7)), random);
	const others = shuffled(around.flatMap((b) => b.tracks.filter((t) => playable(t) && !t.artists.includes(artist)).sort(byPlays).slice(0, 4)), random);
	const out = [];
	const seen = new Set();
	const add = (t) => {
		if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t.id); }
	};
	let i = 0;
	let j = 0;
	while (out.length < size && (i < own.length || j < others.length)) {
		add(own[i++]);
		if (out.length < size) add(own[i++]);
		if (out.length < size) add(others[j++]);
	}
	return out;
}
