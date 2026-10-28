/**
 * Catalog loading and in-memory model.
 *
 * meta.json is always revalidated by the service worker; the catalog file it
 * points to is content-hashed and immutable, so it is cached forever.
 */
import { patchRaw } from "./live-catalog.js";
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

/**
 * The catalog's model. `hidden`: ids of albums held back from the public
 * (src/core/holds.js), left out with their songs; artists left with no song
 * are left out too.
 */
export function buildModel(raw, meta, hidden = new Set()) {
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
		if (hidden.has(ui)) continue;
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
	if (hidden.size) for (const [id, a] of artists) if (!a.tracks.length) artists.delete(id);

	// `raw` is what the model is built from: the catalog as released (`source`), with the live changes on it (applyLive).
	const model = { version: meta.version, langs, genres, artists, albums, tracks, topTracks: [], raw, source: raw, meta, hidden, live: [], holdsAlbums: {} };
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

/**
 * Applies the albums held back (src/core/holds.js, docs/holds.md) to the
 * model, in place: albums not listed are left out (the model is built again
 * when that set changes, keeping its uploads), and the songs of albums whose
 * streaming is off are marked (`album.off`). Answers true when the model was
 * built again, so counts and pages are refreshed.
 */
export function applyHolds(model, holds) {
	const albums = holds?.albums ?? {};
	const hidden = new Set(Object.keys(albums).filter((id) => albums[id].listed === false));
	const rebuilt = hidden.size !== model.hidden.size || [...hidden].some((id) => !model.hidden.has(id));
	if (rebuilt) rebuild(model, model.raw, hidden);
	model.holdsAlbums = albums;
	markOff(model);
	return rebuilt;
}

const markOff = (model) => { for (const album of model.albums.values()) album.off = model.holdsAlbums[album.id]?.streaming === false; };

/** Builds the model again in place from `raw`, keeping what lives beside the catalog (uploads, holds, live changes). */
function rebuild(model, raw, hidden) {
	const fresh = buildModel(raw, model.meta, hidden);
	// Its lookups (model.track, model.album) read `extra` from the new model: it is the same one.
	fresh.extra = model.extra;
	Object.assign(model, fresh, { source: model.source, live: model.live, holdsAlbums: model.holdsAlbums });
}

/**
 * Applies catalog changes made live (src/core/live-catalog.js,
 * docs/live-catalog.md) to the model, in place: built again from the
 * released catalog with the changes on it, keeping uploads and holds.
 * Answers { applied, done, stale }.
 */
export function applyLive(model, changes) {
	// Nothing to apply over nothing applied (most starts): the model stands; a rebuild is a good part of starting up.
	if (!changes.length && !model.live.length) { markOff(model); return { raw: model.raw, applied: [], done: [], stale: [] }; }
	const out = patchRaw(model.source, changes);
	model.live = out.applied;
	rebuild(model, out.raw, model.hidden);
	markOff(model);
	return out;
}

const TOP_TRACKS = 100;
// Ids 0 ("Unknown") and 1 ("Various Artists") are catch-all credits, not artists.
export const NOT_ARTISTS = new Set([0, 1]);

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
}

/** Human-readable artist credit for a track or album. */
export function creditOf(list, max = 2) {
	if (!list.length) return "Unknown artist";
	const names = list.slice(0, max).map((a) => a.name);
	return list.length > max ? `${names.join(", ")} and ${list.length - max} more` : names.join(", ");
}
