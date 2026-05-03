/**
 * Audio Worker — Architecture A.
 *
 * Routes:
 *   GET/HEAD /audio/:id        Stream MP3 from R2.
 *                              On initial-play: notify Django (fire-and-forget).
 *                              Records outcome to tracks_stats.
 *   POST     /sync/track/:id   Receive track upsert from Django (HMAC-signed).
 *   DELETE   /sync/track/:id   Receive track deletion from Django.
 *   GET      /sync/ping        Health check (HMAC-signed).
 *
 * Bindings (configure in wrangler.toml):
 *   DB              D1 database (tracks + tracks_stats)
 *   BUCKET          R2 bucket
 *   SECRET_SHARED   Secret shared with Django (HMAC for both directions).
 *                   Must match Django's APP_SECRET_SHARED exactly.
 *   APP_URL         Plain var, e.g. "https://example.com" or a cloudflared
 *                   tunnel URL during development.
 *
 * (AUDIO_SIGNING_KEY for browser-side signed URLs is unchanged from the
 *  earlier setup and is still needed if you have signed audio URLs.)
 */

const TRACK_META_TTL_SECONDS = 86400;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const MEMORY_CACHE_MAX_ENTRIES = 5000;
const AUDIO_CACHE_MAX_AGE = 86400;

// Hard timeout on Django calls. Keep well under Cloudflare's 30s background
// task limit so we never hit that.
const DJANGO_TIMEOUT_MS = 5_000;

// Inbound /sync/* requests with timestamps older than this are rejected
// (replay protection).
const SYNC_TIMESTAMP_WINDOW_SECONDS = 300;

// EMA weight for the new latency measurement. Lower = smoother (more weight
// on history). Higher = more reactive (more weight on the latest sample).
// 0.1 means the latest sample contributes 10%, history 90%.
//
// In integer math: new_avg = (old_avg * 9 + new_sample) / 10
const EMA_ALPHA_NUM = 1;   // numerator   (1 part new)
const EMA_ALPHA_DEN = 10;  // denominator (10 parts total → 9 parts old)

/** @type {Map<number, { value: object | null, expiresAt: number }>} */
const memoryCache = new Map();

/** Cached HMAC key. Re-imported per isolate, never per request. */
let _hmacKey = null;

export default {
	/**
	 * @param {Request} request
	 * @param {object} env
	 * @param {ExecutionContext} ctx
	 */
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/sync/")) {
			return handleSync(url, request, env, ctx);
		}

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

	const track = await getTrackMeta(trackId, env, ctx);
	if (!track) {
		return new Response("Not Found", { status: 404 });
	}

	if (isInitialRequest) {
		ctx.waitUntil(
			notifyPlayWithStats(trackId, env).catch((err) => {
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
 * Fire the play notification to Django, then record the outcome in
 * tracks_stats. Each call updates a single row keyed by (track_id, status):
 *   - count incremented
 *   - avg_latency_ms updated as exponential moving average
 *   - last_latency_ms set to this sample
 *   - last_seen updated to now
 *   - first_seen set on insert, untouched on update
 */
async function notifyPlayWithStats(trackId, env) {
	const start = Date.now();
	let status;

	try {
		const path = `/api/internal/track/${trackId}/play/`;
		const ts = Math.floor(Date.now() / 1000).toString();
		const sig = await hmacHex(env, `${path}.${ts}`);

		const res = await fetch(`${env.APP_URL}${path}`, {
			method: "POST",
			headers: {
				"X-Worker-Signature": sig,
				"X-Worker-Timestamp": ts,
			},
			signal: AbortSignal.timeout(DJANGO_TIMEOUT_MS),
		});

		status = res.ok ? "success" : `http_${res.status}`;
	} catch (err) {
		if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
			status = "timeout";
		} else {
			status = "error";
		}
	}

	const latency = Date.now() - start;
	const now = Math.floor(Date.now() / 1000);

	// UPSERT into tracks_stats. On insert: count=1, avg = first sample,
	// first_seen = now. On update: count++, avg = EMA, first_seen left alone.
	//
	// EMA formula in integer SQL:
	//   new_avg = (old_avg * (DEN - NUM) + sample * NUM) / DEN
	//   with NUM=1, DEN=10 → (old * 9 + sample) / 10
	try {
		await env.DB.prepare(
			`INSERT INTO tracks_stats
			    (track_id, status, count, avg_latency_ms, last_latency_ms, first_seen, last_seen)
			 VALUES (?1, ?2, 1, ?3, ?3, ?4, ?4)
			 ON CONFLICT(track_id, status) DO UPDATE SET
			    count           = count + 1,
			    avg_latency_ms  = (avg_latency_ms * ${EMA_ALPHA_DEN - EMA_ALPHA_NUM}
			                       + ?3 * ${EMA_ALPHA_NUM}) / ${EMA_ALPHA_DEN},
			    last_latency_ms = ?3,
			    last_seen       = ?4`,
		)
			.bind(trackId, status, latency, now)
			.run();
	} catch (err) {
		// Telemetry failure must never cascade to user-visible errors.
		console.error("tracks_stats write failed", { trackId, status, err });
	}
}

// ============================================================================
// Track metadata lookup (D1 + cache layers)
// ============================================================================

async function getTrackMeta(trackId, env, ctx) {
	const memHit = memoryCache.get(trackId);
	if (memHit && memHit.expiresAt > Date.now()) return memHit.value;
	if (memHit) memoryCache.delete(trackId);

	const cacheKey = new Request(`https://cache.internal/track-meta/${trackId}`);
	const cache = caches.default;
	const cached = await cache.match(cacheKey);
	if (cached) {
		const meta = await cached.json();
		setMemoryCache(trackId, meta, TRACK_META_TTL_SECONDS * 1000);
		return meta;
	}

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

async function invalidateTrackCache(trackId, ctx) {
	memoryCache.delete(trackId);
	const cacheKey = new Request(`https://cache.internal/track-meta/${trackId}`);
	ctx.waitUntil(caches.default.delete(cacheKey));
}

// ============================================================================
// Sync endpoints (Django → Worker)
// ============================================================================

async function handleSync(url, request, env, ctx) {
	const sigOk = await verifyDjangoSignature(url, request, env);
	if (!sigOk) return new Response("Forbidden", { status: 403 });

	if (url.pathname === "/sync/ping" && request.method === "GET") {
		return new Response("pong", { status: 200 });
	}

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
		   mp3         = excluded.mp3,
		   updated_at  = excluded.updated_at`,
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

async function getKey(env) {
	if (_hmacKey) return _hmacKey;
	_hmacKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.SECRET_SHARED),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
	return _hmacKey;
}

async function hmacHex(env, payload) {
	const key = await getKey(env);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(payload),
	);
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function verifyDjangoSignature(url, request, env) {
	const sig = request.headers.get("X-Worker-Signature");
	const ts = request.headers.get("X-Worker-Timestamp");
	if (!sig || !ts) return false;

	const tsNum = Number(ts);
	if (!Number.isFinite(tsNum)) return false;

	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - tsNum) > SYNC_TIMESTAMP_WINDOW_SECONDS) return false;

	const expected = await hmacHex(env, `${url.pathname}.${ts}`);

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