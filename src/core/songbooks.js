/**
 * Songbooks on the audio Worker (worker/media/songbooks.js, docs/songbooks.md):
 * books, their hymn numbers and texts. A text's words are lyrics, saved with
 * core/lyrics.js under the text's id.
 */
import { LIBRARY_URL } from "../config.js";
import { saveLyrics } from "./lyrics.js";
import { account } from "./signin.js";

export const SONGBOOKS_URL = LIBRARY_URL ? LIBRARY_URL.replace(/\/library$/, "/songbooks") : "";

export class SongbookError extends Error {
	constructor(message, status = 0) {
		super(message);
		this.status = status;
	}
}

/** A call to the Worker; signed in when someone is (private books need it). */
async function call(method, path, body) {
	if (!SONGBOOKS_URL) throw new SongbookError("songbooks are not available in this version of the app");
	const send = (token) => fetch(`${SONGBOOKS_URL}${path}`, {
		method,
		headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
		cache: "no-store",
	});
	let res;
	try {
		res = account().signedIn ? await account().send(send) : await send(null);
	} catch (err) {
		throw new SongbookError(navigator.onLine === false ? "you are offline; try again when you are back online" : `the songbooks could not be reached (${err.message})`);
	}
	const answer = await res.json().catch(() => null);
	if (!res.ok) throw new SongbookError(answer?.error ?? `HTTP ${res.status}`, res.status);
	return answer;
}

export const listBooks = async () => (await call("GET", "")).books;
export const readBook = (id) => call("GET", `/${id}`);
export const createBook = (fields) => call("POST", "", fields);
export const updateBook = (id, fields) => call("POST", `/${id}`, fields);

/**
 * Adds hymns to book `bookId`, one after another, each a new text with its
 * words saved as lyrics; stops at the first that fails (what was added stays).
 * `onStep(done, total)` after each. Answers the texts added: [{ number, text }].
 */
export async function addHymns(bookId, hymns, { onStep = () => {} } = {}) {
	const added = [];
	for (const h of hymns) {
		let entry;
		try {
			entry = await call("POST", `/${bookId}/entries`, { number: h.number, title: h.title, firstLine: h.firstLine });
			if (h.text.trim()) await saveLyrics(entry.text, h.text, 0);
		} catch (err) {
			const e = new SongbookError(`hymn ${h.number}: ${err.message}${entry ? " (its number was added; its words were not)" : ""}`, err.status ?? 0);
			e.added = added;
			throw e;
		}
		added.push({ number: h.number, text: entry.text });
		onStep(added.length, hymns.length);
	}
	return added;
}
