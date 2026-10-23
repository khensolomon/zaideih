#!/usr/bin/env node
/**
 * The audio Worker's D1 database ("audio"): schema, track paths and reset.
 * The schema lives in one file, worker/media/schema.sql (no migrations).
 *
 * Commands:
 *   status   Tables and their row counts. Reads only.
 *   schema   Create what the schema has and the database lacks. Keeps all
 *            data. Run by every `release: audio`.
 *   tracks   Load every track path from assets/data/media.json (upserts).
 *            --prune also deletes rows for tracks not in media.json.
 *   reset    Drop every table (Cloudflare's own _cf_* tables excepted),
 *            create the schema and load the track paths, in one D1 import
 *            that either completes or leaves the database as it was. When
 *            the plays table holds counts, choose --keep-plays (they are
 *            read first and put back) or --drop-plays (they are lost).
 *            Refuses while personal libraries (members, uploads, member_rights,
 *            member_folders) hold rows,
 *            unless --drop-library: they cannot be rebuilt from git.
 *
 * Every command except status is a dry run unless --apply is given.
 *
 * Options:
 *   --local        the local development database (wrangler dev) instead of Cloudflare's
 *   --data <dir>   source data directory (default: assets/data)
 *
 * Wrangler: worker/media's own (npm --prefix worker/media install), or, when
 * that is not installed, `npx --yes $WRANGLER` (the release workflow sets
 * WRANGLER to a pinned version).
 *
 * Examples:
 *   node tools/d1.mjs status
 *   node tools/d1.mjs reset --keep-plays --apply
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { D1Error, LIBRARY_TABLES, isSystemTable, libraryGuard, resetSql, schemaSql, schemaTables, wranglerRows } from "./lib/d1.mjs";
import { MediaError, d1Sql, validateMedia } from "./lib/media.mjs";

const DATABASE = "audio";
const CONFIG = "worker/media/wrangler.toml";
const SCHEMA = "worker/media/schema.sql";
const BUILD = "build/d1";

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(2);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		apply: { type: "boolean", default: false },
		local: { type: "boolean", default: false },
		data: { type: "string", default: "assets/data" },
		prune: { type: "boolean", default: false },
		"keep-plays": { type: "boolean", default: false },
		"drop-plays": { type: "boolean", default: false },
		"drop-library": { type: "boolean", default: false },
	},
	strict: true,
});
const [command] = positionals;
const where = values.local ? "--local" : "--remote";
const place = values.local ? "the local database" : `Cloudflare's "${DATABASE}" database`;

function wranglerCommand() {
	const own = resolve("worker/media/node_modules/.bin/wrangler");
	if (existsSync(own)) return [own];
	if (process.env.WRANGLER) return ["npx", "--yes", process.env.WRANGLER];
	fail("wrangler is not installed. Run: npm --prefix worker/media install (or set WRANGLER, e.g. WRANGLER=wrangler@4.151.2)");
}

/** Runs wrangler d1 execute; returns stdout. Stops with wrangler's own message on failure. */
function wrangler(args, { json = false } = {}) {
	const [bin, ...pre] = wranglerCommand();
	const all = [...pre, "d1", "execute", DATABASE, where, "--config", CONFIG, ...(json ? ["--json"] : []), ...args];
	const r = spawnSync(bin, all, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
	if (r.error) fail(`could not run wrangler: ${r.error.message}`);
	if (r.status !== 0) fail(`wrangler failed (exit ${r.status}):\n${(r.stderr || r.stdout).trim().slice(-2000)}`);
	return r.stdout;
}
const query = (sql) => wranglerRows(wrangler(["--command", sql], { json: true }));

function tables() {
	return query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
}
function count(table) {
	return query(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`)[0]?.n ?? 0;
}

async function tracksSql() {
	const mediaPath = join(values.data, "media.json");
	let media;
	try {
		media = JSON.parse(await readFile(mediaPath, "utf8"));
	} catch (err) {
		fail(`cannot read ${mediaPath}: ${err.code ?? err.message}`);
	}
	const errors = validateMedia(media);
	if (errors.length) fail(`${mediaPath}: ${errors.length} problem(s)\n  ${errors.slice(0, 20).join("\n  ")}`);
	return d1Sql(media, { prune: values.prune });
}

async function writeBuild(name, sql) {
	await mkdir(BUILD, { recursive: true });
	const path = join(BUILD, name);
	await writeFile(path, sql);
	return path;
}

const dryRun = (what) => console.log(`\ndry run: nothing changed. Re-run with --apply to ${what}.`);

try {
	const schemaText = await readFile(SCHEMA, "utf8");
	const wanted = schemaTables(schemaText);

	if (command === "status") {
		const list = tables();
		console.log(`${place}:`);
		// Cloudflare's own tables cannot be read; they are listed without a count.
		for (const t of list) console.log(isSystemTable(t) ? `  ${t.padEnd(22)} ${"".padStart(8)}       (Cloudflare's own)` : `  ${t.padEnd(22)} ${String(count(t)).padStart(8)} rows${wanted.includes(t) ? "" : "  (not in the schema)"}`);
		const missing = wanted.filter((t) => !list.includes(t));
		if (missing.length) console.log(`missing from the schema: ${missing.join(", ")} (node tools/d1.mjs schema --apply)`);
	} else if (command === "schema") {
		const sql = schemaSql(schemaText);
		const missing = wanted.filter((t) => !tables().includes(t));
		console.log(`schema     ${SCHEMA}: ${wanted.join(", ")}`);
		console.log(`missing    ${missing.length ? missing.join(", ") : "no tables (missing indexes are created too)"}`);
		if (!values.apply) dryRun(`create what is missing in ${place}`);
		else {
			wrangler(["--yes", "--command", sql]);
			const still = wanted.filter((t) => !tables().includes(t));
			if (still.length) fail(`after applying the schema these tables are still missing: ${still.join(", ")}`);
			console.log(`\nschema applied to ${place}`);
		}
	} else if (command === "tracks") {
		const { sql, count: n } = await tracksSql();
		console.log(`tracks     ${n} from ${join(values.data, "media.json")}${values.prune ? ", and rows not in it deleted" : ""}`);
		if (!values.apply) dryRun(`load them into ${place}`);
		else {
			const file = await writeBuild("tracks.sql", sql);
			wrangler(["--yes", "--file", file]);
			const now = count("tracks");
			console.log(`\nloaded: ${place} has ${now} track paths`);
			if (now < n) fail(`expected at least ${n} track paths, found ${now}`);
		}
	} else if (command === "reset") {
		if (values["keep-plays"] && values["drop-plays"]) fail("choose one of --keep-plays and --drop-plays");
		const list = tables();
		const plays = list.includes("plays") ? count("plays") : 0;
		const held = Object.fromEntries(LIBRARY_TABLES.map((t) => [t, list.includes(t) ? count(t) : 0]));
		const guard = libraryGuard(held, values["drop-library"]);
		if (guard) fail(`reset refused: ${guard}`);
		if (plays > 0 && !values["keep-plays"] && !values["drop-plays"]) {
			fail(`the plays table holds ${plays} rows of play counts. Re-run with --keep-plays to put them back after the reset, or --drop-plays to lose them.`);
		}
		const { sql: tracks, count: n } = await tracksSql();
		console.log(`database   ${place}`);
		console.log(`drop       ${list.filter((t) => !isSystemTable(t)).map((t) => `${t}${wanted.includes(t) ? "" : " (not in the schema)"}`).join(", ") || "nothing"}`);
		console.log(`create     ${wanted.join(", ")} (${SCHEMA})`);
		console.log(`load       ${n} track paths`);
		if (plays > 0) console.log(`plays      ${plays} rows ${values["keep-plays"] ? "kept (read now, put back)" : "DROPPED"}`);
		if (!values.apply) dryRun("reset it");
		else {
			const saved = values["keep-plays"] && plays > 0 ? query("SELECT track_id, day, n FROM plays ORDER BY track_id, day") : null;
			if (saved && saved.length !== plays) fail(`read ${saved.length} plays rows, expected ${plays}; nothing was changed`);
			const file = await writeBuild("reset.sql", resetSql({ tables: list, schema: schemaText, tracks, plays: saved }));
			console.log(`\nwrote ${file}; running it as one import`);
			wrangler(["--yes", "--file", file]);
			const after = tables();
			const missing = wanted.filter((t) => !after.includes(t));
			if (missing.length) fail(`after the reset these tables are missing: ${missing.join(", ")}`);
			const loaded = count("tracks");
			if (loaded !== n) fail(`expected ${n} track paths after the reset, found ${loaded}`);
			const kept = after.includes("plays") ? count("plays") : 0;
			if (saved && kept !== saved.length) fail(`expected ${saved.length} plays rows after the reset, found ${kept}`);
			console.log(`reset done: ${after.filter((t) => !isSystemTable(t)).join(", ")}; ${loaded} track paths; ${kept} plays rows`);
		}
	} else {
		fail(`unknown command ${JSON.stringify(command ?? "")}; expected status, schema, tracks or reset`);
	}
} catch (err) {
	if (err instanceof D1Error || err instanceof MediaError) fail(err.message);
	throw err;
}
