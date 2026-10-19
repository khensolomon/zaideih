/**
 * Media path table: maps every catalog track id to its audio object.
 *
 * File format (assets/data/media.json):
 *   {
 *     "format": 1,
 *     "root": "music",
 *     "albums": [[albumUid, folderPath, [[trackId, fileName], ...]], ...]
 *   }
 *
 * The object key of a track is `${root}/${folderPath}/${fileName}`, which is
 * what worker/media looks up in R2 for GET /audio/:id.
 */
export const MEDIA_FORMAT = 1;

export class MediaError extends Error {}

const AUDIO_EXT = /\.mp3$/i;

function badSegment(path) {
	return path.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Validates the structure of a parsed media.json. Returns a list of errors. */
export function validateMedia(media) {
	const errors = [];
	if (media?.format !== MEDIA_FORMAT) errors.push(`media.json: format must be ${MEDIA_FORMAT}`);
	if (typeof media?.root !== "string" || !media.root || badSegment(media.root)) errors.push("media.json: root must be a relative path");
	if (!Array.isArray(media?.albums)) {
		errors.push("media.json: albums must be an array");
		return errors;
	}
	const uids = new Set();
	const ids = new Set();
	for (const [n, row] of media.albums.entries()) {
		const [uid, folder, tracks] = Array.isArray(row) ? row : [];
		const where = `media.json albums[${n}]${uid ? ` (${uid})` : ""}`;
		if (typeof uid !== "string" || !uid) { errors.push(`${where}: album uid is empty`); continue; }
		if (uids.has(uid)) errors.push(`${where}: duplicate album uid`);
		uids.add(uid);
		if (typeof folder !== "string" || !folder || badSegment(folder) || folder.includes("\\")) {
			errors.push(`${where}: folder path is empty or unsafe: ${JSON.stringify(folder)}`);
		}
		if (!Array.isArray(tracks) || !tracks.length) { errors.push(`${where}: no tracks`); continue; }
		for (const [k, t] of tracks.entries()) {
			const [id, file] = Array.isArray(t) ? t : [];
			const tw = `${where} track ${k + 1}`;
			if (!Number.isInteger(id) || id <= 0) { errors.push(`${tw}: id must be a positive integer`); continue; }
			if (ids.has(id)) errors.push(`${tw}: duplicate track id ${id}`);
			ids.add(id);
			if (typeof file !== "string" || !file || file.includes("/") || file.includes("\\") || file === "." || file === "..") {
				errors.push(`${tw} (id ${id}): file name is empty or unsafe: ${JSON.stringify(file)}`);
			} else if (!AUDIO_EXT.test(file)) {
				errors.push(`${tw} (id ${id}): file is not an .mp3: ${file}`);
			}
		}
	}
	return errors;
}

/**
 * Cross-checks the catalog (albums.json) against media.json: every catalog
 * track must have exactly one path, under the same album, and media.json must
 * not list tracks the catalog does not know.
 */
export function checkCoverage(albums, media) {
	const errors = [];
	const where = new Map();
	for (const [uid, , tracks] of media.albums) for (const [id] of tracks) where.set(id, uid);
	const seen = new Set();
	for (const al of albums) {
		for (const t of al.tk) {
			seen.add(t.i);
			const uid = where.get(t.i);
			if (uid === undefined) errors.push(`track ${t.i} ("${t.t}") in album ${al.ui} has no audio path in media.json`);
			else if (uid !== al.ui) errors.push(`track ${t.i} is in album ${al.ui} in albums.json but under ${uid} in media.json`);
		}
	}
	for (const id of where.keys()) {
		if (!seen.has(id)) errors.push(`media.json lists track ${id}, which is not in albums.json`);
	}
	return errors;
}

/** Serializes media.json with one album per line, so diffs stay readable. */
export function stringifyMedia(media) {
	const lines = media.albums.map((row) => JSON.stringify(row));
	return `{"format":${media.format},"root":${JSON.stringify(media.root)},"albums":[\n${lines.join(",\n")}\n]}\n`;
}

/* ------------------------------------------------------------------ MySQL dump */

const ESCAPES = { 0: "\0", n: "\n", r: "\r", t: "\t", Z: "\x1a", b: "\b" };

/** Parses the VALUES tuples of every `INSERT INTO \`table\`` statement in a mysqldump. */
export function parseInserts(sql, table) {
	const prefix = `INSERT INTO \`${table}\` VALUES `;
	const rows = [];
	let from = 0;
	for (;;) {
		const at = sql.indexOf(prefix, from);
		if (at < 0) break;
		let i = at + prefix.length;
		for (;;) {
			if (sql[i] !== "(") throw new MediaError(`unexpected character ${JSON.stringify(sql[i])} in ${table} INSERT at offset ${i}`);
			i += 1;
			const row = [];
			for (;;) {
				if (sql[i] === "'") {
					i += 1;
					let buf = "";
					for (;;) {
						const c = sql[i];
						if (c === undefined) throw new MediaError(`unterminated string in ${table} INSERT`);
						if (c === "\\") { buf += ESCAPES[sql[i + 1]] ?? sql[i + 1]; i += 2; }
						else if (c === "'" && sql[i + 1] === "'") { buf += "'"; i += 2; }
						else if (c === "'") { i += 1; break; }
						else { buf += c; i += 1; }
					}
					row.push(buf);
				} else {
					let j = i;
					while (sql[j] !== "," && sql[j] !== ")") j += 1;
					const tok = sql.slice(i, j);
					row.push(tok === "NULL" ? null : /^-?\d+$/.test(tok) ? Number(tok) : tok);
					i = j;
				}
				if (sql[i] === ",") { i += 1; continue; }
				if (sql[i] === ")") { i += 1; break; }
				throw new MediaError(`malformed ${table} row at offset ${i}`);
			}
			rows.push(row);
			if (sql[i] === ",") { i += 1; continue; }
			if (sql[i] === ";") { from = i; break; }
			throw new MediaError(`malformed ${table} INSERT terminator at offset ${i}`);
		}
	}
	return rows;
}

/**
 * Builds media.json content from the Django `album` (id, uid, folder_path)
 * and `track` (id, plays, mp3, album_id, lang) tables.
 */
export function mediaFromDump(sql) {
	const albumRows = parseInserts(sql, "album");
	const trackRows = parseInserts(sql, "track");
	if (!albumRows.length || !trackRows.length) {
		throw new MediaError(`dump has ${albumRows.length} album and ${trackRows.length} track rows; both tables are required`);
	}
	const byId = new Map();
	for (const [id, uid, folder] of albumRows) byId.set(id, { uid, folder, tracks: [] });
	const errors = [];
	for (const [id, , mp3, albumId] of trackRows) {
		const al = byId.get(albumId);
		if (!al) { errors.push(`track ${id} references missing album id ${albumId}`); continue; }
		al.tracks.push([id, mp3]);
	}
	if (errors.length) throw new MediaError(errors.join("\n"));
	const empty = [];
	const albums = [];
	for (const al of byId.values()) {
		if (!al.tracks.length) { empty.push(al); continue; }
		al.tracks.sort((a, b) => a[0] - b[0]);
		albums.push([al.uid, al.folder, al.tracks]);
	}
	return { media: { format: MEDIA_FORMAT, root: "music", albums }, empty };
}

/* ------------------------------------------------------------------ D1 SQL */

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Generates idempotent D1 SQL that upserts every track path (and optionally prunes others). */
export function d1Sql(media, { prune = false, now = Math.floor(Date.now() / 1000), batch = 400 } = {}) {
	const rows = [];
	for (const [, folder, tracks] of media.albums) {
		for (const [id, file] of tracks) rows.push(`(${id}, ${sqlText(folder)}, ${sqlText(file)}, ${now})`);
	}
	const out = [
		"-- Generated by tools/media.mjs from assets/data/media.json. Do not edit.",
		`-- ${rows.length} tracks.`,
	];
	for (let i = 0; i < rows.length; i += batch) {
		out.push(
			`INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES\n${rows.slice(i, i + batch).join(",\n")}\n` +
			"ON CONFLICT(id) DO UPDATE SET folder_path = excluded.folder_path, mp3 = excluded.mp3, updated_at = excluded.updated_at\n" +
			"WHERE tracks.folder_path IS NOT excluded.folder_path OR tracks.mp3 IS NOT excluded.mp3;",
		);
	}
	if (prune) {
		// Rows written by this run carry updated_at = now only when changed, so pruning
		// uses an explicit keep-list instead of timestamps.
		const ids = media.albums.flatMap(([, , tracks]) => tracks.map(([id]) => id));
		out.push("CREATE TABLE IF NOT EXISTS _keep_tracks (id INTEGER PRIMARY KEY);", "DELETE FROM _keep_tracks;");
		for (let i = 0; i < ids.length; i += 2000) {
			out.push(`INSERT INTO _keep_tracks (id) VALUES ${ids.slice(i, i + 2000).map((id) => `(${id})`).join(",")};`);
		}
		out.push("DELETE FROM tracks WHERE id NOT IN (SELECT id FROM _keep_tracks);", "DROP TABLE _keep_tracks;");
	}
	return { sql: `${out.join("\n")}\n`, count: rows.length };
}
