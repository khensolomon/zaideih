/**
 * Audio streaming Worker.
 *
 * Serves MP3 files from R2, looking up the file path in D1 by track ID,
 * and incrementing a play counter on the initial request.
 *
 * Routes:
 *   GET/HEAD /audio/:id    Stream the MP3 for the given track ID.
 *   *        /*            404.
 *
 * Bindings (configure in wrangler.toml):
 *   DB      - D1 database with `track` and `album` tables (see schema below).
 *   BUCKET  - R2 bucket whose layout is `music/<album.folder_path>/<track.mp3>`.
 *
 * Expected D1 schema:
 *   CREATE TABLE album (
 *     id          INTEGER PRIMARY KEY,
 *     folder_path TEXT NOT NULL
 *   );
 *   CREATE TABLE track (
 *     id       INTEGER PRIMARY KEY,
 *     album_id INTEGER NOT NULL REFERENCES album(id),
 *     mp3      TEXT NOT NULL,
 *     plays    INTEGER NOT NULL DEFAULT 0
 *   );
 *   CREATE INDEX idx_track_album_id ON track(album_id);
 *
 * Caching strategy (three layers, fastest first):
 *   1. In-isolate memory cache for track metadata. Lives as long as the
 *      isolate; gives zero-latency lookups for hot tracks within a region.
 *   2. Workers Cache API for track metadata, 24h TTL. Survives isolate
 *      recycling and is shared across requests on the same data center.
 *   3. Cloudflare edge cache for the audio response itself, controlled by
 *      `Cache-Control: public, max-age=..., immutable` on the response.
 *      Same-byte-range requests for the same URL are served from edge
 *      cache without invoking the Worker's R2 fetch path.
 *
 *   Negative results (track not found in D1) are also memory-cached briefly
 *   so a burst of requests for a non-existent ID doesn't repeatedly hit D1.
 *
 *   Note: only range continuations are edge-cached. Initial requests carry
 *   a varying X-Track-Plays header and use `private, max-age=60` so the
 *   client gets a fresh play count on each new playback.
 *
 * Play counting:
 *   A "play" is counted only on the initial request (no Range header, or
 *   `Range: bytes=0-`). Subsequent range requests during playback do not
 *   increment the counter, so a single listen counts as one play. The
 *   increment uses `UPDATE ... RETURNING plays` so the new count comes
 *   back in the same statement, and runs in parallel with the R2 fetch
 *   via Promise.all so it doesn't add to response latency.
 *
 *   The new play count is exposed to the client via the `X-Track-Plays`
 *   response header on initial requests. CORS clients see it via
 *   `Access-Control-Expose-Headers`.
 *
 * Hotlink protection:
 *   Requests with a `sec-fetch-dest` header that is not `audio` or `video`
 *   are rejected with 403. Requests without the header (curl, native audio
 *   players, older clients) are allowed through. This is a low-cost filter
 *   against casual hotlinking from `<img>` tags or cross-origin `fetch()`,
 *   not a real authorization mechanism — use signed URLs for that.
 */

// How long the edge can cache an audio response. Audio files are immutable
// once uploaded, so we set this aggressively. If you ever replace a file,
// upload it under a new key (or purge the cache) rather than overwriting.
const AUDIO_CACHE_MAX_AGE = 86400; // 24 hours

// How long to cache track metadata (folder_path, mp3) in the Cache API.
// Track rows rarely change after creation, so a long TTL is safe.
const TRACK_META_TTL_SECONDS = 86400; // 24 hours

// How long to cache "track not found" in memory, in milliseconds. Short,
// because someone might create the missing track shortly after a 404.
const NEGATIVE_CACHE_TTL_MS = 30_000;

// Soft cap on the in-isolate memory cache. Each entry is tiny (~100 bytes),
// so 5000 entries is well under the 128 MB isolate limit.
const MEMORY_CACHE_MAX_ENTRIES = 5000;

/**
 * In-isolate memory cache for track metadata. Map iteration order is
 * insertion order, which lets us evict the oldest entry when full.
 *
 * @type {Map<number, { value: { folder_path: string, mp3: string } | null, expiresAt: number }>}
 */
const memoryCache = new Map();

export default {
	/**
	 * @param {Request} request
	 * @param {{ DB: D1Database, BUCKET: R2Bucket }} env
	 * @param {ExecutionContext} ctx
	 */
	async fetch(request, env, ctx) {
		// Fast path: reject anything that isn't an /audio/ URL without
		// allocating a URL object. Cuts overhead on bot/probe traffic.
		const urlString = request.url;
		if (!urlString.includes("/audio/")) {
			return new Response("Not Found", { status: 404 });
		}

		// Only GET and HEAD are meaningful for media streaming.
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: { Allow: "GET, HEAD" },
			});
		}

		const url = new URL(urlString);
		const match = /^\/audio\/(\d+)\/?$/.exec(url.pathname);
		if (!match) {
			return new Response("Not Found", { status: 404 });
		}

		const trackId = Number.parseInt(match[1], 10);
		if (!Number.isInteger(trackId) || trackId <= 0) {
			return new Response("Invalid track ID", { status: 400 });
		}

		// Block casual hotlinking. If sec-fetch-dest is present, it must be
		// audio or video — that rejects browsers embedding the URL in <img>,
		// <script>, or fetch() from other origins. If the header is absent
		// (curl, native players, older browsers), we allow the request.
		const dest = request.headers.get("sec-fetch-dest");
		if (dest && dest !== "audio" && dest !== "video") {
			return new Response("Forbidden", { status: 403 });
		}

		try {
			return await handleAudioRequest(trackId, request, env, ctx);
		} catch (err) {
			// Log full detail server-side; return a generic message to the client.
			console.error("audio request failed", { trackId, err });
			return new Response("Internal Server Error", { status: 500 });
		}
	},
};

/**
 * Look up the track in D1 (via cache layers), optionally increment plays,
 * then stream the file from R2.
 *
 * @param {number} trackId
 * @param {Request} request
 * @param {{ DB: D1Database, BUCKET: R2Bucket }} env
 * @param {ExecutionContext} ctx
 */
async function handleAudioRequest(trackId, request, env, ctx) {
	const range = request.headers.get("range");
	const isInitialRequest = !range || range === "bytes=0-";

	const track = await getTrackMeta(trackId, env, ctx);
	if (!track) {
		return new Response("Not Found", { status: 404 });
	}

	// Count a play only on the initial request. We use RETURNING so the
	// same statement that increments also gives us back the new count,
	// avoiding a second D1 round-trip.
	//
	// We await this on the initial request (so we can include the count
	// in the response header), but it runs in parallel with the R2 fetch
	// below — see Promise.all further down.
	let playsPromise = null;
	if (isInitialRequest) {
		playsPromise = env.DB
			.prepare("UPDATE track SET plays = plays + 1 WHERE id = ? RETURNING plays")
			.bind(trackId)
			.first()
			.catch((err) => {
				console.error("plays increment failed", { trackId, err });
				return null;
			});
	}

	const objectKey = `music/${track.folder_path}/${track.mp3}`;
	const getOptions = parseRangeOption(range);

	// Run the R2 fetch and the plays UPDATE in parallel — they're
	// independent. On range continuations, playsPromise is null and this
	// just resolves to the R2 object.
	const [object, playsResult] = await Promise.all([
		env.BUCKET.get(objectKey, getOptions),
		playsPromise,
	]);

	if (!object) {
		// Don't leak the bucket key to the client.
		console.error("R2 object missing", { trackId, objectKey });
		return new Response("Not Found", { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Content-Type", "audio/mpeg");
	headers.set("X-Content-Type-Options", "nosniff");

	// Expose the updated play count to the client on initial requests.
	// Range continuations skip this — the client already has the value
	// from the initial response.
	if (playsResult && typeof playsResult.plays === "number") {
		headers.set("X-Track-Plays", playsResult.plays.toString());
		headers.set("Access-Control-Expose-Headers", "X-Track-Plays");
	}

	// Cache-Control strategy:
	//   - Range continuations are byte-identical for everyone and have no
	//     varying headers, so we cache them aggressively at the edge.
	//   - Initial requests carry the X-Track-Plays header which changes on
	//     every play, so we don't let the edge cache them. Browsers can
	//     still cache for a short window via max-age.
	if (range) {
		headers.set(
			"Cache-Control",
			`public, max-age=${AUDIO_CACHE_MAX_AGE}, immutable`,
		);
	} else {
		headers.set("Cache-Control", "private, max-age=60");
	}

	// ETag lets browsers revalidate with If-None-Match for a cheap 304.
	if (object.httpEtag) {
		headers.set("ETag", object.httpEtag);
	}

	let status = 200;
	let body = object.body;

	if (object.range) {
		const offset = object.range.offset ?? 0;
		const length = object.range.length ?? object.size - offset;
		const end = offset + length - 1;
		headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
		headers.set("Content-Length", length.toString());
		status = 206;
	} else {
		headers.set("Content-Length", object.size.toString());
	}

	// HEAD must not include a body.
	if (request.method === "HEAD") {
		body = null;
	}

	return new Response(body, { headers, status });
}

/**
 * Fetch track metadata using a three-layer cache:
 *   1. In-isolate memory (instant)
 *   2. Workers Cache API (per-data-center, persists across isolates)
 *   3. D1 (via session API for read replicas)
 *
 * Negative results are memory-cached for a short TTL so a flood of
 * requests for an unknown ID doesn't hammer D1.
 *
 * @param {number} trackId
 * @param {{ DB: D1Database }} env
 * @param {ExecutionContext} ctx
 * @returns {Promise<{ folder_path: string, mp3: string } | null>}
 */
async function getTrackMeta(trackId, env, ctx) {
	// Layer 1: in-isolate memory.
	const memHit = memoryCache.get(trackId);
	if (memHit && memHit.expiresAt > Date.now()) {
		return memHit.value;
	}
	if (memHit) {
		// Expired — drop it.
		memoryCache.delete(trackId);
	}

	// Layer 2: Cache API.
	const cacheKey = new Request(`https://cache.internal/track-meta/${trackId}`);
	const cache = caches.default;
	const cached = await cache.match(cacheKey);
	if (cached) {
		const meta = await cached.json();
		setMemoryCache(trackId, meta, TRACK_META_TTL_SECONDS * 1000);
		return meta;
	}

	// Layer 3: D1. Use the session API so reads can be served from the
	// nearest replica when available; "first-unconstrained" allows any
	// replica to answer (lowest latency).
	const session = env.DB.withSession("first-unconstrained");
	const result = await session
		.prepare(
			`SELECT a.folder_path, t.mp3
			 FROM album a JOIN track t ON t.album_id = a.id
			 WHERE t.id = ?`,
		)
		.bind(trackId)
		.first();

	if (!result) {
		// Negative cache: short TTL, memory only (don't pollute the Cache
		// API with negative entries that are harder to invalidate).
		setMemoryCache(trackId, null, NEGATIVE_CACHE_TTL_MS);
		return null;
	}

	const meta = { folder_path: result.folder_path, mp3: result.mp3 };
	setMemoryCache(trackId, meta, TRACK_META_TTL_SECONDS * 1000);

	const cacheResponse = new Response(JSON.stringify(meta), {
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": `public, max-age=${TRACK_META_TTL_SECONDS}`,
		},
	});
	ctx.waitUntil(cache.put(cacheKey, cacheResponse));

	return meta;
}

/**
 * Insert into the in-isolate memory cache, evicting the oldest entry if
 * we're at the soft cap.
 *
 * @param {number} trackId
 * @param {{ folder_path: string, mp3: string } | null} value
 * @param {number} ttlMs
 */
function setMemoryCache(trackId, value, ttlMs) {
	if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
		// Evict the oldest entry (first insertion in Map iteration order).
		const oldestKey = memoryCache.keys().next().value;
		if (oldestKey !== undefined) memoryCache.delete(oldestKey);
	}
	memoryCache.set(trackId, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Parse a Range header into an R2 GetOptions object. Returns undefined
 * (not an empty object) when there's no usable range, so callers can
 * pass it directly to env.BUCKET.get(key, parseRangeOption(...)).
 *
 * @param {string | null} range
 * @returns {R2GetOptions | undefined}
 */
function parseRangeOption(range) {
	if (!range) return undefined;
	const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
	if (!match) return undefined;

	const offset = Number.parseInt(match[1], 10);
	const end = match[2] ? Number.parseInt(match[2], 10) : undefined;
	return {
		range:
			end !== undefined ? { offset, length: end - offset + 1 } : { offset },
	};
}