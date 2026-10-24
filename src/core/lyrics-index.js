/**
 * The lyrics kept on the device for searching (docs/lyrics.md, "Search"):
 * every shown text's words, per song and language, from GET /lyrics/index
 * (worker/media/lyrics.js). Read in full once, then only what changed since
 * (`at`), kept in IndexedDB (`kv` "lyrics.index"), so searching works
 * offline and at once, like the rest of the app's search.
 *
 * It also says which songs have lyrics, for the marker in song lists.
 */
import { LYRICS_URL } from "./lyrics.js";
import { db } from "./db.js";
import { emit } from "./store.js";
import { normalize } from "./text.js";

const KEY = "lyrics.index";
const EVERY_MS = 30 * 60_000;

/** Language names, for results and switches. */
export const LYRICS_LANGS = { "": "Original", en: "English", my: "Myanmar" };

let at = 0;
let fetchedAt = 0;
/** "track/lang" -> { track, lang, version, words, norm } */
const texts = new Map();
/** track -> Set of langs */
const songs = new Map();
let loading = null;

function put(track, lang, version, words) {
	texts.set(`${track}/${lang}`, { track, lang, version, words, norm: words.split("\n").map(normalize) });
	if (!songs.has(track)) songs.set(track, new Set());
	songs.get(track).add(lang);
}
function drop(track, lang) {
	texts.delete(`${track}/${lang}`);
	songs.get(track)?.delete(lang);
	if (songs.get(track)?.size === 0) songs.delete(track);
}

export const lyricsIndex = {
	/** True when song `id` has lyrics (in any language). */
	has: (id) => songs.has(id),
	/** The languages song `id` has lyrics in, the original first. */
	langs: (id) => Object.keys(LYRICS_LANGS).filter((l) => songs.get(id)?.has(l)),
	get size() { return songs.size; },
	/** The first sung line of song `id`'s own words, as kept for searching, or "". */
	firstLine: (id) => texts.get(`${id}/`)?.words.split("\n").find((l) => l.trim()) ?? "",

	/** Reads what is kept on the device, then asks the Worker for what changed (at most every 30 minutes unless `force`). */
	refresh({ force = false } = {}) {
		if (!LYRICS_URL) return Promise.resolve(false);
		if (loading) return loading;
		loading = (async () => {
			try {
				if (!fetchedAt && !texts.size) {
					const kept = await db.get("kv", KEY).catch(() => null);
					if (kept?.songs) {
						at = kept.at ?? 0;
						for (const [track, lang, version, words] of kept.songs) put(track, lang, version, words);
						emit("lyrics-index", lyricsIndex);
					}
				}
				if (!force && Date.now() - fetchedAt < EVERY_MS) return false;
				const res = await fetch(`${LYRICS_URL}/index?since=${at}`, { cache: "no-store" });
				if (!res.ok) throw new Error(`the lyrics index answered HTTP ${res.status}`);
				const answer = await res.json();
				fetchedAt = Date.now();
				const changed = answer.songs.length > 0 || answer.gone.length > 0;
				if (!at) { texts.clear(); songs.clear(); }
				for (const [track, lang] of answer.gone) drop(track, lang);
				for (const [track, lang, version, words] of answer.songs) put(track, lang, version, words);
				at = answer.at;
				if (changed || !at) {
					await db.put("kv", { at, songs: [...texts.values()].map((t) => [t.track, t.lang, t.version, t.words]) }, KEY).catch((err) => console.warn("the lyrics index could not be kept on this device", err));
					emit("lyrics-index", lyricsIndex);
				}
				return changed;
			} finally {
				loading = null;
			}
		})();
		return loading;
	},

	/**
	 * Songs whose lyrics have a line with every word of `query` (normalized as
	 * the app's search does): [{ track, lang, line }], best first: the words
	 * together as typed, then a line starting with them, then the rest.
	 */
	search(query, limit = 30) {
		const q = normalize(query);
		const tokens = q.split(" ").filter(Boolean);
		// Too short to mean a line of lyrics: one or two letters match everything.
		if (q.replace(/\s/g, "").length < 3) return [];
		const hits = [];
		for (const t of texts.values()) {
			let best = null;
			t.norm.forEach((line, i) => {
				if (!tokens.every((w) => line.includes(w))) return;
				const score = line.startsWith(q) ? 0 : line.includes(q) ? 1 : 2;
				if (!best || score < best.score) best = { score, line: t.words.split("\n")[i] };
			});
			if (best) hits.push({ track: t.track, lang: t.lang, line: best.line, score: best.score });
		}
		hits.sort((a, b) => a.score - b.score || (a.lang === "" ? -1 : 0) - (b.lang === "" ? -1 : 0));
		// One hit per song: its best line, the original before a translation.
		const seen = new Set();
		return hits.filter((h) => !seen.has(h.track) && seen.add(h.track)).slice(0, limit);
	},
};
