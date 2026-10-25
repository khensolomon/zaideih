#!/usr/bin/env node
/**
 * Songbook pages from a text file, split into hymns at their numbers
 * (src/core/songbook-import.js, docs/songbooks.md), and added to a songbook
 * on the audio Worker: each hymn's number and title, and its words as lyrics.
 *
 *   node tools/songbook.mjs split <file> [--from 145]
 *       the hymns found, and what to check; reads nothing else
 *   node tools/songbook.mjs import <file> --book <id> [--from 145] [--apply]
 *       what would be added to the book (numbers already there are left as
 *       they are); with --apply, adds them, stopping at the first failure
 *
 * import reads the book, and with --apply writes it, as a person with the
 * Songbooks right: ZAIDEIH_SESSION is the session token of a device signed
 * in to Zaideih (its localStorage "zaideih.account", `token`). The Worker is
 * https://media.zaideih.com unless --url says otherwise.
 *
 * Exit status: 0 done (or nothing to do), 2 a request that cannot be done,
 * 1 a failure on the way (what was added before it stays).
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { splitHymns } from "../src/core/songbook-import.js";

function fail(message, code = 2) {
	console.error(`error: ${message}`);
	process.exit(code);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		book: { type: "string" },
		from: { type: "string" },
		url: { type: "string", default: "https://media.zaideih.com" },
		apply: { type: "boolean", default: false },
	},
	strict: true,
});
const [command, file] = positionals;
if (!["split", "import"].includes(command) || !file || positionals.length > 2) fail("use: songbook.mjs split <file> [--from N] | import <file> --book <id> [--from N] [--apply]");
const from = values.from === undefined ? null : Number(values.from);
if (from !== null && !Number.isSafeInteger(from)) fail("--from must be a song number");

let text;
try {
	text = await readFile(file, "utf8");
} catch (err) {
	fail(`${file} cannot be read: ${err.message}`);
}
let split;
try {
	split = splitHymns(text, { from });
} catch (err) {
	fail(err.message);
}
const { entries, notes } = split;
for (const n of notes) console.log(`check      ${n}`);
if (!entries.length) fail("no song number found: each song starts at its number, with its title under it or beside it in capitals");

if (command === "split") {
	for (const e of entries) console.log(`${String(e.number).padStart(5)}  ${e.title}  (${((n) => `${n} line${n === 1 ? "" : "s"}`)(e.text.split("\n").filter((l) => l.trim()).length)})`);
	console.log(`${entries.length} song${entries.length === 1 ? "" : "s"}`);
	process.exit(0);
}

const bookId = Number(values.book);
if (!Number.isSafeInteger(bookId) || bookId <= 0) fail("--book must be the songbook's id (from GET /songbooks)");
const session = process.env.ZAIDEIH_SESSION ?? "";
if (!session) fail("ZAIDEIH_SESSION is not set: the session token of a device signed in with the Songbooks right");
const base = values.url.replace(/\/+$/, "");
const headers = { Authorization: `Bearer ${session}`, Origin: "https://zaideih.com", "Content-Type": "application/json" };

async function call(method, path, body) {
	const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	const answer = await res.json().catch(() => null);
	if (!res.ok) throw new Error(answer?.error ?? `HTTP ${res.status}`);
	return answer;
}

let book;
try {
	book = await call("GET", `/songbooks/${bookId}`);
} catch (err) {
	fail(`songbook ${bookId} cannot be read: ${err.message}`);
}
const have = new Set(book.entries.map((e) => e.number));
const adding = entries.filter((e) => !have.has(e.number));
for (const e of entries) console.log(`${have.has(e.number) ? "keep " : "add  "} ${book.short} ${String(e.number).padStart(5)}  ${e.title}`);
console.log(`${adding.length} to add to ${book.title}, ${entries.length - adding.length} already there`);
if (!values.apply) {
	console.log("dry run: nothing was changed (add --apply to add them)");
	process.exit(0);
}

let done = 0;
for (const e of adding) {
	let entry = null;
	try {
		entry = await call("POST", `/songbooks/${bookId}/entries`, { number: e.number, title: e.title, firstLine: e.firstLine });
		if (e.text.trim()) await call("POST", `/lyrics/${entry.text}`, { text: e.text, base: 0 });
	} catch (err) {
		fail(`${book.short} ${e.number}: ${err.message}${entry ? " (its number was added; its words were not)" : ""}. ${done} added before it.`, 1);
	}
	done += 1;
	console.log(`added      ${book.short} ${e.number} (text ${entry.text})`);
}
console.log(`${done} added to ${book.title}`);
