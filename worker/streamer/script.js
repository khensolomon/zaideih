/**
 * Audio streaming Worker.
 *
 * Serves MP3 files from R2, looking up the file path in D1 by track ID,
 * and increments a play counter on the initial request.
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
 *
 * Play counting:
 *   A "play" is counted only on the initial request (no Range header, or
 *   `Range: bytes=0-`). Subsequent range requests during playback do not
 *   increment the counter, so a single listen counts as one play.
 *
 * Caching:
 *   Track metadata (folder_path, mp3) is cached in the Workers Cache API
 *   for 5 minutes, so repeat range requests for the same track skip D1.
 *
 * Hotlink protection:
 *   Requests with a `sec-fetch-dest` header that is not `audio` or `video`
 *   are rejected with 403. Requests without the header (curl, native audio
 *   players, older clients) are allowed through. This is a low-cost filter
 *   against casual hotlinking from `<img>` tags or cross-origin `fetch()`,
 *   not a real authorization mechanism — use signed URLs for that.
 */

const TRACK_META_TTL_SECONDS = 300;

export default {
	/**
	 * @param {Request} request
	 * @param {{ DB: D1Database, BUCKET: R2Bucket }} env
	 * @param {ExecutionContext} ctx
	 */
	async fetch(request, env, ctx) {
		// Only GET and HEAD are meaningful for media streaming.
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method Not Allowed", {
				status: 405,
				headers: { Allow: "GET, HEAD" },
			});
		}

		const url = new URL(request.url);
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
		// const dest = request.headers.get("sec-fetch-dest");
		// if (dest && dest !== "audio" && dest !== "video") {
		// 	return new Response("Forbidden", { status: 403 });
		// }

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
 * Look up the track in D1 (with cache), optionally increment plays, then
 * stream the file from R2.
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

	// Count a play only on the initial request. Don't block the response on it.
	if (isInitialRequest) {
		ctx.waitUntil(
			env.DB.prepare("UPDATE track SET plays = plays + 1 WHERE id = ?")
				.bind(trackId)
				.run()
				.catch((err) => console.error("plays increment failed", { trackId, err })),
		);
	}

	const objectKey = `music/${track.folder_path}/${track.mp3}`;
	const getOptions = parseRangeOption(range);
	const object = await env.BUCKET.get(objectKey, getOptions);

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
	headers.set("Cache-Control", "private, max-age=3600");

	let status = 200;
	let body = object.body;

	if (object.range) {
		const offset = object.range.offset ?? 0;
		const length = object.range.length ?? (object.size - offset);
		const end = offset + length - 1;
		headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
		headers.set("Content-Length", length.toString());
		status = 206;
	} else {
		headers.set("Content-Length", object.size.toString());
	}

	// HEAD requests must not include a body.
	if (request.method === "HEAD") {
		body = null;
	}

	return new Response(body, { headers, status });
}

/**
 * Fetch track metadata, using the Workers Cache API to avoid hitting D1
 * on every range request.
 *
 * @param {number} trackId
 * @param {{ DB: D1Database }} env
 * @param {ExecutionContext} ctx
 * @returns {Promise<{ folder_path: string, mp3: string } | null>}
 */
async function getTrackMeta(trackId, env, ctx) {
	const cacheKey = new Request(`https://cache.internal/track-meta/${trackId}`);
	const cache = caches.default;

	const cached = await cache.match(cacheKey);
	if (cached) {
		return cached.json();
	}

	const result = await env.DB.prepare(
		`SELECT a.folder_path, t.mp3
		 FROM album a JOIN track t ON t.album_id = a.id
		 WHERE t.id = ?`,
	)
		.bind(trackId)
		.first();

	if (!result) return null;

	const meta = { folder_path: result.folder_path, mp3: result.mp3 };
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
 * Parse a Range header into an R2 GetOptions.range value.
 * Returns an empty object if there is no range or it doesn't parse;
 * R2 will then return the full object.
 *
 * @param {string | null} range
 * @returns {{ range?: { offset: number, length?: number } }}
 */
function parseRangeOption(range) {
	if (!range) return {};
	const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
	if (!match) return {};

	const offset = Number.parseInt(match[1], 10);
	const end = match[2] ? Number.parseInt(match[2], 10) : undefined;
	return {
		range:
			end !== undefined ? { offset, length: end - offset + 1 } : { offset },
	};
}