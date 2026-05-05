/**
 * Audio Worker — Architecture A (revised).
 *
 * Routes:
 *   GET/HEAD /audio/:id        Stream MP3 from R2. Records the outcome to
 *                              tracks_status. Does NOT call Django.
 *   POST     /sync/track/:id   Receive track upsert from Django (HMAC-signed).
 *   DELETE   /sync/track/:id   Receive track deletion from Django.
 *   GET      /sync/ping        Health check (HMAC-signed).
 *
 * Bindings (configure in wrangler.toml):
 *   DB              D1 database (tracks + tracks_status)
 *   BUCKET          R2 bucket
 *   SECRET_SHARED   Shared secret with Django, only used for verifying
 *                   inbound /sync/* requests.
 *
 * Note: The Worker no longer calls Django. Plays are counted in Django via
 * a separate POST from the SPA. The Worker is now purely:
 *   - a file server (audio streaming from R2 with D1 path lookup)
 *   - a sync receiver (Django pushes track updates here)
 */

const TRACK_META_TTL_SECONDS = 86400;
const NEGATIVE_CACHE_TTL_MS = 30_000;
const MEMORY_CACHE_MAX_ENTRIES = 5000;
const AUDIO_CACHE_MAX_AGE = 86400;

const SYNC_TIMESTAMP_WINDOW_SECONDS = 300;

/** @type {Map<number, { value: object | null, expiresAt: number }>} */
const memoryCache = new Map();

/** Cached HMAC key per isolate. */
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
				ctx.waitUntil(
					recordStatus(env, trackId, "fetch_error").catch(() => {}),
				);
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

	const track = await getTrackMeta(trackId, env, ctx);
	if (!track) {
		// Track ID not in D1. Don't record this — phantom IDs would
		// pollute the table. Cloudflare's analytics shows raw 404 volume
		// if you ever need it.
		return new Response("Not Found", { status: 404 });
	}

	const objectKey = `music/${track.folder_path}/${track.mp3}`;

	let object;
	try {
		object = await env.BUCKET.get(objectKey, parseRangeOption(range));
	} catch (err) {
		console.error("R2 get threw", { trackId, objectKey, err });
		ctx.waitUntil(
			recordStatus(env, trackId, "fetch_error").catch(() => {}),
		);
		return new Response("Internal Server Error", { status: 500 });
	}

	if (!object) {
		// D1 said the track exists, R2 says no file. This is the
		// "orphan" case — most likely a sync drift worth investigating.
		console.error("R2 object missing", { trackId, objectKey });
		ctx.waitUntil(
			recordStatus(env, trackId, "not_found").catch(() => {}),
		);
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

	// Successful fetch — record it. The Worker only sees first-of-cache
	// requests; range continuations and replays come from browser cache
	// and never reach here. So this counts fresh-fetch events, not plays.
	ctx.waitUntil(
		recordStatus(env, trackId, "served").catch(() => {}),
	);

	const body = request.method === "HEAD" ? null : object.body;
	return new Response(body, { headers, status });
}

/**
 * UPSERT into tracks_status. The matching counter increments; the others
 * stay where they are. first_seen is set on insert and never touched again.
 *
 * @param {object} env
 * @param {number} trackId
 * @param {"served" | "not_found" | "fetch_error"} kind
 */
async function recordStatus(env, trackId, kind) {
	// Whitelist kind to defend against future typos.
	if (
		kind !== "served" &&
		kind !== "not_found" &&
		kind !== "fetch_error"
	) {
		return;
	}

	const now = Math.floor(Date.now() / 1000);

	// Build the per-kind INSERT statement. SQLite needs the column name
	// literal — we can't parameterise column names. The whitelist above
	// makes this safe.
	const sql = `
		INSERT INTO tracks_status
		    (track_id, ${kind}, first_seen, last_seen)
		VALUES (?1, 1, ?2, ?2)
		ON CONFLICT(track_id) DO UPDATE SET
		    ${kind}   = ${kind} + 1,
		    last_seen = ?2
	`;

	try {
		await env.DB.prepare(sql).bind(trackId, now).run();
	} catch (err) {
		console.error("tracks_status write failed", { trackId, kind, err });
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
	// Also remove the status row — no point keeping observations for
	// a deleted track. (Optional; remove if you want to keep historical
	// data.)
	await env.DB.prepare("DELETE FROM tracks_status WHERE track_id = ?")
		.bind(trackId).run();
	await invalidateTrackCache(trackId, ctx);
	return new Response(
		JSON.stringify({ id: trackId, ok: true }),
		{ headers: { "Content-Type": "application/json" } },
	);
}

// ============================================================================
// HMAC verification (only inbound /sync/* now — no outbound calls)
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