/**
 * Play totals from the audio Worker (GET /plays), added to the catalog's own
 * counts, so "most played" everywhere reflects listening on Zaideih since
 * play counting began, on top of the counts the catalog shipped with.
 *
 * - The last totals are kept per device (localStorage) and applied at start,
 *   so the counts are there offline and before the network answers.
 * - They are fetched again at start and when the app comes back to the
 *   foreground, at most every REFRESH_MS (the Worker caches them 5 minutes).
 * - Each track's count is its catalog count (`base`) plus its total; `recent`
 *   holds the plays of the last 30 days. Album, artist and top lists are
 *   recomputed (core/catalog.js recount).
 * - A failed fetch keeps the last totals and says so in the console; the
 *   app works the same without them.
 */
import { AUDIO_URL_TEMPLATE, PLAYS_URL } from "../config.js";
import { recount } from "./catalog.js";

const KEY = "zaideih.playtotals";
const REFRESH_MS = 10 * 60 * 1000;

/** Where the totals are read: the counting address, or /plays on the audio origin. */
export function totalsUrl(playsUrl = PLAYS_URL, audioTemplate = AUDIO_URL_TEMPLATE) {
	if (playsUrl) return playsUrl;
	try {
		return `${new URL(audioTemplate.replace(/\{[a-z]+\}/g, "x")).origin}/plays`;
	} catch {
		return "";
	}
}

/** Checks the Worker's answer; throws with the reason when it is not usable. */
export function parseTotals(data) {
	if (!data || data.v !== 1 || !Array.isArray(data.tracks)) throw new Error("unexpected play totals format");
	const map = new Map();
	for (const row of data.tracks) {
		const [id, total, recent] = Array.isArray(row) ? row : [];
		if (!Number.isSafeInteger(id) || !Number.isSafeInteger(total) || total < 0) continue;
		map.set(id, { total, recent: Number.isSafeInteger(recent) && recent >= 0 ? recent : 0 });
	}
	return { updated: Number(data.updated) || 0, map };
}

/** Sets every track's count to its catalog count plus its total, and recomputes the rankings. */
export function applyTotals(catalog, totals) {
	for (const t of catalog.tracks.values()) {
		const row = totals.map.get(t.id);
		t.plays = t.base + (row?.total ?? 0);
		t.recent = row?.recent ?? 0;
	}
	recount(catalog);
}

function readSaved() {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
		return saved && saved.data ? saved : null;
	} catch {
		return null;
	}
}

/**
 * Applies saved totals, then keeps them fresh. `onChange` runs after new
 * totals are applied (to redraw what shows counts).
 */
export function startPlayTotals(catalog, { onChange = () => {}, url = totalsUrl() } = {}) {
	let fetchedAt = 0;
	let busy = false;
	const saved = readSaved();
	if (saved) {
		try {
			applyTotals(catalog, parseTotals(saved.data));
			fetchedAt = saved.fetchedAt || 0;
		} catch (err) {
			console.warn(`saved play totals ignored: ${err.message}`);
		}
	}
	async function refresh() {
		if (!url || busy || !navigator.onLine || Date.now() - fetchedAt < REFRESH_MS) return;
		busy = true;
		try {
			const res = await fetch(url, { credentials: "omit" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			const totals = parseTotals(data);
			fetchedAt = Date.now();
			try { localStorage.setItem(KEY, JSON.stringify({ fetchedAt, data })); } catch { /* used for this visit only */ }
			applyTotals(catalog, totals);
			onChange();
		} catch (err) {
			console.warn(`play totals could not be updated (${err.message}); showing the last known counts`);
		} finally {
			busy = false;
		}
	}
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
	addEventListener("online", refresh);
	refresh();
	return { refresh };
}
