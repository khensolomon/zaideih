/**
 * Audio Worker.
 *
 * Routes:
 *   GET/HEAD /audio/:id   Stream an MP3 from R2. The object key is
 *                         `music/{folder_path}/{mp3}` (or, for an album published in place,
 *                         where its files are in storage: src/core/media-keys.js), looked up in D1 by track id;
 *                         a song trimmed in the audio studio plays its current
 *                         version, and `?v=<version>` asks for one (0: the
 *                         original), see audio-edits.js.
 *   OPTIONS  /audio/:id   CORS preflight for allowed origins.
 *   POST     /plays       Count song plays sent by the app (see "Play counts").
 *   GET      /plays       Play totals per track, for the app (public, cached 5 minutes).
 *   GET      /plays/stats When counting began, the plays of each day, and each song's plays of the
 *                         last 7 days, for the Workspace's Statistics (public, cached 5 minutes).
 *   OPTIONS  /plays       CORS preflight for counting origins.
 *   /auth/*               Sign in with GitHub for the Workspace and suggestions
 *                         (auth.js, suggest.js); accounts: Zaideih sessions from
 *                         GitHub, Google or passkey sign-ins (accounts.js,
 *                         google.js, passkeys.js), all through auth.js.
 *   /library/*            Personal libraries: uploads, storage, members and
 *                         moderation (library.js), synced likes and playlists
 *                         (sync.js), asking to publish (requests.js).
 *   /lyrics/:id           Lyrics of catalog songs: public reading, editing signed in;
 *                         also /lyrics/recent and /lyrics/index (lyrics.js).
 *   /live, /live/…         Catalog changes made live, without a release: public list,
 *                         and the Catalog right's changes (live.js).
 *   /holds, /holds/:album  Albums held back without a release: public list,
 *                         set by the Albums right; held songs are refused
 *                         here with 403 (holds.js).
 *   /songbooks/*          Songbooks: books, hymn numbers, texts, works, people and
 *                         credits; texts' words are lyrics (songbooks.js).
 *   /edits, /edits/:track  The audio studio: songs trimmed at the start and end,
 *                         as versions, the originals kept (audio-edits.js).
 *   GET/HEAD /u/:id       An upload, through a signed address (library.js).
 *   GET/HEAD /k/:key      A file in storage (private/), through a signed address (library.js).
 *
 * Who may fetch audio:
 *   - <audio>/<video> elements (Sec-Fetch-Dest: audio|video) from any page.
 *   - fetch() (Sec-Fetch-Dest: empty), used by the app to download tracks for
 *     offline play, only from an origin listed in ALLOWED_ORIGINS. Those
 *     responses carry CORS headers so the app can read the body.
 *   - Clients that send no Sec-Fetch-Dest (non-browser tools) are served as before.
 *   Fetch metadata headers are a deterrent against casual hotlinking, not access
 *   control: non-browser clients can send any header they like.
 *
 * Bindings (wrangler.toml):
 *   DB               D1 database with `tracks` and `tracks_status`
 *   BUCKET           R2 bucket with the audio objects
 *   ALLOWED_ORIGINS  comma-separated origins allowed to download, e.g.
 *                    "https://zaideih.com,app://zaideih"
 *   META_CACHE_VERSION  optional; part of the edge-cache key for track
 *                    lookups. Changing it drops every cached lookup, e.g.
 *                    after correcting paths in D1.
 *   PLAY_ORIGINS     comma-separated origins whose plays are counted: the
 *                    released app only, so local testing never counts
 *   PLAYS_LIMIT      rate limiter, keyed per sender address: requests to /plays
 *   TRACK_LIMIT      rate limiter, keyed per sender address and track
 *
 * Play counts (`plays` table, one row per track and UTC day):
 *   The app posts {"v":1,"plays":[[trackId, unixSeconds], ...]} as text/plain
 *   (no preflight, so it also works from a closing page), at most MAX_PLAYS
 *   entries. The answer lists what was not counted and why:
 *   {"accepted": n, "rejected": [[index, reason], ...]} with reasons
 *   invalid, too-old, in-future, unknown-track, repeated and rate-limited.
 *   A malformed request is refused as a whole (400, 413) with the reason.
 *   Limits per sender address (deterrents, not accounting: the limiter is per
 *   Cloudflare location and approximate): PLAYS_LIMIT requests a minute, and
 *   one counted batch per track a minute (TRACK_LIMIT), in which a track
 *   counts at most MAX_PER_TRACK times. The address is used only as a limiter
 *   key and never stored.
 *
 * Diagnostic headers (read by the app's failure probe, see
 * src/core/probe.js; they carry no paths):
 *   X-Zaideih-Meta    where the track lookup came from: memory, edge or d1
 *   X-Zaideih-Reason  on 404: no-track (no D1 row) or no-object (no R2 object)
 *
 * The `tracks` table is loaded from assets/data/media.json with
 * `node tools/media.mjs d1 --apply` and `wrangler d1 execute`.
 */

import { handleAuth } from "./auth.js";
import { handleLibrary, handleSignedAudio, handleSignedKey } from "./library.js";
import { handleLyrics } from "./lyrics.js";
import { handleHolds, heldTracks } from "./holds.js";
import { handleLive } from "./live.js";
import { handleSongbooks } from "./songbooks.js";
import { currentVersions, keyOfVersion, originalKey } from "./audio-edits.js";
import { handleEdits } from "./audio-edits.js";

const TRACK_META_TTL_SECONDS = 86400;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const MEMORY_CACHE_MAX_ENTRIES = 5000;
const AUDIO_CACHE_MAX_AGE = 86400;
/** A song's ranges asked for without a version: it may be trimmed, so an hour, not a day (and not immutable). */
const UNVERSIONED_CACHE_SECONDS = 3600;
const MEDIA_DESTINATIONS = new Set(["audio", "video"]);
const MAX_PLAYS = 50;
const MAX_PER_TRACK = 3;
const MAX_PLAYS_BODY = 8192;
const PLAY_MAX_AGE_SECONDS = 30 * 86400;
const PLAY_MAX_AHEAD_SECONDS = 3600;
const EXPOSED_HEADERS = "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, X-Zaideih-Meta, X-Zaideih-Reason, X-Zaideih-Version";

/** @type {Map<string, { value: object | null, expiresAt: number }>} keyed "<META_CACHE_VERSION>:<id>" */
const memoryCache = new Map();

/** Parsed ALLOWED_ORIGINS, cached per isolate. */
let allowedOrigins = null;
let allowedOriginsSource = null;

export default {
	/**
	 * @param {Request} request
	 * @param {object} env
	 * @param {ExecutionContext} ctx
	 */
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/plays" || url.pathname === "/plays/") return handlePlays(request, env, ctx);
		if (url.pathname === "/plays/stats" && (request.method === "GET" || request.method === "HEAD")) return handlePlayStats(request, env, ctx);
		if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) return handleAuth(request, env);
		if (url.pathname === "/library" || url.pathname.startsWith("/library/")) return handleLibrary(request, env);
		if (url.pathname.startsWith("/lyrics/")) return handleLyrics(request, env, ctx);
		if (url.pathname === "/holds" || url.pathname.startsWith("/holds/")) return handleHolds(request, env, ctx);
		if (url.pathname === "/live" || url.pathname.startsWith("/live/")) return handleLive(request, env, ctx);
		if (url.pathname === "/songbooks" || url.pathname.startsWith("/songbooks/")) return handleSongbooks(request, env, ctx);
		if (url.pathname === "/edits" || url.pathname.startsWith("/edits/")) return handleEdits(request, env, ctx);
		const signed = /^\/u\/(\d+)$/.exec(url.pathname);
		if (signed) return handleSignedAudio(request, env, Number(signed[1]));
		const stored = /^\/k\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
		if (stored) return handleSignedKey(request, env, stored[1]);
		const audioMatch = /^\/audio\/(\d+)\/?$/.exec(url.pathname);
		if (!audioMatch) return new Response("Not Found", { status: 404 });

		const trackId = Number.parseInt(audioMatch[1], 10);
		if (!Number.isSafeInteger(trackId) || trackId <= 0) {
			return new Response("Invalid track ID", { status: 400 });
		}

		const origin = request.headers.get("origin");
		const cors = corsHeaders(origin, env);

		if (request.method === "OPTIONS") {
			if (!cors) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
			cors.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
			cors.set("Access-Control-Allow-Headers", "Range");
			cors.set("Access-Control-Max-Age", "86400");
			return new Response(null, { status: 204, headers: cors });
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
		}

		const dest = request.headers.get("sec-fetch-dest");
		if (dest && !MEDIA_DESTINATIONS.has(dest) && !(dest === "empty" && cors)) {
			return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
		}

		try {
			return await handleAudioRequest(trackId, request, env, ctx, cors);
		} catch (err) {
			console.error("audio request failed", { trackId, err });
			ctx.waitUntil(recordStatus(env, trackId, "fetch_error"));
			return new Response("Internal Server Error", { status: 500 });
		}
	},
};

// ============================================================================
// CORS
// ============================================================================

function originsOf(env) {
	const source = env.ALLOWED_ORIGINS ?? "";
	if (allowedOrigins && allowedOriginsSource === source) return allowedOrigins;
	allowedOrigins = new Set(source.split(",").map((s) => s.trim()).filter(Boolean));
	allowedOriginsSource = source;
	return allowedOrigins;
}

/** CORS headers for an allowed origin, or null when the origin is not allowed. */
function corsHeaders(origin, env) {
	if (!origin || !originsOf(env).has(origin)) return null;
	return new Headers({
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Expose-Headers": EXPOSED_HEADERS,
		Vary: "Origin",
	});
}

// ============================================================================
// Play counts
// ============================================================================

let playOrigins = null;
let playOriginsSource = null;

function playOriginsOf(env) {
	const source = env.PLAY_ORIGINS ?? "";
	if (playOrigins && playOriginsSource === source) return playOrigins;
	playOrigins = new Set(source.split(",").map((s) => s.trim()).filter(Boolean));
	playOriginsSource = source;
	return playOrigins;
}

function playsResponse(status, body, origin, extra = {}) {
	const headers = new Headers({ "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "Cache-Control": "no-store", Vary: "Origin", ...extra });
	if (origin) headers.set("Access-Control-Allow-Origin", origin);
	return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

/** UTC calendar day of a unix time, e.g. "2026-10-21". */
export function playDay(seconds) {
	return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Checks a /plays body. Returns { error } for a request refused as a whole,
 * otherwise { plays: [{ index, id, at }], rejected: [[index, reason]] }.
 */
export function parsePlays(text, nowSeconds) {
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		return { error: "body is not JSON" };
	}
	if (!body || body.v !== 1 || !Array.isArray(body.plays)) return { error: 'expected {"v":1,"plays":[[trackId, unixSeconds], ...]}' };
	if (body.plays.length === 0) return { error: "no plays" };
	if (body.plays.length > MAX_PLAYS) return { error: `at most ${MAX_PLAYS} plays per request, got ${body.plays.length}` };
	const plays = [];
	const rejected = [];
	body.plays.forEach((p, index) => {
		const [id, at] = Array.isArray(p) && p.length === 2 ? p : [];
		if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(at)) rejected.push([index, "invalid"]);
		else if (at < nowSeconds - PLAY_MAX_AGE_SECONDS) rejected.push([index, "too-old"]);
		else if (at > nowSeconds + PLAY_MAX_AHEAD_SECONDS) rejected.push([index, "in-future"]);
		else plays.push({ index, id, at });
	});
	return { plays, rejected };
}

/*
 * GET /plays: the counted plays per track, for the app to add to the
 * catalog's own counts. Public, read-only totals (no listener data), so any
 * origin may read them. Cached at the edge for PLAY_TOTALS_SECONDS, so D1 is
 * asked at most once per data centre in that time.
 *
 *   {"v":1,"updated":<unix seconds>,"recentDays":30,"tracks":[[id, total, last30Days], ...]}
 */
const PLAY_TOTALS_SECONDS = 300;
const PLAY_RECENT_DAYS = 30;

export async function playTotals(env) {
	// Totals from the running sums (one row a song), the recent days from `plays` by its day
	// index (only the rows of those days): never a sum over every song's every day.
	const totals = (await env.DB.prepare("SELECT track_id AS id, total FROM play_totals ORDER BY track_id").all()).results ?? [];
	const recent = new Map(((await env.DB.prepare(`SELECT track_id AS id, SUM(n) AS n FROM plays WHERE day >= date('now', '-${PLAY_RECENT_DAYS - 1} days') GROUP BY track_id`).all()).results ?? []).map((r) => [r.id, r.n]));
	return {
		v: 1,
		updated: Math.floor(Date.now() / 1000),
		recentDays: PLAY_RECENT_DAYS,
		tracks: totals.map((r) => [r.id, r.total, recent.get(r.id) ?? 0]),
	};
}

async function handlePlayTotals(request, env, ctx) {
	const headers = { "Content-Type": "application/json", "Cache-Control": `public, max-age=${PLAY_TOTALS_SECONDS}`, "Access-Control-Allow-Origin": "*" };
	const key = new Request("https://cache.internal/play-totals/v1");
	const cached = await caches.default.match(key);
	if (cached) {
		const h = new Headers(cached.headers);
		h.set("Access-Control-Allow-Origin", "*");
		return new Response(request.method === "HEAD" ? null : cached.body, { status: 200, headers: h });
	}
	let body;
	try {
		body = JSON.stringify(await playTotals(env));
	} catch (err) {
		console.error("reading play totals failed", err);
		return new Response("play totals are unavailable; try again later", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
	}
	ctx.waitUntil(caches.default.put(key, new Response(body, { headers })));
	return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

/*
 * GET /plays/stats: what the Workspace's Statistics adds to the totals. Public,
 * like them (no listener data), cached at the edge PLAY_TOTALS_SECONDS.
 *
 *   {"v":1,"updated":<unix seconds>,"first":"YYYY-MM-DD"|null,"today":"YYYY-MM-DD",
 *    "days":[["YYYY-MM-DD", plays], ...]   every day with plays, the last PLAY_STATS_DAYS
 *    "week":[[id, plays], ...]}            each song's plays of the last 7 days (today included)
 */
const PLAY_STATS_DAYS = 400;

export async function playStats(env) {
	const first = (await env.DB.prepare("SELECT MIN(day) AS day FROM play_days").first())?.day ?? null;
	const today = new Date().toISOString().slice(0, 10);
	// One row a day from the running sums; each song's week from `plays` by its day index.
	const days = (await env.DB.prepare(`SELECT day, n FROM play_days WHERE day >= date('now', '-${PLAY_STATS_DAYS - 1} days') ORDER BY day`).all()).results ?? [];
	const week = (await env.DB.prepare("SELECT track_id AS id, SUM(n) AS n FROM plays WHERE day >= date('now', '-6 days') GROUP BY track_id ORDER BY track_id").all()).results ?? [];
	return { v: 1, updated: Math.floor(Date.now() / 1000), first, today, days: days.map((r) => [r.day, r.n]), week: week.map((r) => [r.id, r.n]) };
}

async function handlePlayStats(request, env, ctx) {
	const headers = { "Content-Type": "application/json", "Cache-Control": `public, max-age=${PLAY_TOTALS_SECONDS}`, "Access-Control-Allow-Origin": "*" };
	const key = new Request("https://cache.internal/play-stats/v1");
	const cached = await caches.default.match(key);
	if (cached) {
		const h = new Headers(cached.headers);
		h.set("Access-Control-Allow-Origin", "*");
		return new Response(request.method === "HEAD" ? null : cached.body, { status: 200, headers: h });
	}
	let body;
	try {
		body = JSON.stringify(await playStats(env));
	} catch (err) {
		console.error("reading play statistics failed", err);
		return new Response("play statistics are unavailable; try again later", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
	}
	ctx.waitUntil(caches.default.put(key, new Response(body, { headers })));
	return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

async function handlePlays(request, env, ctx) {
	if (request.method === "GET" || request.method === "HEAD") return handlePlayTotals(request, env, ctx);
	const origin = request.headers.get("origin");
	const allowed = origin && playOriginsOf(env).has(origin) ? origin : null;
	if (request.method === "OPTIONS") {
		if (!allowed) return playsResponse(403, "origin not allowed to count plays", null);
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } });
	}
	if (request.method !== "POST") return playsResponse(405, "use GET to read play totals or POST to count plays", allowed, { Allow: "GET, HEAD, POST, OPTIONS" });
	if (!allowed) return playsResponse(403, "origin not allowed to count plays", null);
	if (!env.PLAYS_LIMIT || !env.TRACK_LIMIT) {
		console.error("PLAYS_LIMIT and TRACK_LIMIT rate limiter bindings are required for /plays (wrangler.toml)");
		return playsResponse(500, "play counting is not configured", allowed);
	}

	const sender = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (!(await env.PLAYS_LIMIT.limit({ key: sender })).success) return playsResponse(429, "too many requests; try again in a minute", allowed, { "Retry-After": "60" });

	const declared = Number(request.headers.get("content-length") ?? 0);
	if (declared > MAX_PLAYS_BODY) return playsResponse(413, `body larger than ${MAX_PLAYS_BODY} bytes`, allowed);
	const text = await request.text();
	if (text.length > MAX_PLAYS_BODY) return playsResponse(413, `body larger than ${MAX_PLAYS_BODY} bytes`, allowed);

	const nowSeconds = Math.floor(Date.now() / 1000);
	const parsed = parsePlays(text, nowSeconds);
	if (parsed.error) return playsResponse(400, parsed.error, allowed);
	const { plays, rejected } = parsed;

	try {
		// Only tracks in the catalog count.
		const ids = [...new Set(plays.map((p) => p.id))];
		const known = new Set();
		if (ids.length) {
			const rows = await env.DB.prepare(`SELECT id FROM tracks WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
			for (const row of rows.results ?? []) known.add(row.id);
		}
		const perTrack = new Map();
		const counts = new Map(); // "id|day" -> n
		for (const p of plays) {
			if (!known.has(p.id)) { rejected.push([p.index, "unknown-track"]); continue; }
			if (!perTrack.has(p.id)) perTrack.set(p.id, { allowed: (await env.TRACK_LIMIT.limit({ key: `${sender}:${p.id}` })).success, n: 0 });
			const t = perTrack.get(p.id);
			if (!t.allowed) { rejected.push([p.index, "rate-limited"]); continue; }
			if (t.n >= MAX_PER_TRACK) { rejected.push([p.index, "repeated"]); continue; }
			t.n += 1;
			// A device clock a little ahead never files a play under tomorrow.
			const key = `${p.id}|${playDay(Math.min(p.at, nowSeconds))}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		if (counts.size) {
			// Each day's count and the running sums (a song's total, a day's) together: all or none.
			const perDay = "INSERT INTO plays (track_id, day, n) VALUES (?1, ?2, ?3) ON CONFLICT(track_id, day) DO UPDATE SET n = n + excluded.n";
			const total = "INSERT INTO play_totals (track_id, total) VALUES (?1, ?2) ON CONFLICT(track_id) DO UPDATE SET total = total + excluded.total";
			const day = "INSERT INTO play_days (day, n) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET n = n + excluded.n";
			const byTrack = new Map();
			const byDay = new Map();
			for (const [key, n] of counts) {
				const [id, d] = key.split("|");
				byTrack.set(Number(id), (byTrack.get(Number(id)) ?? 0) + n);
				byDay.set(d, (byDay.get(d) ?? 0) + n);
			}
			await env.DB.batch([
				...[...counts].map(([key, n]) => {
					const [id, d] = key.split("|");
					return env.DB.prepare(perDay).bind(Number(id), d, n);
				}),
				...[...byTrack].map(([id, n]) => env.DB.prepare(total).bind(id, n)),
				...[...byDay].map(([d, n]) => env.DB.prepare(day).bind(d, n)),
			]);
		}
		rejected.sort((a, b) => a[0] - b[0]);
		const accepted = [...counts.values()].reduce((a, b) => a + b, 0);
		return playsResponse(200, { accepted, rejected }, allowed);
	} catch (err) {
		console.error("counting plays failed", err);
		return playsResponse(500, "counting failed; try again later", allowed);
	}
}

// ============================================================================
// Audio streaming
// ============================================================================

async function handleAudioRequest(trackId, request, env, ctx, cors) {
	const range = request.headers.get("range");

	// An album held back (holds.js): its songs do not play, whatever link they come from.
	if ((await heldTracks(env)).has(trackId)) {
		const h = new Headers(cors ?? undefined);
		h.set("X-Zaideih-Reason", "held");
		h.set("Cache-Control", "no-store");
		h.set("Content-Type", "text/plain; charset=utf-8");
		return new Response("This song is not available right now.", { status: 403, headers: h });
	}
	const { meta: track, source } = await getTrackMeta(trackId, env, ctx);
	const diag = (reason) => {
		const h = new Headers(cors ?? undefined);
		h.set("X-Zaideih-Meta", source);
		if (reason) h.set("X-Zaideih-Reason", reason);
		return h;
	};
	if (!track) return new Response("Not Found", { status: 404, headers: diag("no-track") });

	// The version to play (audio-edits.js): the one asked for (`?v=`, 0 the original), else the current one.
	const asked = new URL(request.url).searchParams.get("v");
	let objectKey = originalKey(track);
	let edited = false;
	let version = 0;
	if (asked !== null) {
		version = Number(asked);
		if (!Number.isSafeInteger(version) || version < 0) return new Response("v must be a version of the song, 0 for the original", { status: 400, headers: diag("bad-version") });
		const key = await keyOfVersion(env, trackId, version);
		if (key === undefined) return new Response("Not Found", { status: 404, headers: diag("no-version") });
		if (key) objectKey = key;
	} else {
		const cur = (await currentVersions(env)).get(trackId);
		if (cur) {
			edited = true;
			version = cur.version;
			if (cur.key) objectKey = cur.key;
		}
	}

	let object;
	const rangeOption = parseRangeOption(range);
	try {
		object = await env.BUCKET.get(objectKey, rangeOption);
	} catch (err) {
		// A range starting at or past the end of the file is the asker's mistake, not the song's: 416.
		if (rangeOption) {
			const head = await env.BUCKET.head(objectKey).catch(() => null);
			if (head && rangeOption.range.offset >= head.size) {
				const h = diag("range");
				h.set("Content-Range", `bytes */${head.size}`);
				h.set("Cache-Control", "no-store");
				return new Response(null, { status: 416, headers: h });
			}
		}
		console.error("R2 get threw", { trackId, objectKey, err });
		ctx.waitUntil(recordStatus(env, trackId, "fetch_error"));
		return new Response("Internal Server Error", { status: 500, headers: diag() });
	}

	if (!object) {
		// D1 lists the track but R2 has no object: drift between media.json and the bucket.
		console.error("R2 object missing", { trackId, objectKey });
		ctx.waitUntil(recordStatus(env, trackId, "not_found"));
		return new Response("Not Found", { status: 404, headers: diag("no-object") });
	}

	const headers = diag();
	object.writeHttpMetadata(headers);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Content-Type", "audio/mpeg");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Vary", "Origin");
	if (object.httpEtag) headers.set("ETag", object.httpEtag);
	headers.set("X-Zaideih-Version", String(version));
	// A version asked for (`?v=`) never changes. Without one, the song may be trimmed later (audio-edits.js):
	// an edited song's current file is kept briefly, an unedited one an hour, never as immutable.
	headers.set(
		"Cache-Control",
		asked !== null && range ? `public, max-age=${AUDIO_CACHE_MAX_AGE}, immutable`
			: edited ? "private, max-age=300"
			: range ? `public, max-age=${UNVERSIONED_CACHE_SECONDS}` : "private, max-age=60",
	);

	let status = 200;
	if (object.range) {
		const offset = object.range.offset ?? 0;
		const length = object.range.length ?? object.size - offset;
		headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
		headers.set("Content-Length", String(length));
		status = 206;
	} else {
		headers.set("Content-Length", String(object.size));
	}

	// Counts fresh fetches that reach the Worker, not plays: one write for the start of the
	// file, not one for every range a player reads after it (D1 writes are counted per day).
	if (!rangeOption || rangeOption.range.offset === 0) ctx.waitUntil(recordStatus(env, trackId, "served"));

	return new Response(request.method === "HEAD" ? null : object.body, { headers, status });
}

/**
 * UPSERT into tracks_status. The matching counter increments; first_seen is
 * set on insert and never touched again. Failures are logged, not thrown,
 * because telemetry must never break streaming.
 *
 * @param {"served" | "not_found" | "fetch_error"} kind
 */
async function recordStatus(env, trackId, kind) {
	if (kind !== "served" && kind !== "not_found" && kind !== "fetch_error") return;
	const now = Math.floor(Date.now() / 1000);
	// Column names cannot be bound parameters; `kind` is whitelisted above.
	const sql = `
		INSERT INTO tracks_status (track_id, ${kind}, first_seen, last_seen)
		VALUES (?1, 1, ?2, ?2)
		ON CONFLICT(track_id) DO UPDATE SET ${kind} = ${kind} + 1, last_seen = ?2`;
	try {
		await env.DB.prepare(sql).bind(trackId, now).run();
	} catch (err) {
		console.error("tracks_status write failed", { trackId, kind, err });
	}
}

// ============================================================================
// Track metadata lookup (isolate memory -> edge cache -> D1)
// ============================================================================

/** Returns { meta, source }: meta is null for an unknown id; source is memory, edge or d1. */
async function getTrackMeta(trackId, env, ctx) {
	const version = env.META_CACHE_VERSION ?? "1";
	const memKey = `${version}:${trackId}`;
	const memHit = memoryCache.get(memKey);
	if (memHit && memHit.expiresAt > Date.now()) return { meta: memHit.value, source: "memory" };
	if (memHit) memoryCache.delete(memKey);

	const cacheKey = new Request(`https://cache.internal/track-meta/v${encodeURIComponent(version)}/${trackId}`);
	const cache = caches.default;
	const cached = await cache.match(cacheKey);
	if (cached) {
		const meta = await cached.json();
		setMemoryCache(memKey, meta, TRACK_META_TTL_SECONDS * 1000);
		return { meta, source: "edge" };
	}

	const result = await env.DB.withSession("first-unconstrained")
		.prepare("SELECT folder_path, mp3 FROM tracks WHERE id = ?")
		.bind(trackId)
		.first();

	if (!result) {
		setMemoryCache(memKey, null, NEGATIVE_CACHE_TTL_MS);
		return { meta: null, source: "d1" };
	}

	const meta = { folder_path: result.folder_path, mp3: result.mp3 };
	setMemoryCache(memKey, meta, TRACK_META_TTL_SECONDS * 1000);
	ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(meta), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": `public, max-age=${TRACK_META_TTL_SECONDS}`,
		},
	})));
	return { meta, source: "d1" };
}

function setMemoryCache(trackId, value, ttlMs) {
	if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
		const oldestKey = memoryCache.keys().next().value;
		if (oldestKey !== undefined) memoryCache.delete(oldestKey);
	}
	memoryCache.set(trackId, { value, expiresAt: Date.now() + ttlMs });
}

// ============================================================================
// Range parsing
// ============================================================================

/** Supports `bytes=a-` and `bytes=a-b`; anything else is served as a full response. */
export function parseRangeOption(range) {
	if (!range) return undefined;
	const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
	if (!match) return undefined;
	const offset = Number.parseInt(match[1], 10);
	const end = match[2] ? Number.parseInt(match[2], 10) : undefined;
	if (end !== undefined && end < offset) return undefined;
	return { range: end !== undefined ? { offset, length: end - offset + 1 } : { offset } };
}
