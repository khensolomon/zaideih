/**
 * Albums held back from listeners without a release (docs/holds.md): the
 * audio Worker's GET /holds, read when the app starts (the last copy kept on
 * the device at once, for offline use too) and again every REFRESH_MS while
 * the app is shown, and applied to the catalog (applyHolds in core/catalog.js).
 *
 *   listed off      the album and its songs are left out of the catalog
 *   streaming off   they stay, greyed out, and do not play (core/player.js)
 *
 * The Worker refuses held songs on its own, so a hold holds even in an app
 * that has not read it yet.
 */
import { AUDIO_URL_TEMPLATE } from "../config.js";
import { applyHolds } from "./catalog.js";
import { applyTotals } from "./playcounts.js";

const KEY = "zaideih.holds";
export const REFRESH_MS = 5 * 60 * 1000;

/** GET /holds on the audio Worker, or "" where the build streams from nowhere. */
export function holdsUrl(audioTemplate = AUDIO_URL_TEMPLATE) {
	try {
		return `${new URL(audioTemplate.replace(/\{[a-z]+\}/g, "x")).origin}/holds`;
	} catch {
		return "";
	}
}

/** Checks the Worker's answer; throws with the reason when it is not usable. */
export function parseHolds(data) {
	if (!data || typeof data !== "object" || !Number.isFinite(data.at) || !data.albums || typeof data.albums !== "object") {
		throw new Error("the holds answer is not { at, albums }");
	}
	const albums = {};
	for (const [id, h] of Object.entries(data.albums)) {
		if (!h || typeof h.streaming !== "boolean" || typeof h.listed !== "boolean") throw new Error(`the hold of album ${id} is not { streaming, listed }`);
		albums[id] = { streaming: h.streaming, listed: h.listed };
	}
	return { at: data.at, albums };
}

function readSaved() {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
		return saved ? parseHolds(saved) : null;
	} catch (err) {
		console.warn(`saved album holds ignored: ${err.message}`);
		return null;
	}
}

/**
 * Applies the saved holds at once, then keeps them fresh. `onChange` runs
 * after a change is applied (to redraw what shows the catalog).
 */
export function startHolds(catalog, { onChange = () => {}, url = holdsUrl() } = {}) {
	let current = "";
	let busy = false;
	const apply = (holds) => {
		const key = JSON.stringify(holds.albums);
		if (key === current) return false;
		current = key;
		// Built again: the counted plays go back on (core/playcounts.js).
		if (applyHolds(catalog, holds) && catalog.totals) applyTotals(catalog, catalog.totals);
		return true;
	};
	const saved = readSaved();
	if (saved) apply(saved);
	async function refresh() {
		if (!url || busy || !navigator.onLine || document.visibilityState === "hidden") return;
		busy = true;
		try {
			const res = await fetch(url, { credentials: "omit" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const holds = parseHolds(await res.json());
			try { localStorage.setItem(KEY, JSON.stringify(holds)); } catch { /* used for this visit only */ }
			if (apply(holds)) onChange();
		} catch (err) {
			console.warn(`album holds could not be read (${err.message}); keeping the last known ones`);
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
