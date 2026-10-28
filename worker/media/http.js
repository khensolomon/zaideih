/**
 * What every JSON route of the Worker shares: an error with an HTTP status,
 * the JSON answer with CORS, reading a JSON body within a size, the allowed
 * origins (AUTH_ORIGINS, parsed once per isolate) and the preflight answer.
 */

/** An error answered to the caller with `status` and its message; each module's own errors extend it. */
export class HttpError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

/** A JSON answer; `cors` is the allowed origin, "*" for public answers, null for none. */
export function answer(status, body, cors, extra = {}) {
	const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
	if (cors) headers.set("Access-Control-Allow-Origin", cors);
	if (cors && cors !== "*") headers.set("Vary", "Origin");
	return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

/** The request's JSON body as an object (an empty body is {}); over `limit` characters, or not an object, refused. */
export async function readBody(request, limit = 64 * 1024) {
	const text = await request.text();
	if (text.length > limit) throw new HttpError("request body too large", 413);
	try {
		const v = JSON.parse(text || "{}");
		if (v && typeof v === "object" && !Array.isArray(v)) return v;
	} catch { /* below */ }
	throw new HttpError("body must be a JSON object");
}

// The allowed origins, parsed once per AUTH_ORIGINS value (the same for an isolate's life).
let origins = { text: null, set: new Set() };
export function allowedOrigins(env) {
	const text = env.AUTH_ORIGINS ?? "";
	if (origins.text !== text) origins = { text, set: new Set(text.split(",").map((s) => s.trim()).filter(Boolean)) };
	return origins.set;
}

/** The request's origin when it is one of AUTH_ORIGINS, else null. */
export function corsOf(env, request) {
	const origin = request.headers.get("origin");
	return origin && allowedOrigins(env).has(origin) ? origin : null;
}

/** The answer to an OPTIONS preflight: allowed for `cors`, refused for anyone else. */
export function preflight(cors, methods = "GET, POST, OPTIONS", headers = "Authorization, Content-Type") {
	if (!cors) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
	return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": methods, "Access-Control-Allow-Headers": headers, "Access-Control-Max-Age": "86400", Vary: "Origin" } });
}
