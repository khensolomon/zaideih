#!/usr/bin/env node
/**
 * Albums published as copies under music/ before publishing in place
 * existed (docs/library.md, "Publishing in place"): pointed back at the
 * originals still in storage, then the copies deleted.
 *
 * The originals' place was not kept when such an album was released, so it
 * is named here (--folder): the folder in R2 that holds the same files,
 * with the same names as in media.json.
 *
 * Commands:
 *   point --album <id> --folder "<dir>"
 *            Changes the album's folder in assets/data/media.json to "/<dir>"
 *            and lists each song's key before and after. With --apply,
 *            writes media.json and keeps the plan in build/inplace/<id>.json.
 *            Then release the change (a web+d1 pull request), which loads
 *            the new keys into D1.
 *   prune --album <id>
 *            After that release: checks that D1 holds every song's new place,
 *            that it was loaded 25 hours ago or more (the audio Worker keeps
 *            a song's place for up to 24 hours, TRACK_META_TTL_SECONDS), and
 *            that every song plays from the Worker; then lists the copies
 *            under music/ to delete. With --apply, deletes them from R2
 *            (wrangler r2 object delete, --remote).
 *
 * Every command is a dry run unless --apply is given.
 *
 * Options:
 *   --audio <url>  the audio address template (default ZAIDEIH_AUDIO_URL or
 *                  https://media.zaideih.com/audio/{id})
 *
 * Example:
 *   node tools/inplace.mjs point --album 1884014c6ff5229e --folder "Khen/Miaow"
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { inPlace } from "../src/core/media-keys.js";
import { wranglerRows } from "./lib/d1.mjs";
import { wrangler as runWrangler, WranglerError } from "./lib/wrangler.mjs";
import { MediaError, pointInPlace, stringifyMedia, validateMedia } from "./lib/media.mjs";

const MEDIA = "assets/data/media.json";
const PLANS = "build/inplace";
const BUCKET = "media";
const CONFIG = "worker/media/wrangler.toml";
const DATABASE = "audio";
/** The Worker keeps a song's place this long (worker/media/script.js), with an hour to spare. */
const SETTLE_S = 25 * 3600;

function wrangler(args) {
	try {
		return runWrangler(args, { config: CONFIG, maxBuffer: 64 * 1024 * 1024 });
	} catch (err) {
		if (err instanceof WranglerError) fail(err.message);
		throw err;
	}
}

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(2);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		album: { type: "string" },
		folder: { type: "string" },
		audio: { type: "string", default: process.env.ZAIDEIH_AUDIO_URL || "https://media.zaideih.com/audio/{id}" },
		apply: { type: "boolean", default: false },
	},
	strict: true,
});
const [command] = positionals;
if (!["point", "prune"].includes(command) || positionals.length !== 1) fail("usage: node tools/inplace.mjs point --album <id> --folder <dir> [--apply] | prune --album <id> [--apply]");
if (!/^[0-9a-f]{16}$/.test(values.album ?? "")) fail("--album must be the album's id (16 hex characters)");

async function readMedia() {
	let media;
	try {
		media = JSON.parse(await readFile(MEDIA, "utf8"));
	} catch (err) {
		fail(`cannot read ${MEDIA}: ${err.code ?? err.message}`);
	}
	const errors = validateMedia(media);
	if (errors.length) fail(`${MEDIA} is invalid: ${errors[0]}`);
	return media;
}

const planPath = join(PLANS, `${values.album}.json`);

if (command === "point") {
	if (!values.folder) fail("--folder must name the folder in R2 that holds the album's original files");
	const media = await readMedia();
	let out;
	try {
		out = pointInPlace(media, values.album, values.folder);
	} catch (err) {
		if (err instanceof MediaError) fail(err.message);
		throw err;
	}
	console.log(`album ${values.album}: ${out.moves.length} songs`);
	for (const m of out.moves) console.log(`  ${m.id}  ${m.from}\n         → ${m.to}`);
	if (!values.apply) {
		console.log("\ndry run: nothing written. Check that R2 holds every key after the arrow (same names), then re-run with --apply.");
		process.exit(0);
	}
	await writeFile(MEDIA, stringifyMedia(out.media));
	await mkdir(PLANS, { recursive: true });
	await writeFile(planPath, `${JSON.stringify({ album: values.album, folder: values.folder, moves: out.moves }, null, "\t")}\n`);
	console.log(`\nwrote ${MEDIA} and ${planPath}. Release the change (web+d1), then: node tools/inplace.mjs prune --album ${values.album}`);
	process.exit(0);
}

// prune
let plan;
try {
	plan = JSON.parse(await readFile(planPath, "utf8"));
} catch (err) {
	fail(`no plan at ${planPath} (${err.code ?? err.message}): run point --apply first, on this computer`);
}
const media = await readMedia();
const row = media.albums.find(([uid]) => uid === values.album);
if (!row || !inPlace(row[1])) fail(`media.json does not have album ${values.album} in place yet: merge and release the point change first`);
// D1 must hold every song's new place, loaded long enough ago that no Worker still keeps the old one.
const ids = plan.moves.map((m) => m.id);
const rows = wranglerRows(wrangler(["d1", "execute", DATABASE, "--remote", "--json", "--command", `SELECT id, folder_path, updated_at FROM tracks WHERE id IN (${ids.join(",")})`]));
const byId = new Map(rows.map((r) => [r.id, r]));
const stale = ids.filter((id) => byId.get(id)?.folder_path !== row[1]);
if (stale.length) fail(`D1 does not have the new place for ${stale.length} song(s) (${stale.slice(0, 5).join(", ")}): release the point change first (it loads the track paths)`);
const loaded = Math.max(...rows.map((r) => r.updated_at));
const wait = loaded + SETTLE_S - Math.floor(Date.now() / 1000);
if (wait > 0) fail(`the new places were loaded ${new Date(loaded * 1000).toISOString()}; the audio Worker may keep the old ones for a day. Run prune again in ${Math.ceil(wait / 3600)} hour(s).`);
// Each song must play from the Worker, now reading its key in storage, before its copy goes.
const bad = [];
for (const m of plan.moves) {
	const url = values.audio.replace("{id}", String(m.id));
	try {
		const res = await fetch(url, { headers: { Range: "bytes=0-1" } });
		if (res.status !== 200 && res.status !== 206) bad.push(`${m.id}: HTTP ${res.status} from ${url}`);
	} catch (err) {
		bad.push(`${m.id}: ${url} could not be reached (${err.message})`);
	}
}
if (bad.length) fail(`not every song plays from its new place, so no copy is deleted:\n  ${bad.join("\n  ")}`);
const copies = plan.moves.map((m) => m.from).filter((k) => k.startsWith("music/"));
console.log(`every song of ${values.album} plays from storage; ${copies.length} copies under music/ to delete:`);
for (const k of copies) console.log(`  ${k}`);
if (!values.apply) {
	console.log("\ndry run: nothing deleted. Re-run with --apply.");
	process.exit(0);
}
for (const k of copies) {
	wrangler(["r2", "object", "delete", `${BUCKET}/${k}`, "--remote"]);
	console.log(`deleted ${k}`);
}
