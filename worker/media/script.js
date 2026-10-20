/**
 * Audio Worker.
 *
 * Routes:
 *   GET/HEAD /audio/:id   Stream an MP3 from R2. The object key is
 *                         `music/{folder_path}/{mp3}`, looked up in D1 by track id.
 *   OPTIONS  /audio/:id   CORS preflight for allowed origins.
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
 *
 * Diagnostic headers (read by the app's failure probe, see
 * src/core/probe.js; they carry no paths):
 *   X-Zaideih-Meta    where the track lookup came from: memory, edge or d1
 *   X-Zaideih-Reason  on 404: no-track (no D1 row) or no-object (no R2 object)
 *
 * The `tracks` table is loaded from assets/data/media.json with
 * `node tools/media.mjs d1 --apply` and `wrangler d1 execute`.
 */

const TRACK_META_TTL_SECONDS = 86400;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const MEMORY_CACHE_MAX_ENTRIES = 5000;
const AUDIO_CACHE_MAX_AGE = 86400;
const MEDIA_DESTINATIONS = new Set(["audio", "video"]);
const EXPOSED_HEADERS = "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, X-Zaideih-Meta, X-Zaideih-Reason";

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
// Audio streaming
// ============================================================================

async function handleAudioRequest(trackId, request, env, ctx, cors) {
	const range = request.headers.get("range");

	const { meta: track, source } = await getTrackMeta(trackId, env, ctx);
	const diag = (reason) => {
		const h = new Headers(cors ?? undefined);
		h.set("X-Zaideih-Meta", source);
		if (reason) h.set("X-Zaideih-Reason", reason);
		return h;
	};
	if (!track) return new Response("Not Found", { status: 404, headers: diag("no-track") });

	const objectKey = `music/${track.folder_path}/${track.mp3}`;

	let object;
	try {
		object = await env.BUCKET.get(objectKey, parseRangeOption(range));
	} catch (err) {
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
	headers.set(
		"Cache-Control",
		range ? `public, max-age=${AUDIO_CACHE_MAX_AGE}, immutable` : "private, max-age=60",
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

	// Counts fresh fetches that reach the Worker, not plays: browser-cached
	// replays and range continuations never arrive here.
	ctx.waitUntil(recordStatus(env, trackId, "served"));

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
