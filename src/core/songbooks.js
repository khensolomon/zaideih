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

/** The books the person sees: { books (each with `may`), create (may add a book), publish (may make one public) }. */
export const listBooks = () => call("GET", "");
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

export const readText = (id) => call("GET", `/texts/${id}`);
export const updateText = (id, fields) => call("POST", `/texts/${id}`, fields);
export const readPerson = (id) => call("GET", `/people/${id}`);
export const findPeople = async (q) => (await call("GET", `/people?q=${encodeURIComponent(q)}`)).people;
export const createPerson = (fields) => call("POST", "/people", fields);
export const updatePerson = (id, fields) => call("POST", `/people/${id}`, fields);
export const readWork = (id) => call("GET", `/works/${id}`);
export const findWorks = async (q) => (await call("GET", `/works?q=${encodeURIComponent(q)}`)).works;
export const createWork = (fields) => call("POST", "/works", fields);
export const updateWork = (id, fields) => call("POST", `/works/${id}`, fields);
/** Those appointed to book `bookId`: [{ member, name, role, addedBy, at }] (the Songbooks right). */
export const listCollaborators = async (bookId) => (await call("GET", `/${bookId}/collaborators`)).collaborators;
/** Appoints `member` to book `bookId` as "editor" or "reader"; null takes them off. Answers the collaborators. */
export const setCollaborator = async (bookId, member, role) => (await call("POST", `/${bookId}/collaborators`, { member, role })).collaborators;
/** Members by name or sign-in, to appoint: [{ id, name, logins }]. */
export const findMembers = async (q) => (await call("GET", `/members?q=${encodeURIComponent(q)}`)).members;
/** True when `may` (a book's or a text's) lets the person change it. */
export const mayEdit = (may) => may === "edit" || may === "manage";
/** Hymn `number` of book `bookId` prints another text, or (`remove`) is taken out. */
export const setEntry = (bookId, number, change) => call("POST", `/${bookId}/entries/${number}`, change);

/* ------------------------------------------------------------- index ---- */

/*
 * Every hymn of the books (GET /songbooks/index), for search and for naming
 * a text where it is printed ("TL 145"). The public index is kept on the
 * device (KEY) and read again after INDEX_MS; signed in, the private books
 * the person sees come too (the Songbooks right, or appointed to them), and
 * the index is kept in memory only.
 */
const KEY = "zaideih.songbooks.index";
const INDEX_MS = 10 * 60 * 1000;
let index = { books: new Map(), byText: new Map(), at: 0, private: false };

function build(data, at, isPrivate) {
	const books = new Map(data.books.map((b) => [b.id, b]));
	const byText = new Map();
	for (const [text, book, number, title] of data.entries) {
		const b = books.get(book);
		if (b && !byText.has(text)) byText.set(text, { text, book: b, number, title });
	}
	return { books, byText, at, private: isPrivate };
}

try {
	const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
	if (saved?.data) index = build(saved.data, saved.at ?? 0, false);
} catch { /* read again below */ }

/** Reads the index again when it is older than INDEX_MS, when someone signs in or out, or when `force`. */
export async function refreshHymnIndex({ force = false } = {}) {
	if (!SONGBOOKS_URL) return index;
	const signed = account().signedIn;
	if (!force && signed === index.private && Date.now() - index.at < INDEX_MS) return index;
	const data = await call("GET", "/index");
	index = build(data, Date.now(), signed);
	if (!signed) {
		try { localStorage.setItem(KEY, JSON.stringify({ at: index.at, data })); } catch { /* this visit only */ }
	}
	return index;
}

/** Where text `id` is printed first: { text, book, number, title }, or null. */
export const hymnOf = (id) => index.byText.get(id) ?? null;
export const hymnBooks = () => [...index.books.values()];

/**
 * "TL 145", "tl145", "Tedim Labu 145": the hymn it names, or null. The book
 * by its short name or title (whole, case aside), the number at the end.
 */
export function findHymn(query) {
	const m = /^\s*(.+?)\s*#?\s*(\d{1,5})\s*$/u.exec(String(query ?? ""));
	if (!m) return null;
	const name = m[1].toLowerCase();
	const number = Number(m[2]);
	const book = [...index.books.values()].find((b) => b.short.toLowerCase() === name || b.title.toLowerCase() === name);
	if (!book) return null;
	for (const h of index.byText.values()) if (h.book.id === book.id && h.number === number) return h;
	return { text: null, book, number, title: "" };
}

/** The hymn's address: its book and number. */
export const hymnHref = (h) => `#/songbook/${h.book.id}/${h.number}`;
