/**
 * Catalog changes made live, without a release (docs/live-catalog.md).
 *
 * The catalog ships with each release, from git (assets/data). A change made
 * live in the Workspace ("Apply now") is kept by the audio Worker (GET /live)
 * and applied by the app on top of the catalog it shipped with, so listeners
 * see it within minutes; "Release the live changes" later puts it into git
 * with an ordinary release, and the live copy is then retired.
 *
 * A change is the Workspace draft's own (src/workspace/draft.js), with two
 * more parts:
 *
 *   { kind, id, field, value,
 *     base,   the value in the released catalog it was made against
 *     refs }  what the released catalog may lack to show it: artists
 *             ([id, name, aka, type, thesaurus]), languages and genres ([id, name])
 *
 * It is applied only while the released catalog still has `base`: once a
 * release carries the change it is "done" (nothing to do), and a release
 * that set the field to something else wins ("stale"). So a live change can
 * never undo a release, and an app of any version shows the same.
 *
 * Pure apart from startLive (tests/live-catalog.test.mjs).
 */
import { AUDIO_URL_TEMPLATE } from "../config.js";

/** The fields that can change live: the Workspace's, but showing a hidden song again (it is not shipped) and deleting an artist (one without songs is not shipped either). */
export const LIVE_FIELDS = Object.freeze({
	album: ["ab", "yr", "lg", "gr"],
	track: ["t", "a", "h", "d"],
	artist: ["name", "aka", "type", "thesaurus"],
});

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/** Indexes of a compiled catalog (build/catalog): albums, tracks (with their album row) and artists by id. */
export function indexRaw(raw) {
	const album = new Map();
	const track = new Map();
	for (const row of raw.albums) {
		album.set(row[0], row);
		for (const t of row[5]) track.set(t[0], { album: row, row: t });
	}
	return { album, track, artist: new Map(raw.artists.map((a) => [a[0], a])) };
}

/**
 * A field's value in a compiled catalog, in the draft's form (year: a
 * number or null; hidden: true when the song is not shipped). Undefined when
 * the record is not in it.
 */
export function rawValue(index, { kind, id, field }) {
	if (kind === "album") {
		const al = index.album.get(id);
		if (!al) return undefined;
		return { ab: al[1], lg: al[2], gr: al[3], yr: al[4] || null }[field];
	}
	if (kind === "track") {
		const hit = index.track.get(id);
		if (field === "h") return hit ? false : undefined;
		if (!hit) return undefined;
		return { t: hit.row[1], a: hit.row[2], d: hit.row[3] }[field];
	}
	const a = index.artist.get(id);
	if (!a) return undefined;
	return { name: a[1], aka: a[2], type: a[3], thesaurus: a[4] }[field];
}

/**
 * The compiled catalog with the live changes applied, without changing
 * `source`: { raw, applied, done, stale } (the changes in each state).
 */
export function patchRaw(source, changes) {
	const raw = { ...source, lang: source.lang.slice(), genre: source.genre.slice(), artists: source.artists.map((a) => a.slice()), albums: source.albums.map((al) => [...al.slice(0, 5), al[5].map((t) => t.slice())]) };
	const index = indexRaw(raw);
	const out = { raw, applied: [], done: [], stale: [] };
	const addRefs = (refs = {}) => {
		for (const a of refs.artists ?? []) if (!index.artist.has(a[0])) { const copy = a.slice(); raw.artists.push(copy); index.artist.set(a[0], copy); }
		for (const l of refs.langs ?? []) if (!raw.lang.some(([id]) => id === l[0])) raw.lang.push(l.slice());
		for (const g of refs.genres ?? []) if (!raw.genre.some(([id]) => id === g[0])) raw.genre.push(g.slice());
	};
	const dropped = new Set();
	for (const c of changes) {
		if (!LIVE_FIELDS[c.kind]?.includes(c.field)) { out.stale.push(c); continue; }
		const now = rawValue(index, c);
		if (now === undefined) { out.stale.push(c); continue; }
		if (same(now, c.value)) { out.done.push(c); continue; }
		if (!same(now, c.base)) { out.stale.push(c); continue; }
		addRefs(c.refs);
		if (c.kind === "album") {
			const al = index.album.get(c.id);
			const at = { ab: 1, lg: 2, gr: 3, yr: 4 }[c.field];
			al[at] = c.field === "yr" ? c.value ?? 0 : c.value;
		} else if (c.kind === "track") {
			const hit = index.track.get(c.id);
			if (c.field === "h") {
				// Hidden: not shipped, as a release would leave it out.
				if (!c.value) { out.stale.push(c); continue; }
				hit.album[5] = hit.album[5].filter((t) => t[0] !== c.id);
				index.track.delete(c.id);
				if (!hit.album[5].length) dropped.add(hit.album[0]);
			} else hit.row[{ t: 1, a: 2, d: 3 }[c.field]] = c.value;
		} else {
			const a = index.artist.get(c.id);
			a[{ name: 1, aka: 2, type: 3, thesaurus: 4 }[c.field]] = c.value;
		}
		out.applied.push(c);
	}
	// An album whose every song is hidden is left out as a whole, as a release would.
	if (dropped.size) raw.albums = raw.albums.filter((al) => !dropped.has(al[0]));
	// A genre newly named is in the catalog's order (by name).
	raw.genre.sort((x, y) => x[1].localeCompare(y[1]));
	return out;
}

/** Checks the Worker's answer; throws with the reason when it is not usable. */
export function parseLive(data) {
	if (!data || typeof data !== "object" || !Number.isFinite(data.at) || !Array.isArray(data.changes)) throw new Error("the live catalog answer is not { at, changes }");
	for (const c of data.changes) {
		if (!c || !LIVE_FIELDS[c.kind]?.includes(c.field) || !("value" in c) || !("base" in c)) throw new Error("a live change is not { kind, id, field, value, base }");
	}
	return { at: data.at, changes: data.changes };
}

const KEY = "zaideih.live";
export const REFRESH_MS = 5 * 60 * 1000;

/** GET /live on the audio Worker, or "" where the build streams from nowhere. */
export function liveUrl(audioTemplate = AUDIO_URL_TEMPLATE) {
	try {
		return `${new URL(audioTemplate.replace(/\{[a-z]+\}/g, "x")).origin}/live`;
	} catch {
		return "";
	}
}

/**
 * Applies the live changes kept on the device at once, then keeps them
 * fresh: read when the app starts and every REFRESH_MS while it is shown.
 * `apply(changes)` puts them on the catalog (applyLive in core/catalog.js);
 * `onChange` runs after a change (to redraw what shows the catalog).
 */
export function startLive({ apply, onChange = () => {}, url = liveUrl() }) {
	let current = "";
	let busy = false;
	const take = (live) => {
		const key = JSON.stringify(live.changes);
		if (key === current) return false;
		current = key;
		apply(live.changes);
		return true;
	};
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
		if (saved) take(parseLive(saved));
	} catch (err) {
		console.warn(`saved live catalog changes ignored: ${err.message}`);
	}
	async function refresh() {
		if (!url || busy || !navigator.onLine || document.visibilityState === "hidden") return;
		busy = true;
		try {
			const res = await fetch(url, { credentials: "omit", cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const live = parseLive(await res.json());
			try { localStorage.setItem(KEY, JSON.stringify(live)); } catch { /* used for this visit only */ }
			if (take(live)) onChange();
		} catch (err) {
			console.warn(`live catalog changes could not be read (${err.message}); keeping the last known ones`);
		} finally {
			busy = false;
		}
	}
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
	addEventListener("online", refresh);
	setInterval(refresh, REFRESH_MS);
	refresh();
	return { refresh };
}
