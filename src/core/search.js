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
