/**
 * Audio Worker — Architecture A.
 *
 * Responsibilities:
 *   1. /audio/:id (GET, HEAD) — stream MP3 from R2.
 *      - Path lookup from D1 (cached aggressively).
 *      - On initial requests: fire-and-forget Django call to increment plays.
 *      - Records telemetry to D1 (success/timeout/failure + latency).
 *
 *   2. /sync/track/:id (POST) — receive path updates from Django.
 *      - HMAC-signed by Django.
 *      - Writes to D1 `tracks` table.
 *
 *   3. /sync/track/:id (DELETE) — receive deletions from Django.
 *      - HMAC-signed.
 *      - Removes from D1.
 *
 *   4. /sync/ping (GET) — sanity check; returns 200 OK if HMAC verifies.
 *      - Used by Django's setup-check command.
 *
 * Bindings (configure in wrangler.toml):
 *   DB                  - D1 database (tracks + play_telemetry tables)
 *   BUCKET              - R2 bucket
 *   AUDIO_SIGNING_KEY   - Secret for signed-URL verification (audio-worker→browser)
 *   WORKER_SECRET_SHARED - Secret shared with Django (HMAC for both directions)
 *   APP_URL     - Plain var, e.g. "https://example.com"
 *
 * D1 schema (see migrations/0001_initial.sql):
 *   tracks         - (id, folder_path, mp3, updated_at)
 *   play_telemetry - (track_id, status, latency_ms, recorded_at)
 */

const TRACK_META_TTL_SECONDS = 86400;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const MEMORY_CACHE_MAX_ENTRIES = 5000;
const AUDIO_CACHE_MAX_AGE = 86400;

// How long the Worker waits for Django to respond before giving up.
// Keep well under Cloudflare's 30s background task limit.
const DJANGO_TIMEOUT_MS = 5_000;

// Reject sync requests whose timestamp is more than this old, to
// prevent replay attacks.
const SYNC_TIMESTAMP_WINDOW_SECONDS = 300;

/** @type {Map<number, { value: object | null, expiresAt: number }>} */
const memoryCache = new Map();

/** Cached HMAC keys (one per secret). */
const keyCache = { audio: null, django: null };

export default {
	/**
	 * @param {Request} request
	 * @param {object} env
	 * @param {ExecutionContext} ctx
	 */
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// Sync routes from Django. HMAC-protected.
		if (url.pathname.startsWith("/sync/")) {
			return handleSync(url, request, env, ctx);
		}

		// Audio streaming.
		const audioMatch = /^\/audio\/(\d+)\/?$/.exec(url.pathname);
		if (audioMatch) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				return new Response("Method Not Allowed", {
					status: 405,
					headers: { Allow: "GET, HEAD" },
				});
			}

			const trackId = Number.parseInt(audioMatch[1], 10);
			if (!Number.isInteger(trackId) || trackId <= 0) {
				return new Response("Invalid track ID", { status: 400 });
			}

			// Light hotlinking filter — same as before.
			const dest = request.headers.get("sec-fetch-dest");
			if (dest && dest !== "audio" && dest !== "video") {
				return new Response("Forbidden", { status: 403 });
			}

			try {
				return await handleAudioRequest(trackId, request, env, ctx);
			} catch (err) {
				console.error("audio request failed", { trackId, err });
				return new Response("Internal Server Error", { status: 500 });
			}
		}

		return new Response("Not Found", { status: 404 });
	},
};

// ============================================================================
// Audio streaming
// ============================================================================

async function handleAudioRequest(trackId, request, env, ctx) {
	const range = request.headers.get("range");
	const isInitialRequest = !range || range === "bytes=0-";

	// Look up path from D1 (with caching).
	const track = await getTrackMeta(trackId, env, ctx);
	if (!track) {
		return new Response("Not Found", { status: 404 });
	}

	// Initial requests: fire-and-forget Django call to increment plays.
	// We don't block streaming; ctx.waitUntil keeps the Worker alive
	// long enough to record telemetry after the stream starts.
	if (isInitialRequest) {
		ctx.waitUntil(
			notifyPlayWithTelemetry(trackId, env).catch((err) => {
				console.error("notifyPlay error", { trackId, err });
			}),
		);
	}

	const objectKey = `music/${track.folder_path}/${track.mp3}`;
	const object = await env.BUCKET.get(objectKey, parseRangeOption(range));

	if (!object) {
		console.error("R2 object missing", { trackId, objectKey });
		return new Response("Not Found", { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Content-Type", "audio/mpeg");
	headers.set("X-Content-Type-Options", "nosniff");
	if (object.httpEtag) headers.set("ETag", object.httpEtag);

	// Range continuations are byte-identical for everyone — cache them
	// aggressively at the edge. Initial requests aren't cached so each
	// triggers a fresh play increment.
	if (range) {
		headers.set(
			"Cache-Control",
			`public, max-age=${AUDIO_CACHE_MAX_AGE}, immutable`,
		);
	} else {
		headers.set("Cache-Control", "private, max-age=60");
	}

	let status = 200;
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

	const body = request.method === "HEAD" ? null : object.body;
	return new Response(body, { headers, status });
}

/**
 * Fire the play notification to Django, then record the outcome to the
 * D1 telemetry table. Records success, timeout, http_<code>, or error
 * along with latency in ms.
 */
async function notifyPlayWithTelemetry(trackId, env) {
	const start = Date.now();
	let status = "error";
	let httpStatus = null;

	try {
		const path = `/api/internal/track/${trackId}/play/`;
		const ts = Math.floor(Date.now() / 1000).toString();
		const sig = await hmacHex(
			await getKey(env.WORKER_SECRET_SHARED, "django"),
			`${path}.${ts}`,
		);

		const res = await fetch(`${env.APP_URL}${path}`, {
			method: "POST",
			headers: {
				"X-Worker-Signature": sig,
				"X-Worker-Timestamp": ts,
			},
			signal: AbortSignal.timeout(DJANGO_TIMEOUT_MS),
		});

		httpStatus = res.status;
		status = res.ok ? "success" : `http_${res.status}`;
	} catch (err) {
		if (err && err.name === "TimeoutError") {
			status = "timeout";
		} else if (err && err.name === "AbortError") {
			status = "timeout";
		} else {
			status = "error";
		}
	}

	const latency = Date.now() - start;

	// Best-effort telemetry write. If telemetry itself fails, we just
	// log and move on — telemetry failures shouldn't cascade.
	try {
		await env.DB.prepare(
			`INSERT INTO play_telemetry (track_id, status, latency_ms, recorded_at)
			 VALUES (?, ?, ?, ?)`,
		)
			.bind(trackId, status, latency, Math.floor(Date.now() / 1000))
			.run();
	} catch (err) {
		console.error("telemetry write failed", { trackId, status, err });
	}
}

// ============================================================================
// Track metadata lookup (D1 + cache layers)
// ============================================================================

async function getTrackMeta(trackId, env, ctx) {
	// L1: in-isolate memory.
	const memHit = memoryCache.get(trackId);
	if (memHit && memHit.expiresAt > Date.now()) return memHit.value;
	if (memHit) memoryCache.delete(trackId);

	// L2: Cache API (per-data-center, persists across isolates).
	const cacheKey = new Request(`https://cache.internal/track-meta/${trackId}`);
	const cache = caches.default;
	const cached = await cache.match(cacheKey);
	if (cached) {
		const meta = await cached.json();
		setMemoryCache(trackId, meta, TRACK_META_TTL_SECONDS * 1000);
		return meta;
	}

	// L3: D1.
	const session = env.DB.withSession("first-unconstrained");
	const result = await session
		.prepare("SELECT folder_path, mp3 FROM tracks WHERE id = ?")
		.bind(trackId)
		.first();

	if (!result) {
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

function setMemoryCache(trackId, value, ttlMs) {
	if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
		const oldestKey = memoryCache.keys().next().value;
		if (oldestKey !== undefined) memoryCache.delete(oldestKey);
	}
	memoryCache.set(trackId, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Invalidate cached entries for a track. Called when Django pushes an
 * update, so the next read sees fresh data immediately.
 */
async function invalidateTrackCache(trackId, ctx) {
	memoryCache.delete(trackId);
	const cacheKey = new Request(`https://cache.internal/track-meta/${trackId}`);
	ctx.waitUntil(caches.default.delete(cacheKey));
}

// ============================================================================
// Sync endpoints (Django → Worker)
// ============================================================================

async function handleSync(url, request, env, ctx) {
	// Verify HMAC signature for any /sync/ endpoint.
	const sigOk = await verifyDjangoSignature(url, request, env);
	if (!sigOk) return new Response("Forbidden", { status: 403 });

	// /sync/ping — health check.
	if (url.pathname === "/sync/ping" && request.method === "GET") {
		return new Response("pong", { status: 200 });
	}

	// /sync/track/:id — track upsert/delete.
	const trackMatch = /^\/sync\/track\/(\d+)\/?$/.exec(url.pathname);
	if (trackMatch) {
		const trackId = Number.parseInt(trackMatch[1], 10);
		if (!Number.isInteger(trackId) || trackId <= 0) {
			return new Response("Invalid track ID", { status: 400 });
		}

		if (request.method === "POST") {
			return handleTrackUpsert(trackId, request, env, ctx);
		}
		if (request.method === "DELETE") {
			return handleTrackDelete(trackId, env, ctx);
		}
		return new Response("Method Not Allowed", { status: 405 });
	}

	return new Response("Not Found", { status: 404 });
}

async function handleTrackUpsert(trackId, request, env, ctx) {
	let body;
	try {
		body = await request.json();
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	const folder_path = String(body.folder_path || "").trim();
	const mp3 = String(body.mp3 || "").trim();
	if (!folder_path || !mp3) {
		return new Response("folder_path and mp3 required", { status: 400 });
	}

	const now = Math.floor(Date.now() / 1000);

	await env.DB.prepare(
		`INSERT INTO tracks (id, folder_path, mp3, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   folder_path = excluded.folder_path,
		   mp3 = excluded.mp3,
		   updated_at = excluded.updated_at`,
	)
		.bind(trackId, folder_path, mp3, now)
		.run();

	await invalidateTrackCache(trackId, ctx);

	return new Response(
		JSON.stringify({ id: trackId, ok: true }),
		{ headers: { "Content-Type": "application/json" } },
	);
}

async function handleTrackDelete(trackId, env, ctx) {
	await env.DB.prepare("DELETE FROM tracks WHERE id = ?").bind(trackId).run();
	await invalidateTrackCache(trackId, ctx);
	return new Response(
		JSON.stringify({ id: trackId, ok: true }),
		{ headers: { "Content-Type": "application/json" } },
	);
}

// ============================================================================
// HMAC signing / verification
// ============================================================================

async function getKey(secret, slot) {
	if (keyCache[slot]) return keyCache[slot];
	keyCache[slot] = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
	return keyCache[slot];
}

async function hmacHex(key, payload) {
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(payload),
	);
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Verify the HMAC signature on a request from Django.
 * Django signs `${path}.${timestamp}` with the shared secret and sends
 * X-Worker-Signature (hex) and X-Worker-Timestamp (unix seconds) headers.
 */
async function verifyDjangoSignature(url, request, env) {
	const sig = request.headers.get("X-Worker-Signature");
	const ts = request.headers.get("X-Worker-Timestamp");
	if (!sig || !ts) return false;

	const tsNum = Number(ts);
	if (!Number.isFinite(tsNum)) return false;

	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - tsNum) > SYNC_TIMESTAMP_WINDOW_SECONDS) return false;

	const expected = await hmacHex(
		await getKey(env.WORKER_SECRET_SHARED, "django"),
		`${url.pathname}.${ts}`,
	);

	// Constant-time comparison.
	if (sig.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < sig.length; i++) {
		diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return diff === 0;
}

// ============================================================================
// Range parsing
// ============================================================================

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