#!/usr/bin/env node
/**
 * Catalog compiler.
 *
 * Reads the curated source tables in assets/data and emits a compact,
 * content-hashed catalog shared by every platform build:
 *
 *   build/catalog/meta.json             small pointer file, always revalidated
 *   build/catalog/catalog.<hash>.json   immutable catalog payload
 *
 * The build also requires assets/data/media.json to give every track an
 * audio path, so a catalog never lists a track the audio Worker cannot serve.
 *
 * Every reference is validated before anything is written. Any inconsistency
 * aborts the run with a non-zero exit code; nothing is silently dropped.
 *
 * Usage:
 *   node tools/catalog.mjs            dry run: validate and report only
 *   node tools/catalog.mjs --apply    validate, then write output files
 *
 * Options:
 *   --src <dir>   source directory (default: assets/data)
 *   --out <dir>   output directory (default: build/catalog)
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkCoverage, validateMedia } from "./lib/media.mjs";

export const CATALOG_FORMAT = 1;

class CatalogError extends Error {}

function fail(errors) {
	const shown = errors.slice(0, 50);
	const more = errors.length > shown.length ? `\n  ... and ${errors.length - shown.length} more` : "";
	throw new CatalogError(`catalog validation failed with ${errors.length} error(s):\n  ${shown.join("\n  ")}${more}`);
}

async function readJson(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (err) {
		throw new CatalogError(`cannot read ${path}: ${err.code ?? err.message}`);
	}
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new CatalogError(`invalid JSON in ${path}: ${err.message}`);
	}
}

/**
 * Canonical text: trimmed and NFC-normalized. Source tags contain Myanmar marks
 * in non-canonical order (e.g. U+103A before U+1037), which breaks word
 * segmentation, shaping and search. Every change is counted and reported.
 */
function canonicalText(value, counter) {
	const trimmed = String(value ?? "").trim();
	const nfc = trimmed.normalize("NFC");
	if (nfc !== trimmed) counter.n += 1;
	return nfc;
}

const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isText = (v) => typeof v === "string" && v.trim().length > 0;

/** Validates and indexes an id/name table from category.json. */
function indexTable(rows, label, errors) {
	const map = new Map();
	if (!Array.isArray(rows)) {
		errors.push(`category.${label}: expected an array`);
		return map;
	}
	for (const [n, row] of rows.entries()) {
		if (!isNonNegInt(row?.id)) errors.push(`category.${label}[${n}]: id must be a non-negative integer`);
		else if (!isText(row.name)) errors.push(`category.${label}[${n}] (id ${row.id}): name is empty`);
		else if (map.has(row.id)) errors.push(`category.${label}: duplicate id ${row.id}`);
		else map.set(row.id, row.name.trim());
	}
	return map;
}

/**
 * Pure transform from parsed source tables to the catalog object.
 * Throws CatalogError listing every problem found.
 */
export function compile({ albums, artists, category }) {
	const errors = [];

	const langs = indexTable(category?.lang, "lang", errors);
	const genres = indexTable(category?.genre, "genre", errors);
	const artistTypes = indexTable(category?.artist, "artist", errors);
	const albumTypes = indexTable(category?.album, "album", errors);

	const artistById = new Map();
	if (!Array.isArray(artists)) errors.push("artist.name.json: expected an array");
	else {
		for (const [n, a] of artists.entries()) {
			const where = `artist.name.json[${n}]`;
			if (!isNonNegInt(a?.id)) { errors.push(`${where}: id must be a non-negative integer`); continue; }
			if (artistById.has(a.id)) { errors.push(`${where}: duplicate artist id ${a.id}`); continue; }
			if (!isText(a.name)) errors.push(`${where} (id ${a.id}): name is empty`);
			if (!artistTypes.has(a.type)) errors.push(`${where} (id ${a.id}): unknown artist type ${a.type}`);
			if (a.thesaurus !== undefined && !Array.isArray(a.thesaurus)) errors.push(`${where} (id ${a.id}): thesaurus must be an array`);
			if (a.aka !== undefined && typeof a.aka !== "string") errors.push(`${where} (id ${a.id}): aka must be a string`);
			artistById.set(a.id, a);
		}
	}

	const outAlbums = [];
	const albumIds = new Set();
	const trackIds = new Set();
	const usedArtists = new Set();
	const normalized = { n: 0 };
	let trackCount = 0;
	let totalSeconds = 0;
	let hiddenCount = 0;

	if (!Array.isArray(albums)) errors.push("albums.json: expected an array");
	else {
		for (const [n, al] of albums.entries()) {
			const where = `albums.json[${n}]${al?.ui ? ` (${al.ui})` : ""}`;
			if (!isText(al?.ui)) { errors.push(`${where}: ui is empty`); continue; }
			if (albumIds.has(al.ui)) errors.push(`${where}: duplicate album ui`);
			albumIds.add(al.ui);
			if (!isText(al.ab)) errors.push(`${where}: album title (ab) is empty`);
			if (!langs.has(al.lg)) errors.push(`${where}: unknown language id ${al.lg}`);
			if (!Array.isArray(al.gr)) errors.push(`${where}: gr must be an array`);
			else for (const g of al.gr) if (!genres.has(g)) errors.push(`${where}: unknown genre id ${g}`);
			if (!Array.isArray(al.yr) || al.yr.length > 1) errors.push(`${where}: yr must be an array with at most one year`);
			else if (al.yr.length === 1 && !isNonNegInt(al.yr[0])) errors.push(`${where}: year must be a non-negative integer`);
			if (!Array.isArray(al.tk) || al.tk.length === 0) { errors.push(`${where}: album has no tracks`); continue; }

			const tracks = [];
			for (const [k, t] of al.tk.entries()) {
				const tw = `${where} track ${k + 1}`;
				if (!isNonNegInt(t?.i) || t.i === 0) { errors.push(`${tw}: track id (i) must be a positive integer`); continue; }
				if (trackIds.has(t.i)) errors.push(`${tw}: duplicate track id ${t.i}`);
				trackIds.add(t.i);
				if (!isText(t.t)) errors.push(`${tw} (id ${t.i}): title is empty`);
				if (!isNonNegInt(t.d)) errors.push(`${tw} (id ${t.i}): duration (d) must be a non-negative integer`);
				if (!isNonNegInt(t.p)) errors.push(`${tw} (id ${t.i}): plays (p) must be a non-negative integer`);
				if (t.h !== undefined && typeof t.h !== "boolean") errors.push(`${tw} (id ${t.i}): hidden (h) must be true or false`);
				// An empty artist list is legitimate source data (credited as unknown in the UI).
				if (!Array.isArray(t.a)) errors.push(`${tw} (id ${t.i}): artists (a) must be an array`);
				else for (const a of t.a) {
					if (!artistById.has(a)) errors.push(`${tw} (id ${t.i}): unknown artist id ${a}`);
					if (t.h !== true) usedArtists.add(a);
				}
				// Hidden tracks (h: true, set on the admin page) stay in the source, keeping
				// their id, but are not shipped: likes and playlists simply no longer list them.
				if (t.h === true) { hiddenCount += 1; continue; }
				tracks.push([t.i, canonicalText(t.t, normalized), t.a, t.d, t.p]);
				trackCount += 1;
				totalSeconds += isNonNegInt(t.d) ? t.d : 0;
			}
			// An album whose every track is hidden is left out as a whole.
			if (tracks.length) outAlbums.push([al.ui, canonicalText(al.ab, normalized), al.lg, al.gr, al.yr?.[0] ?? 0, tracks]);
		}
	}

	if (errors.length) fail(errors);

	// Only artists referenced by at least one track are shipped.
	const outArtists = [...artistById.values()]
		.filter((a) => usedArtists.has(a.id))
		.sort((x, y) => x.id - y.id)
		.map((a) => {
			const aka = typeof a.aka === "string" ? canonicalText(a.aka, normalized) : "";
			const thesaurus = [...new Set((a.thesaurus ?? []).map((s) => canonicalText(s, normalized)).filter(Boolean))];
			return [a.id, canonicalText(a.name, normalized), aka, a.type, thesaurus];
		});

	const usedLangs = new Set(outAlbums.map((a) => a[2]));
	const usedGenres = new Set(outAlbums.flatMap((a) => a[3]));

	const catalog = {
		format: CATALOG_FORMAT,
		lang: [...langs].filter(([id]) => usedLangs.has(id)),
		genre: [...genres].filter(([id]) => usedGenres.has(id)).sort((x, y) => x[1].localeCompare(y[1])),
		artistType: [...artistTypes],
		albumType: [...albumTypes],
		artists: outArtists,
		albums: outAlbums,
	};

	return {
		catalog,
		stats: {
			albums: outAlbums.length,
			tracks: trackCount,
			artists: outArtists.length,
			artistsUnused: artistById.size - outArtists.length,
			languages: catalog.lang.length,
			genres: catalog.genre.length,
			hours: Math.round(totalSeconds / 3600),
			normalized: normalized.n,
			hidden: hiddenCount,
		},
	};
}

async function main() {
	const { values } = parseArgs({
		options: {
			apply: { type: "boolean", default: false },
			src: { type: "string", default: "assets/data" },
			out: { type: "string", default: "build/catalog" },
		},
		strict: true,
	});
	const src = resolve(values.src);
	const out = resolve(values.out);

	const [albums, artists, category, media] = await Promise.all([
		readJson(join(src, "albums.json")),
		readJson(join(src, "artist.name.json")),
		readJson(join(src, "category.json")),
		readJson(join(src, "media.json")),
	]);

	const { catalog, stats } = compile({ albums, artists, category });
	// Every listed track must be playable: refuse to build when an audio path is missing.
	const mediaErrors = [...validateMedia(media), ...checkCoverage(albums, media)];
	if (mediaErrors.length) fail(mediaErrors.map((e) => `media: ${e}`));
	const body = JSON.stringify(catalog);
	const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
	const file = `catalog.${hash}.json`;
	const meta = {
		format: CATALOG_FORMAT,
		version: hash,
		catalog: file,
		bytes: Buffer.byteLength(body),
		counts: { albums: stats.albums, tracks: stats.tracks, artists: stats.artists },
	};

	console.log(`source     ${src}`);
	console.log(`albums     ${stats.albums}`);
	console.log(`tracks     ${stats.tracks} (${stats.hours} hours)${stats.hidden ? `, ${stats.hidden} hidden and not shipped` : ""}`);
	console.log(`artists    ${stats.artists} referenced, ${stats.artistsUnused} unreferenced and omitted`);
	console.log(`languages  ${stats.languages}`);
	console.log(`genres     ${stats.genres}`);
	console.log(`media      every track has an audio path (media.json)`);
	console.log(`unicode    ${stats.normalized} string(s) normalized to NFC (source files unchanged)`);
	console.log(`output     ${join(out, file)} (${(meta.bytes / 1024 / 1024).toFixed(2)} MiB)`);

	if (!values.apply) {
		console.log("\ndry run: nothing written. Re-run with --apply to write the catalog.");
		return;
	}

	await mkdir(out, { recursive: true });
	const stale = (await readdir(out)).filter((f) => /^catalog\.[0-9a-f]+\.json$/.test(f) && f !== file);
	await writeFile(join(out, file), body);
	await writeFile(join(out, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
	for (const f of stale) await rm(join(out, f));
	console.log(`\nwrote ${file} and meta.json${stale.length ? `, removed ${stale.length} stale catalog file(s)` : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(`error: ${err.message}`);
		process.exit(err instanceof CatalogError ? 2 : 1);
	});
}
