/**
 * Lyrics of catalog songs (docs/lyrics.md): the app's side of /lyrics on the
 * audio Worker (worker/media/lyrics.js).
 *
 * Reading needs no account. Lyrics once read are kept on the device (IndexedDB
 * `kv`, "lyrics.<song id>"), so they show offline; online, the Worker's copy
 * is asked for each time (it comes from its edge cache, not the database).
 * Adding and editing need a sign-in; the Lyrics right hides, shows and
 * restores earlier versions.
 */
import { LIBRARY_URL } from "../config.js";
import { db } from "./db.js";
import { account } from "./signin.js";

/** Where lyrics are read and written; empty where personal libraries are not built. */
export const LYRICS_URL = LIBRARY_URL ? LIBRARY_URL.replace(/\/library$/, "/lyrics") : "";

export class LyricsError extends Error {
	/** `current`: on a conflict (409), the lyrics someone else saved first, or null. */
	constructor(message, status = 0, current = undefined) {
		super(message);
		this.status = status;
		this.current = current;
	}
}

/*
 * Every call is for one language of a song's lyrics: "" the song's own
 * words, "en" or "my" a translation (worker/media/lyrics.js ?lang=).
 */
const keptKey = (id, lang = "") => `lyrics.${id}${lang ? `.${lang}` : ""}`;
const q = (lang) => (lang ? `?lang=${lang}` : "");

async function keep(id, lyrics, lang = "") {
	try {
		if (lyrics) await db.put("kv", { ...lyrics, kept: Date.now() }, keptKey(id, lang));
		else await db.delete("kv", keptKey(id, lang));
	} catch (err) {
		console.warn("lyrics could not be kept on this device", err);
	}
}

/**
 * The lyrics of song `id` in `lang`: { lyrics: {version, text, updated} | null, offline }.
 * Offline, the copy kept on the device (offline: true); throws LyricsError
 * when there is none and the Worker cannot be reached.
 */
export async function readLyrics(id, lang = "") {
	if (!LYRICS_URL) throw new LyricsError("lyrics are not available in this version of the app");
	let res;
	try {
		res = await fetch(`${LYRICS_URL}/${id}${q(lang)}`, { cache: "no-cache" });
	} catch {
		const kept = await db.get("kv", keptKey(id, lang)).catch(() => null);
		if (kept) return { lyrics: kept, offline: true };
		throw new LyricsError("the lyrics cannot be read while offline");
	}
	if (res.status === 404) {
		await keep(id, null, lang);
		return { lyrics: null, offline: false };
	}
	const body = await res.json().catch(() => null);
	if (!res.ok || !body) throw new LyricsError(body?.error ?? `the lyrics could not be read (HTTP ${res.status})`, res.status);
	const lyrics = { version: body.version, text: body.text, updated: body.updated, shared: body.shared ?? null };
	await keep(id, lyrics, lang);
	return { lyrics, offline: false };
}

async function call(method, path, body) {
	if (!LYRICS_URL) throw new LyricsError("lyrics are not available in this version of the app");
	if (!account().signedIn) throw new LyricsError("sign in first", 401);
	let res;
	try {
		res = await account().send((token) => fetch(`${LYRICS_URL}${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
			body: body ? JSON.stringify(body) : undefined,
			cache: "no-store",
		}));
	} catch (err) {
		if (err instanceof LyricsError) throw err;
		throw new LyricsError(navigator.onLine === false ? "you are offline; your text is still here, save again when you are back online" : `the lyrics server could not be reached (${err.message})`);
	}
	const answer = await res.json().catch(() => null);
	if (!res.ok) throw new LyricsError(answer?.error ?? `HTTP ${res.status}`, res.status, answer?.current);
	return answer;
}

/** Saves `text` as the next version of song `id` in `lang`, started from version `base`; answers the new lyrics. */
export async function saveLyrics(id, text, base, lang = "") {
	const saved = await call("POST", `/${id}${q(lang)}`, { text, base });
	const lyrics = { version: saved.version, text: saved.text, updated: saved.updated, shared: saved.shared ?? null };
	await keep(id, lyrics, lang);
	return lyrics;
}

/**
 * Shared lyrics (docs/lyrics.md), for the Lyrics right: song `id` shows the
 * lyrics of song `to`. A song with lyrics of its own is merged:
 * `{ merge: true, keep: "track" | "to" }` names the text kept; `proposal`,
 * the member's proposal this answers. Answers its lyrics, with `shared`.
 */
export async function linkLyrics(id, to, { merge = false, keep: kept, proposal } = {}) {
	const linked = await call("POST", `/${id}/link`, { to, ...(merge ? { merge: true, keep: kept } : {}), ...(proposal ? { proposal } : {}) });
	const lyrics = { version: linked.version, text: linked.text, updated: linked.updated, shared: linked.shared ?? null };
	await keep(id, lyrics);
	return lyrics;
}
/** Anyone signed in: proposes that song `id` is the same song as `to`; the Lyrics right decides. */
export const proposeSameSong = (id, to, note = "") => call("POST", `/${id}/propose`, { to, note });
/** The Lyrics right: both copies, `{ a, b }` with text, versions, people, updated, langs, reports. */
export const compareLyrics = (id, other) => call("GET", `/${id}/compare?with=${other}`);
/** The Lyrics right: song `id` no longer shows another's lyrics; with `copy`, it keeps a copy as its own. */
export const unlinkLyrics = (id, copy) => call("POST", `/${id}/unlink`, { copy: Boolean(copy) });

/** The Lyrics right: { track, source, lang, version, hidden, versions, own, reports }; each version {version, text, at, note, by: {id, name}}; `own` is a merged song's earlier history. */
export const lyricsVersions = (id, lang = "") => call("GET", `/${id}/versions${q(lang)}`);
export const hideLyrics = (id, reason, lang = "") => call("POST", `/${id}/hide${q(lang)}`, { reason });
export const showLyrics = (id, lang = "") => call("POST", `/${id}/show${q(lang)}`, {});
export const restoreLyrics = (id, version, base, lang = "") => call("POST", `/${id}/restore${q(lang)}`, { version, base });
/** Anyone signed in: tells the Lyrics right something is wrong with song `id`'s lyrics. */
export const reportLyrics = (id, reason, lang = "") => call("POST", `/${id}/report${q(lang)}`, { reason });
/** The Lyrics right: song `id`'s open reports are dealt with, nothing changed. */
export const resolveReports = (id, lang = "") => call("POST", `/${id}/resolve${q(lang)}`, {});

/*
 * Drafts (docs/lyrics.md, "Studio"): what is typed in the studio is kept on
 * the device as it is typed, per song, with the version it started from, so
 * a closed tab or a dead battery loses nothing. Saving clears it.
 */
const draftKey = (id, lang = "") => `lyrics.draft.${id}${lang ? `.${lang}` : ""}`;
export async function readDraft(id, lang = "") {
	try {
		return (await db.get("kv", draftKey(id, lang))) ?? null;
	} catch {
		return null;
	}
}
export async function keepDraft(id, draft, lang = "") {
	try {
		await db.put("kv", { ...draft, at: Date.now() }, draftKey(id, lang));
	} catch (err) {
		console.warn("the draft could not be kept on this device", err);
	}
}
export async function dropDraft(id, lang = "") {
	try {
		await db.delete("kv", draftKey(id, lang));
	} catch { /* nothing kept */ }
}
