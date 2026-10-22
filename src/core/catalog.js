/**
 * Catalog loading and in-memory model.
 *
 * meta.json is always revalidated by the service worker; the catalog file it
 * points to is content-hashed and immutable, so it is cached forever.
 */
import { compact, normalize } from "./text.js";

const SUPPORTED_FORMAT = 1;
const TOP_ARTISTS_PER_LANGUAGE = 12;

export class CatalogLoadError extends Error {}

async function fetchJson(url) {
	let res;
	try {
		res = await fetch(url);
	} catch {
		throw new CatalogLoadError("The music catalog could not be loaded. Connect to the internet once so it can be saved for offline use.");
	}
	if (!res.ok) throw new CatalogLoadError(`The music catalog could not be loaded (${url} returned ${res.status}).`);
	return res.json();
}

export async function loadCatalog(base = "catalog/") {
	const meta = await fetchJson(`${base}meta.json`);
	if (meta.format !== SUPPORTED_FORMAT) {
		throw new CatalogLoadError(`Catalog format ${meta.format} is not supported by this version of the app. Reload to update.`);
	}
	const raw = await fetchJson(`${base}${meta.catalog}`);
	if (raw.format !== SUPPORTED_FORMAT) {
		throw new CatalogLoadError(`Catalog file ${meta.catalog} has unsupported format ${raw.format}.`);
	}
	return buildModel(raw, meta);
}

export function buildModel(raw, meta) {
	const langs = new Map(raw.lang.map(([id, name]) => [id, { id, name, albums: [] }]));
	const genres = new Map(raw.genre.map(([id, name]) => [id, { id, name, albums: [] }]));
	const artistTypes = new Map(raw.artistType);

	const artists = new Map();
	for (const [id, name, aka, type, thesaurus] of raw.artists) {
		const terms = normalize([name, aka, ...thesaurus].join(" "));
		artists.set(id, {
			id, name, aka, type, typeName: artistTypes.get(type) ?? "",
			tracks: [], albums: new Set(), plays: 0,
			search: terms, searchCompact: compact(terms),
		});
	}

	const albums = new Map();
	const tracks = new Map();
	for (const [ui, title, lg, gr, year, rows] of raw.albums) {
		const lang = langs.get(lg);
		const album = {
			id: ui, title, lang, year,
			genres: gr.map((g) => genres.get(g)).filter(Boolean),
			tracks: [], duration: 0, plays: 0, artists: [],
			search: normalize(title),
		};
		album.searchCompact = compact(album.search);
		const credit = new Map();
		rows.forEach(([id, ttitle, artistIds, duration, plays], idx) => {
			const trackArtists = artistIds.map((a) => artists.get(a));
			const t = {
				// `base`: the catalog's own count (from before play counting in D1); `plays`
				// adds the counted plays (applyPlayTotals in core/playcounts.js).
				id, title: ttitle, album, n: idx + 1, duration, plays, base: plays, recent: 0,
				artists: trackArtists,
				search: normalize(ttitle),
			};
			t.searchCompact = compact(t.search);
			album.tracks.push(t);
			album.duration += duration;
			tracks.set(id, t);
			for (const a of trackArtists) {
				a.tracks.push(t);
				a.albums.add(album);
				credit.set(a, (credit.get(a) ?? 0) + 1);
			}
		});
		album.artists = [...credit].sort((x, y) => y[1] - x[1]).map(([a]) => a);
		lang.albums.push(album);
		for (const g of album.genres) g.albums.push(album);
		albums.set(ui, album);
	}

	for (const a of artists.values()) a.albums = [...a.albums].sort((x, y) => (y.year || 0) - (x.year || 0));

	const model = { version: meta.version, langs, genres, artists, albums, tracks, topTracks: [], topArtists: [] };
	/*
	 * Songs and albums outside the public catalog (the signed-in person's own
	 * uploads, src/core/uploads.js): found by id like catalog ones, but never
	 * part of the catalog's lists, counts, search or play totals.
	 */
	model.extra = { tracks: new Map(), albums: new Map() };
	model.track = (id) => tracks.get(id) ?? model.extra.tracks.get(id);
	model.album = (id) => albums.get(id) ?? model.extra.albums.get(id);
	recount(model);
	return model;
}

const TOP_TRACKS = 100;
const TOP_ARTISTS = 40;
// Ids 0 ("Unknown") and 1 ("Various Artists") are catch-all credits, not artists.
const NOT_ARTISTS = new Set([0, 1]);

/**
 * Recomputes everything derived from the tracks' play counts: album and
 * artist totals, the most played artists per language and overall, and the
 * most played tracks. Run after building and whenever the counts change.
 */
export function recount(model) {
	const byPlays = (x, y) => y.plays - x.plays;
	for (const a of model.artists.values()) a.plays = 0;
	for (const album of model.albums.values()) {
		album.plays = 0;
		for (const t of album.tracks) {
			album.plays += t.plays;
			for (const a of t.artists) a.plays += t.plays;
		}
	}
	for (const lang of model.langs.values()) {
		const plays = new Map();
		for (const album of lang.albums) {
			for (const t of album.tracks) {
				for (const a of t.artists) {
					if (!NOT_ARTISTS.has(a.id)) plays.set(a, (plays.get(a) ?? 0) + t.plays);
				}
			}
		}
		lang.topArtists = [...plays]
			.sort((x, y) => y[1] - x[1])
			.slice(0, TOP_ARTISTS_PER_LANGUAGE)
			.map(([artist, n]) => ({ artist, plays: n }));
	}
	model.topTracks = [...model.tracks.values()].sort(byPlays).slice(0, TOP_TRACKS);
	model.topArtists = [...model.artists.values()].filter((a) => a.type >= 2).sort(byPlays).slice(0, TOP_ARTISTS);
}

/** Human-readable artist credit for a track or album. */
export function creditOf(list, max = 2) {
	if (!list.length) return "Unknown artist";
	const names = list.slice(0, max).map((a) => a.name);
	return list.length > max ? `${names.join(", ")} and ${list.length - max} more` : names.join(", ");
}
