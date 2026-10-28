/**
 * In-memory catalog search.
 *
 * A record matches when every query token appears in its normalized text, or
 * when the space-free query appears in its space-free text. Ranking prefers
 * whole-string prefix matches, then word-prefix matches, then popularity.
 */
import { compact, normalize } from "./text.js";

function score(rec, tokens, q, qc) {
	const hay = rec.search;
	let base;
	if (hay === q) base = 4;
	else if (hay.startsWith(q)) base = 3;
	else if (tokens.every((t) => hay.includes(t))) {
		base = tokens.every((t) => hay.startsWith(t) || hay.includes(` ${t}`)) ? 2 : 1;
	} else if (qc.length >= 3 && rec.searchCompact.includes(qc)) base = 1;
	else return 0;
	return base;
}

function rank(records, tokens, q, qc, limit) {
	const hits = [];
	for (const rec of records) {
		const s = score(rec, tokens, q, qc);
		if (s) hits.push([s, rec]);
	}
	hits.sort((a, b) => b[0] - a[0] || b[1].plays - a[1].plays);
	return { total: hits.length, items: hits.slice(0, limit).map((h) => h[1]) };
}

export function search(catalog, query, limits = { tracks: 50, albums: 24, artists: 24 }) {
	const q = normalize(query);
	if (!q) return null;
	const tokens = q.split(" ");
	const qc = compact(q);
	return {
		query: q,
		artists: rank(catalog.artists.values(), tokens, q, qc, limits.artists),
		albums: rank(catalog.albums.values(), tokens, q, qc, limits.albums),
		tracks: rank(catalog.tracks.values(), tokens, q, qc, limits.tracks),
	};
}

/**
 * The catalog with the signed-in person's own music in it (catalog.extra,
 * core/uploads.js), for searching with "My music" on; the catalog itself
 * when there is none. Nothing leaves the device: uploads are already here.
 */
let joined = null;
export function withMine(catalog) {
	const extra = catalog.extra;
	if (!extra?.tracks.size) return catalog;
	// Joining 28,000 songs costs a few milliseconds a keystroke: kept until the catalog is built again or the uploads change.
	if (joined?.tracks === catalog.tracks && joined.version === extra.version && joined.catalog === catalog) return joined.value;
	const value = Object.assign(Object.create(catalog), {
		albums: new Map([...catalog.albums, ...extra.albums]),
		tracks: new Map([...catalog.tracks, ...extra.tracks]),
	});
	joined = { catalog, tracks: catalog.tracks, version: extra.version, value };
	return value;
}

/** What a search looks in: everything, or one kind of record. */
export const SCOPES = ["all", "artists", "albums", "tracks", "lyrics"];
const SUGGEST = {
	all: { artists: 3, albums: 3, tracks: 5 },
	artists: { artists: 10, albums: 0, tracks: 0 },
	albums: { artists: 0, albums: 8, tracks: 0 },
	tracks: { artists: 0, albums: 0, tracks: 10 },
	// Lyrics are matched line by line on the device (core/lyrics-index.js); while typing, songs by title.
	lyrics: { artists: 0, albums: 0, tracks: 10 },
};
const KIND_OF = { artists: "artist", albums: "album", tracks: "track" };

/** The artist a query plainly names: the query is the start of the name. */
export function namedArtist(catalog, query) {
	const q = compact(normalize(query));
	if (q.length < 3) return null;
	const r = search(catalog, query, { artists: 1, albums: 0, tracks: 0 });
	const a = r?.artists.items[0];
	return a && a.id > 1 && compact(normalize(a.name)).startsWith(q) ? a : null;
}

/**
 * Quick suggestions for the search box, best first within each kind: up to
 * 3 artists, 3 albums and 5 songs, or more of one kind when `scope` picks
 * one. Within the albums or songs scope, records by a matching artist follow
 * the title matches (`via` names that artist), since people often type the
 * artist when they want an album. When fewer than 4 records match, the
 * closest spellings fill the remaining places, marked `near: true`.
 */
export function suggestions(catalog, query, scope = "all") {
	const limits = SUGGEST[scope] ?? SUGGEST.all;
	const r = search(catalog, query, limits);
	if (!r) return [];
	const out = [];
	const seen = new Set();
	const count = (kind) => out.filter((o) => o.kind === kind).length;
	const add = (kind, item, extra = {}) => {
		if (seen.has(item)) return;
		seen.add(item);
		out.push({ kind, item, near: false, ...extra });
	};
	for (const item of r.artists.items) add("artist", item);
	for (const item of r.albums.items) add("album", item);
	for (const item of r.tracks.items) add("track", item);
	if (scope === "albums" || scope === "tracks") {
		const artists = search(catalog, query, { artists: 2, albums: 0, tracks: 0 }).artists.items.filter((a) => a.id > 1);
		for (const a of artists) {
			const pool = scope === "albums" ? [...a.albums].sort((x, y) => y.plays - x.plays) : [...a.tracks].sort((x, y) => y.plays - x.plays);
			for (const item of pool) {
				if (count(KIND_OF[scope]) >= limits[scope]) break;
				add(KIND_OF[scope], item, { via: a });
			}
		}
	}
	if (out.length < 4) {
		const near = closest(catalog, query, limits);
		for (const key of ["artists", "albums", "tracks"]) {
			for (const item of near[key]) {
				if (count(KIND_OF[key]) >= limits[key]) break;
				add(KIND_OF[key], item, { near: true });
			}
		}
	}
	return out;
}

let rowA = new Int32Array(64);
let rowB = new Int32Array(64);

/**
 * Levenshtein distance, giving up (returning max + 1) once it exceeds `max`.
 * `bLen` compares against only the first `bLen` characters of `b`.
 */
export function editDistance(a, b, max, bLen = b.length) {
	const n = Math.min(bLen, b.length);
	if (Math.abs(a.length - n) > max) return max + 1;
	if (rowA.length <= n) { rowA = new Int32Array(n + 1); rowB = new Int32Array(n + 1); }
	let prev = rowA;
	let cur = rowB;
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		cur[0] = i;
		let rowMin = i;
		const ca = a.charCodeAt(i - 1);
		for (let j = 1; j <= n; j++) {
			const sub = prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1);
			const v = Math.min(prev[j] + 1, cur[j - 1] + 1, sub);
			cur[j] = v;
			if (v < rowMin) rowMin = v;
		}
		if (rowMin > max) return max + 1;
		[prev, cur] = [cur, prev];
	}
	return prev[n];
}

/** 32-bit set of the characters in `s`, for a cheap "too different" check. */
function charMask(s) {
	let m = 0;
	for (let i = 0; i < s.length; i++) m |= 1 << (s.charCodeAt(i) % 31);
	return m;
}
function bits(m) {
	let n = 0;
	for (; m; m &= m - 1) n++;
	return n;
}
const masks = new WeakMap();
function recordMask(rec) {
	let m = masks.get(rec);
	if (m === undefined) { m = charMask(rec.searchCompact); masks.set(rec, m); }
	return m;
}
const nameCache = new WeakMap();
/** An artist's own names (name, also known as) or a title, without spaces. */
function namesOf(rec) {
	let n = nameCache.get(rec);
	if (!n) {
		n = [rec.name ?? rec.title, rec.aka].filter(Boolean).map((v) => compact(normalize(v)));
		nameCache.set(rec, n);
	}
	return n;
}
const wordCache = new WeakMap();
function wordsOf(rec) {
	let w = wordCache.get(rec);
	if (!w) { w = rec.search.split(" "); wordCache.set(rec, w); }
	return w;
}

/** Typos allowed for a string of `n` characters. */
const tolerance = (n) => (n < 3 ? 0 : n <= 4 ? 1 : n <= 8 ? 2 : 3);

/**
 * How far a record is from the query, or Infinity when it is not close.
 * Three readings, best one wins:
 *  - the whole name or title, without spaces ("zamnuu" ~ "Zamnu")
 *  - the start of the name or title, for queries typed only part way
 *    ("lalthakma" ~ "Lalthakima Zote"), at a small penalty
 *  - word by word, every query word near some word of the record
 *    ("hong lenin" ~ "Hong len in"; an artist's other names count too)
 */
function distance(rec, qc, tokens, qmask) {
	const max = tolerance(qc.length);
	if (!max) return Infinity;
	// Each typo adds at most one character the record does not have.
	if (bits(qmask & ~recordMask(rec)) > max) return Infinity;
	let best = max + 1;
	// An artist's search text also holds spelling variants; its own names come first.
	for (const hay of namesOf(rec)) {
		best = Math.min(best, editDistance(qc, hay, max));
		if (best && hay.length > qc.length) best = Math.min(best, editDistance(qc, hay, max, qc.length) + 0.5);
	}
	if (best > max) {
		const words = wordsOf(rec);
		let total = 0;
		for (const t of tokens) {
			const tmax = tolerance(t.length);
			let d = t.length < 3 ? (words.some((w) => w.startsWith(t)) ? 0 : Infinity) : tmax + 1;
			if (t.length >= 3) {
				for (const w of words) {
					d = Math.min(d, editDistance(t, w, tmax));
					if (w.length > t.length) d = Math.min(d, editDistance(t, w, tmax, t.length) + 0.5);
					if (d === 0) break;
				}
			}
			if (d > tmax) { total = Infinity; break; }
			total += d;
		}
		best = Math.min(best, total + 0.25);
	}
	return best <= max ? best : Infinity;
}

function nearest(records, qc, tokens, limit) {
	const qmask = charMask(qc);
	const hits = [];
	for (const rec of records) {
		const d = distance(rec, qc, tokens, qmask);
		if (d !== Infinity) hits.push([d, rec]);
	}
	hits.sort((a, b) => a[0] - b[0] || b[1].plays - a[1].plays);
	return hits.slice(0, limit).map((h) => h[1]);
}

/**
 * Closest spellings when a query matches little or nothing: artists (name,
 * also-known-as and spelling variants), albums and songs within a few typos,
 * nearest first, then most played.
 */
export function closest(catalog, query, limits = { artists: 8, albums: 12, tracks: 20 }) {
	const q = normalize(query);
	const qc = compact(q);
	if (qc.length < 3) return { artists: [], albums: [], tracks: [] };
	const tokens = q.split(" ");
	return {
		artists: nearest(catalog.artists.values(), qc, tokens, limits.artists),
		albums: nearest(catalog.albums.values(), qc, tokens, limits.albums),
		tracks: nearest(catalog.tracks.values(), qc, tokens, limits.tracks),
	};
}

/**
 * "Did you mean": the closest artist name or album title for a query with no
 * matches, allowing 1 typo for short queries and 2 for longer ones. Compared
 * without spaces, so "zamnuu" finds Zamnu. Returns null when nothing is close.
 */
export function correction(catalog, query) {
	const q = compact(normalize(query));
	if (q.length < 3) return null;
	const max = q.length <= 5 ? 1 : 2;
	let best = null;
	const consider = (text, cmp, plays) => {
		const d = editDistance(q, cmp, max);
		if (d > max) return;
		if (!best || d < best.d || (d === best.d && plays > best.plays)) best = { text, d, plays };
	};
	for (const a of catalog.artists.values()) {
		consider(a.name, compact(normalize(a.name)), a.plays);
		if (a.aka) consider(a.aka, compact(normalize(a.aka)), a.plays);
	}
	for (const al of catalog.albums.values()) consider(al.title, al.searchCompact, al.plays);
	return best?.text ?? null;
}

/**
 * The text to offer as "Did you mean": the strict correction when there is
 * one, otherwise the name of the closest artist, album or song.
 */
export function didYouMean(catalog, query, near = closest(catalog, query, { artists: 1, albums: 1, tracks: 1 })) {
	const fix = correction(catalog, query);
	if (fix) return fix;
	const pick = near.artists[0]?.name ?? near.albums[0]?.title ?? near.tracks[0]?.title ?? null;
	return pick && normalize(pick) !== normalize(query) ? pick : null;
}
