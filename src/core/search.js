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
 * Quick suggestions for the search box: up to 2 artists, 2 albums and 4
 * songs, best matches first within each kind.
 */
export function suggestions(catalog, query) {
	const r = search(catalog, query, { tracks: 4, albums: 2, artists: 2 });
	if (!r) return [];
	return [
		...r.artists.items.map((item) => ({ kind: "artist", item })),
		...r.albums.items.map((item) => ({ kind: "album", item })),
		...r.tracks.items.map((item) => ({ kind: "track", item })),
	];
}

/** Levenshtein distance, giving up (returning max + 1) once it exceeds `max`. */
export function editDistance(a, b, max) {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			cur.push(v);
			if (v < rowMin) rowMin = v;
		}
		if (rowMin > max) return max + 1;
		prev = cur;
	}
	return prev[b.length];
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
