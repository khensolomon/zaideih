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

const keptKey = (id) => `lyrics.${id}`;

async function keep(id, lyrics) {
	try {
		if (lyrics) await db.put("kv", { ...lyrics, kept: Date.now() }, keptKey(id));
		else await db.delete("kv", keptKey(id));
	} catch (err) {
		console.warn("lyrics could not be kept on this device", err);
	}
}

/**
 * The lyrics of song `id`: { lyrics: {version, text, updated} | null, offline }.
 * Offline, the copy kept on the device (offline: true); throws LyricsError
 * when there is none and the Worker cannot be reached.
 */
export async function readLyrics(id) {
	if (!LYRICS_URL) throw new LyricsError("lyrics are not available in this version of the app");
	let res;
	try {
		res = await fetch(`${LYRICS_URL}/${id}`, { cache: "no-cache" });
	} catch {
		const kept = await db.get("kv", keptKey(id)).catch(() => null);
		if (kept) return { lyrics: kept, offline: true };
		throw new LyricsError("the lyrics cannot be read while offline");
	}
	if (res.status === 404) {
		await keep(id, null);
		return { lyrics: null, offline: false };
	}
	const body = await res.json().catch(() => null);
	if (!res.ok || !body) throw new LyricsError(body?.error ?? `the lyrics could not be read (HTTP ${res.status})`, res.status);
	const lyrics = { version: body.version, text: body.text, updated: body.updated };
	await keep(id, lyrics);
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

/** Saves `text` as the next version of song `id`, started from version `base`; answers the new lyrics. */
export async function saveLyrics(id, text, base) {
	const saved = await call("POST", `/${id}`, { text, base });
	const lyrics = { version: saved.version, text: saved.text, updated: saved.updated };
	await keep(id, lyrics);
	return lyrics;
}

/** The Lyrics right: { version, hidden, versions: [{version, text, at, note, by: {id, name}}] }. */
export const lyricsVersions = (id) => call("GET", `/${id}/versions`);
export const hideLyrics = (id, reason) => call("POST", `/${id}/hide`, { reason });
export const showLyrics = (id) => call("POST", `/${id}/show`, {});
export const restoreLyrics = (id, version, base) => call("POST", `/${id}/restore`, { version, base });
