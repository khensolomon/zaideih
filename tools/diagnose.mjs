#!/usr/bin/env node
/**
 * Playback diagnostics for the admin.
 *
 * Commands:
 *   <code>          Decode a diagnostic code from a playback error in the app
 *                   ("ZE-…"), then show the track as `track` does.
 *   track <id>      Show where a track's audio lives: catalog entry, media.json
 *                   path, the R2 key with its code points, and the D1 and R2
 *                   commands that check it byte for byte.
 *
 * Read-only. Nothing is written anywhere.
 *
 * Options:
 *   --probe           also request the audio from this machine, the way the app
 *                     does (ranged, with an Origin header), and report the answer
 *   --url <template>  audio URL template (default: https://media.zaideih.com/audio/{id})
 *   --origin <url>    Origin header for --probe (default: https://zaideih.com)
 *   --data <dir>      source data directory (default: assets/data)
 *
 * Examples:
 *   node tools/diagnose.mjs ZE-0C3R-0000-...
 *   node tools/diagnose.mjs track 22503 --probe
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { decodeCode, explain, sniff } from "../src/core/diagnostic.js";
import { validateMedia } from "./lib/media.mjs";

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(2);
}

async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (err) {
		fail(`cannot read ${path}: ${err.code ?? err.message}`);
	}
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		probe: { type: "boolean", default: false },
		url: { type: "string", default: "https://media.zaideih.com/audio/{id}" },
		origin: { type: "string", default: "https://zaideih.com" },
		data: { type: "string", default: "assets/data" },
	},
	strict: true,
});

const line = (label, value) => console.log(`  ${label.padEnd(16)} ${value}`);
const heading = (text) => console.log(`\n${text}`);

/** Non-ASCII characters as \u{…}, so two look-alike strings can be told apart. */
const escaped = (s) => [...s].map((ch) => (ch.codePointAt(0) < 128 ? ch : `\\u{${ch.codePointAt(0).toString(16).toUpperCase()}}`)).join("");
const utf8Hex = (s) => Buffer.from(s, "utf8").toString("hex").toUpperCase();

/**
 * Myanmar text can hold the same marks in two orders (U+1037 dot below and
 * U+103A asat). Both render alike; only one matches a stored key. Returns the
 * other order, or null when the text has no such pair.
 */
function otherMarkOrder(s) {
	const swapped = s.replace(/့်|့်/g, (m) => m[1] + m[0]);
	return swapped === s ? null : swapped;
}

async function showTrack(id, data) {
	const albums = await readJson(join(data, "albums.json"));
	const artists = await readJson(join(data, "artist.name.json"));
	const media = await readJson(join(data, "media.json"));
	const problems = validateMedia(media);
	if (problems.length) fail(`media.json is invalid: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`);

	let album = null;
	let track = null;
	for (const al of albums) {
		const t = al.tk.find((x) => x.i === id);
		if (t) { album = al; track = t; break; }
	}
	if (!track) fail(`track ${id} is not in ${join(data, "albums.json")}`);
	const names = new Map(artists.map((a) => [a.id, a.name]));
	heading(`Track ${id}`);
	line("title", track.t);
	line("artists", track.a.map((a) => names.get(a) ?? `#${a}`).join(", ") || "Unknown");
	line("album", `${album.ab} (${album.ui}), position ${album.tk.indexOf(track) + 1} of ${album.tk.length}`);
	line("duration", `${Math.floor(track.d / 60)}:${String(track.d % 60).padStart(2, "0")}`);
	line("plays", track.p.toLocaleString());

	const entry = media.albums.find(([ui]) => ui === album.ui);
	const file = entry?.[2].find(([tid]) => tid === id)?.[1];
	if (!entry || !file) {
		heading("media.json");
		line("path", "MISSING: the build would fail, and D1 has no source for this track");
		return;
	}
	// The Worker reads `${root}/${folder_path}/${mp3}`, with root "music".
	const key = `${media.root}/${entry[1]}/${file}`;
	heading("Storage");
	line("R2 key", key);
	if (/[^\x20-\x7e]/.test(key)) line("code points", escaped(key));
	line("NFC", key === key.normalize("NFC") ? "yes" : "no (the catalog is NFC; this key is not)");
	const other = otherMarkOrder(key);
	if (other) {
		line("look-alike", escaped(other));
		console.log("                   The same text with U+1037/U+103A in the other order. If R2 holds");
		console.log("                   this form instead, the key above is not found although both look alike.");
	}
	heading("Check D1 (folder_path as UTF-8 hex)");
	console.log(`  npx wrangler d1 execute audio --remote --config worker/media/wrangler.toml \\
    --command "SELECT id, folder_path, mp3, hex(folder_path) AS hex FROM tracks WHERE id = ${id}"`);
	line("expected hex", utf8Hex(entry[1]));
	if (other) line("look-alike hex", utf8Hex(otherMarkOrder(entry[1]) ?? entry[1]));
	heading("Check R2 (downloads the object; then play it locally)");
	console.log(`  npx wrangler r2 object get "media/${key}" --remote --file track-${id}${file.slice(file.lastIndexOf("."))}`);

	if (values.probe) await probe(id);
}

async function probe(id) {
	const url = values.url.replace("{id}", String(id));
	heading(`Probe ${url}`);
	let res;
	try {
		res = await fetch(url, { headers: { Range: "bytes=0-15", Origin: values.origin, "Sec-Fetch-Dest": "empty" }, cache: "no-store" });
	} catch (err) {
		line("answer", `none (${err.cause?.code ?? err.message})`);
		return;
	}
	line("status", String(res.status));
	for (const h of ["content-type", "content-range", "content-length", "access-control-allow-origin", "x-zaideih-meta", "x-zaideih-reason"]) {
		line(h, res.headers.get(h) ?? "(none)");
	}
	if (res.ok) line("file starts as", sniff(new Uint8Array(await res.arrayBuffer()).slice(0, 16)));
	else line("body", (await res.text()).slice(0, 80));
}

const [first, second] = positionals;
if (!first) fail("give a diagnostic code, or: track <id>");

if (first === "track") {
	const id = Number(second);
	if (!Number.isSafeInteger(id) || id <= 0) fail(`track needs a numeric id, got "${second ?? ""}"`);
	await showTrack(id, values.data);
} else {
	let d;
	try {
		d = decodeCode(positionals.join(""));
	} catch (err) {
		fail(err.message);
	}
	heading(`Code ${positionals.join("")}`);
	line("failed", d.kind);
	line("played from", d.download ? "downloaded copy" : "stream");
	line("server", d.download ? "not asked" : !d.probed ? "not probed" : d.unreachable ? "no answer" : String(d.status));
	line("lookup", d.noTrack ? "no D1 row" : d.noObject ? "D1 row, no R2 object" : { memory: "Worker memory cache", edge: "Worker edge cache", d1: "D1", "not-reported": "not reported (Worker without diagnostic headers)" }[d.lookup]);
	line("file starts as", d.signature);
	line("file size", d.sizeKiB ? `${d.sizeKiB.toLocaleString()} KiB` : "unknown");
	line("app", `${d.version || "unknown"} ${d.desktop ? "desktop" : "web"}${d.online ? "" : " (offline)"}`);
	line("when", `${d.at.toISOString().slice(0, 16).replace("T", " ")} UTC`);
	const { cause, steps } = explain(d);
	heading("Likely cause");
	console.log(`  ${cause}`);
	for (const s of steps) console.log(`  - ${s}`);
	await showTrack(d.trackId, values.data);
}
