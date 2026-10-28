/**
 * The audio studio (docs/audio-studio.md): a song's recording trimmed at its
 * start and end without a release. The original in R2 is never changed or
 * deleted; a cut is made from it (mp3.js, without decoding: nothing is lost)
 * and kept as a new object and a version. The version a song plays is its
 * current one; any version, the original (0) too, can be made current again.
 *
 *   GET  /edits                     public: { at, tracks: { <track>: [version, durationMs] } }
 *                                   for the songs whose current version is
 *                                   not the original, or was made so again
 *                                   (cached a minute)
 *   GET  /edits/:track              Audio right: the versions, the current one
 *                                   and the latest changes
 *   POST /edits/:track {startMs, endMs, base, note}
 *                                   Audio right: a new version, cut from the
 *                                   original between the two times (snapped to
 *                                   frame edges); `base` is the current version
 *                                   the cut was made against (a newer one: 409)
 *   POST /edits/:track/restore {version, base}
 *                                   Audio right: that version current again
 *
 * Audio (script.js) plays `?v=<version>` when asked (the app does, from GET
 * /edits) and the current version otherwise. The owner and co-owners hold
 * the Audio studio right, and give it (Members) like any right.
 */
import { answer, corsOf, HttpError, preflight, readBody } from "./http.js";
import { MemberError, can, memberRow } from "./members.js";
import { sessionMember } from "./accounts.js";
import { cut, Mp3Error } from "./mp3.js";
import { trackKey } from "../../src/core/media-keys.js";

const MAX_NOTE = 300;
const LOG = 30;
const PUBLIC_S = 60;
export const CURRENT_TTL_MS = 60_000;
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * The cut recording to R2 from its parts, streamed: a long recording is held
 * once (the original), not twice, within the Worker's 128 MB. Outside the
 * Workers runtime (tests) the parts are joined.
 */
async function putParts(env, key, made, options) {
	if (typeof FixedLengthStream !== "function") return env.BUCKET.put(key, made.bytes, options);
	const { readable, writable } = new FixedLengthStream(made.length);
	const putting = env.BUCKET.put(key, readable, options);
	const writer = writable.getWriter();
	for (const p of made.parts) if (p.length) await writer.write(p);
	await writer.close();
	return putting;
}

/** The original's R2 key, from the tracks table: under music/, or in place in storage (src/core/media-keys.js). */
export const originalKey = (row) => trackKey(row.folder_path, row.mp3);
export const versionKey = (track, version) => `edits/${track}/${version}.mp3`;

let current = null;

/**
 * Every song with a current version set: Map<track, { version, key, durationMs }>,
 * read again after CURRENT_TTL_MS. When D1 cannot be read, the last map read
 * is kept (none at first): the originals play.
 */
export async function currentVersions(env, now = Date.now()) {
	if (current && current.until > now) return current.map;
	try {
		const rows = (await env.DB.prepare(`SELECT c.track_id, c.version, v.object_key, v.duration_ms FROM audio_current c
			LEFT JOIN audio_versions v ON v.track_id = c.track_id AND v.version = c.version`).all()).results ?? [];
		const map = new Map(rows.map((r) => [r.track_id, { version: r.version, key: r.version ? r.object_key : null, durationMs: r.duration_ms ?? null }]));
		current = { map, until: now + CURRENT_TTL_MS };
	} catch (err) {
		console.error("audio versions could not be read; the originals play", err);
		current = { map: current?.map ?? new Map(), until: now + 5_000 };
	}
	return current.map;
}
/** Forgets the map read (a change was just made here). */
export const forgetCurrent = () => { current = null; };

/** The R2 key of `version` of `track` (0: null, the original), or undefined when there is no such version. */
export async function keyOfVersion(env, track, version) {
	if (version === 0) return null;
	const row = await env.DB.prepare("SELECT object_key FROM audio_versions WHERE track_id = ?1 AND version = ?2").bind(track, version).first();
	return row ? row.object_key : undefined;
}

async function editor(env, request, nowSeconds) {
	const me = await memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds);
	if (me.blocked) throw new MemberError(`blocked by ${me.blocked.by}: ${me.blocked.reason}`, 403);
	if (!can(me, "audio")) throw new MemberError("this needs the Audio studio right", 403);
	return me;
}

async function detail(env, track) {
	const cur = await env.DB.prepare("SELECT version, set_by, at FROM audio_current WHERE track_id = ?1").bind(track).first();
	const versions = (await env.DB.prepare("SELECT version, start_ms, end_ms, duration_ms, bytes, note, made_by, at FROM audio_versions WHERE track_id = ?1 ORDER BY version DESC").bind(track).all()).results ?? [];
	const log = (await env.DB.prepare("SELECT version, action, by_name, at FROM audio_log WHERE track_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2").bind(track, LOG).all()).results ?? [];
	return {
		track,
		current: cur?.version ?? 0,
		versions: versions.map((v) => ({ version: v.version, startMs: v.start_ms, endMs: v.end_ms, durationMs: v.duration_ms, bytes: v.bytes, note: v.note, by: v.made_by, at: v.at })),
		log: log.map((l) => ({ version: l.version, action: l.action, by: l.by_name, at: l.at })),
	};
}

export async function handleEdits(request, env, ctx, { now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const parts = url.pathname.replace(/^\/edits\/?/, "").split("/").filter(Boolean);
	const cors = corsOf(env, request);
	const m = request.method;
	if (m === "OPTIONS") return preflight(cors);
	const nowSeconds = Math.floor(now() / 1000);
	try {
		if (!env.DB) throw new MemberError("the audio studio is not set up on this Worker: missing DB", 503);
		if (m !== "GET" && m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 405);
		if (!parts.length && m === "GET") {
			const map = await currentVersions(env, now());
			const tracks = {};
			for (const [track, c] of map) tracks[track] = [c.version, c.durationMs];
			const at = (await env.DB.prepare("SELECT MAX(at) AS at FROM audio_current").first())?.at ?? 0;
			return answer(200, { at, tracks }, "*", { "Cache-Control": `public, max-age=${PUBLIC_S}` });
		}
		const track = Number(parts[0]);
		if (!Number.isSafeInteger(track) || track <= 0 || parts.length > 2 || (parts[1] && parts[1] !== "restore")) throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		if (m === "POST" && !cors) throw new MemberError("this origin may not change recordings (AUTH_ORIGINS)", 403);
		const me = await editor(env, request, nowSeconds);
		const row = await env.DB.prepare("SELECT folder_path, mp3 FROM tracks WHERE id = ?1").bind(track).first();
		if (!row) throw new MemberError(`there is no song ${track} in the catalog`, 404);
		if (m === "GET") {
			if (parts[1]) throw new MemberError(`no route ${m} ${url.pathname}`, 404);
			return answer(200, await detail(env, track), cors);
		}
		const body = await readBody(request, 16 * 1024);
		const was = (await env.DB.prepare("SELECT version FROM audio_current WHERE track_id = ?1").bind(track).first())?.version ?? 0;
		if (!Number.isSafeInteger(body.base) || body.base < 0) throw new MemberError("base must be the version the change was made against (0 for the original)");
		if (body.base !== was) throw new MemberError(`version ${was} was made current meanwhile; open the song again`, 409);

		if (parts[1] === "restore") {
			const version = body.version;
			if (!Number.isSafeInteger(version) || version < 0) throw new MemberError("version must be a version of the song, 0 for the original");
			if ((await keyOfVersion(env, track, version)) === undefined) throw new MemberError(`song ${track} has no version ${version}`, 404);
			await env.DB.batch([
				env.DB.prepare("INSERT INTO audio_current (track_id, version, set_by, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (track_id) DO UPDATE SET version = excluded.version, set_by = excluded.set_by, at = excluded.at").bind(track, version, me.login, nowSeconds),
				env.DB.prepare("INSERT INTO audio_log (track_id, version, action, by_name, at) VALUES (?1, ?2, 'restore', ?3, ?4)").bind(track, version, me.login, nowSeconds),
			]);
			forgetCurrent();
			return answer(200, await detail(env, track), cors);
		}

		const { startMs, endMs } = body;
		const note = typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE) : "";
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) throw new MemberError("startMs and endMs must be times in the original, the start before the end");
		const original = await env.BUCKET.get(originalKey(row));
		if (!original) throw new MemberError(`the recording of song ${track} is not in storage`, 404);
		if (original.size > MAX_BYTES) throw new MemberError(`the recording is larger than ${MAX_BYTES / 1024 / 1024} MB; it cannot be cut here`, 413);
		let made;
		try {
			made = cut(new Uint8Array(await original.arrayBuffer()), startMs, endMs);
		} catch (err) {
			if (err instanceof Mp3Error) throw new MemberError(`the recording cannot be cut: ${err.message}`, 422);
			throw err;
		}
		const version = ((await env.DB.prepare("SELECT MAX(version) AS v FROM audio_versions WHERE track_id = ?1").bind(track).first())?.v ?? 0) + 1;
		const key = versionKey(track, version);
		await putParts(env, key, made, { httpMetadata: { contentType: "audio/mpeg" }, customMetadata: { track: String(track), version: String(version), from: originalKey(row), startMs: String(made.startMs), endMs: String(made.endMs) } });
		await env.DB.batch([
			env.DB.prepare(`INSERT INTO audio_versions (track_id, version, object_key, start_ms, end_ms, duration_ms, bytes, note, made_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
				.bind(track, version, key, made.startMs, made.endMs, made.durationMs, made.length, note, me.login, nowSeconds),
			env.DB.prepare("INSERT INTO audio_current (track_id, version, set_by, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (track_id) DO UPDATE SET version = excluded.version, set_by = excluded.set_by, at = excluded.at").bind(track, version, me.login, nowSeconds),
			env.DB.prepare("INSERT INTO audio_log (track_id, version, action, by_name, at) VALUES (?1, ?2, 'cut', ?3, ?4)").bind(track, version, me.login, nowSeconds),
		]);
		forgetCurrent();
		return answer(201, { ...(await detail(env, track)), made: { version, startMs: made.startMs, endMs: made.endMs, durationMs: made.durationMs, bytes: made.length } }, cors);
	} catch (err) {
		if (err instanceof HttpError) return answer(err.status, { error: err.message }, cors ?? "*");
		console.error("edits request failed", err);
		return answer(500, { error: "the audio studio request failed on the Worker" }, cors ?? "*");
	}
}
