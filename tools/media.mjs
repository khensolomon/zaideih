#!/usr/bin/env node
/**
 * Media path tool.
 *
 * Commands:
 *   import <dump.sql[.gz]>   Build assets/data/media.json from a Django mysqldump
 *                            (album and track tables only; nothing else is read).
 *   check                    Validate media.json and its coverage of albums.json.
 *   d1                       Write D1 SQL that loads every track path into the
 *                            audio Worker's `tracks` table.
 *
 * Every command is a dry run unless --apply is given.
 *
 * Options:
 *   --data <dir>    source data directory (default: assets/data)
 *   --out <file>    d1: SQL output path (default: build/d1/tracks.sql)
 *   --prune         d1: also delete D1 rows for tracks not in media.json
 *
 * Example:
 *   node tools/media.mjs import ~/backup/20260618_082001.sql.gz --apply
 *   node tools/media.mjs d1 --apply
 *   npx wrangler d1 execute audio --remote --file build/d1/tracks.sql --config worker/media/wrangler.toml
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { MediaError, checkCoverage, d1Sql, mediaFromDump, stringifyMedia, validateMedia } from "./lib/media.mjs";

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(2);
}

function report(label, errors) {
	if (!errors.length) return;
	const shown = errors.slice(0, 40).join("\n  ");
	fail(`${label}: ${errors.length} problem(s)\n  ${shown}${errors.length > 40 ? `\n  ... and ${errors.length - 40} more` : ""}`);
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
		apply: { type: "boolean", default: false },
		data: { type: "string", default: "assets/data" },
		out: { type: "string", default: "build/d1/tracks.sql" },
		prune: { type: "boolean", default: false },
	},
	strict: true,
});

const [command, arg] = positionals;
const dataDir = resolve(values.data);
const mediaPath = join(dataDir, "media.json");

try {
	if (command === "import") {
		if (!arg) fail("import needs a dump file: node tools/media.mjs import <dump.sql[.gz]>");
		const raw = await readFile(resolve(arg)).catch((err) => fail(`cannot read ${arg}: ${err.code}`));
		const sql = (arg.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
		const { media, empty } = mediaFromDump(sql);
		report("media.json", validateMedia(media));
		const albums = await readJson(join(dataDir, "albums.json"));
		report("coverage", checkCoverage(albums, media));
		const tracks = media.albums.reduce((n, a) => n + a[2].length, 0);
		console.log(`albums     ${media.albums.length} with tracks`);
		console.log(`tracks     ${tracks}, all matched to albums.json`);
		if (empty.length) {
			console.log(`skipped    ${empty.length} album row(s) with no tracks:`);
			for (const e of empty) console.log(`             ${e.uid}  ${e.folder}`);
		}
		if (!values.apply) {
			console.log(`\ndry run: ${mediaPath} not written. Re-run with --apply to write it.`);
		} else {
			await writeFile(mediaPath, stringifyMedia(media));
			console.log(`\nwrote ${mediaPath}`);
		}
	} else if (command === "check") {
		const media = await readJson(mediaPath);
		report("media.json", validateMedia(media));
		report("coverage", checkCoverage(await readJson(join(dataDir, "albums.json")), media));
		console.log(`media.json ok: ${media.albums.length} albums, every catalog track has an audio path`);
	} else if (command === "d1") {
		const media = await readJson(mediaPath);
		report("media.json", validateMedia(media));
		const { sql, count } = d1Sql(media, { prune: values.prune });
		const out = resolve(values.out);
		console.log(`tracks     ${count}${values.prune ? ", plus prune of rows not in media.json" : ""}`);
		console.log(`output     ${out} (${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(2)} MiB)`);
		if (!values.apply) {
			console.log("\ndry run: nothing written. Re-run with --apply to write the SQL file.");
		} else {
			await mkdir(dirname(out), { recursive: true });
			await writeFile(out, sql);
			console.log(`\nwrote ${out}\nload it with:\n  npx wrangler d1 execute audio --remote --file ${values.out} --config worker/media/wrangler.toml`);
		}
	} else {
		fail(`unknown command ${JSON.stringify(command ?? "")}; expected import, check or d1`);
	}
} catch (err) {
	if (err instanceof MediaError) fail(err.message);
	throw err;
}
