/**
 * Songs trimmed in the audio studio (docs/audio-studio.md), without a
 * release: the audio Worker's GET /edits, read when the app starts (the last
 * copy kept on the device at once, for offline use too) and again every
 * REFRESH_MS while the app is shown.
 *
 *   - Each such song is played by its version number (`?v=`, config.js
 *     audioUrl), so a copy of another version kept by a browser or a cache
 *     is never played instead.
 *   - Its length is the version's (`applyEdits`, after every rebuild of the
 *     catalog too: core/holds.js rebuilds it).
 *   - A downloaded copy of another version is downloaded again
 *     (core/offline.js `refreshVersions`).
 */
import { AUDIO_URL_TEMPLATE, setAudioVersions } from "../config.js";

const KEY = "zaideih.edits";
export const REFRESH_MS = 5 * 60 * 1000;

/** GET /edits on the audio Worker, or "" where the build streams from nowhere. */
export function editsUrl(audioTemplate = AUDIO_URL_TEMPLATE) {
	try {
		return `${new URL(audioTemplate.replace(/\{[a-z]+\}/g, "x")).origin}/edits`;
	} catch {
		return "";
	}
}

/** Checks the Worker's answer: { at, tracks: Map<track id, { version, durationMs }> }; throws with the reason when it is not usable. */
export function parseEdits(data) {
	if (!data || typeof data !== "object" || !Number.isFinite(data.at) || !data.tracks || typeof data.tracks !== "object") throw new Error("the edits answer is not { at, tracks }");
	const tracks = new Map();
	for (const [id, v] of Object.entries(data.tracks)) {
		const n = Number(id);
		if (!Number.isSafeInteger(n) || !Array.isArray(v) || !Number.isSafeInteger(v[0]) || v[0] < 0 || !(v[1] === null || Number.isFinite(v[1]))) throw new Error(`the edit of song ${id} is not [version, durationMs]`);
		tracks.set(n, { version: v[0], durationMs: v[1] });
	}
	return { at: data.at, tracks };
}

let edits = new Map();
setAudioVersions((id) => edits.get(id)?.version);

/** The version of song `id` to play, or undefined (never trimmed). */
export const versionOf = (id) => edits.get(id)?.version;

/**
 * Gives the catalog's songs the lengths of their versions; a song made the
 * original again gets its catalog length back. Answers true when a length changed.
 */
export function applyEdits(catalog, list = edits) {
	let changed = false;
	const albums = new Set();
	for (const t of catalog.tracks.values()) {
		const e = list.get(t.id);
		const catalogDuration = t.catalogDuration ?? t.duration;
		const want = e?.durationMs ? Math.round(e.durationMs / 1000) : catalogDuration;
		if (t.duration !== want) {
			t.catalogDuration = catalogDuration;
			t.duration = want;
			changed = true;
			if (t.album) albums.add(t.album);
		}
	}
	// An album's length is its songs' (the album page shows it).
	for (const album of albums) album.duration = album.tracks.reduce((n, t) => n + t.duration, 0);
	return changed;
}

function readSaved() {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
		return saved ? parseEdits(saved) : null;
	} catch (err) {
		console.warn(`saved song versions ignored: ${err.message}`);
		return null;
	}
}

/**
 * Applies the saved versions at once, then keeps them fresh. `onChange(list)`
 * runs after a change (to redraw, and to download changed songs again).
 */
export function startEdits(catalog, { onChange = () => {}, url = editsUrl() } = {}) {
	let current = "";
	let busy = false;
	const apply = (data, raw) => {
		const key = JSON.stringify(raw);
		if (key === current) return false;
		current = key;
		edits = data.tracks;
		applyEdits(catalog);
		return true;
	};
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
		const saved = raw ? readSaved() : null;
		if (saved) apply(saved, raw);
	} catch { /* read below */ }
	/** `force`: past the browser's copy (a change was just made here). */
	async function refresh({ force = false } = {}) {
		if (!url || busy || !navigator.onLine || (!force && document.visibilityState === "hidden")) return;
		busy = true;
		try {
			const res = await fetch(url, { credentials: "omit", cache: force ? "no-cache" : "default" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const raw = await res.json();
			const data = parseEdits(raw);
			try { localStorage.setItem(KEY, JSON.stringify(raw)); } catch { /* used for this visit only */ }
			if (apply(data, raw)) onChange(edits);
		} catch (err) {
			console.warn(`song versions could not be read (${err.message}); keeping the last known ones`);
		} finally {
			busy = false;
		}
	}
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
	addEventListener("online", () => refresh());
	setInterval(() => refresh(), REFRESH_MS);
	refresh();
	return { refresh, reapply: () => applyEdits(catalog) };
}
