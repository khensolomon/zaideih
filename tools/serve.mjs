#!/usr/bin/env node
/**
 * Local static server for the web build (Node standard library only).
 *
 * Mirrors production closely enough to catch problems early:
 *   - applies the rules in <dir>/_headers (CSP, caching) the way Cloudflare does
 *   - answers Range requests with 206
 *   - serves index.html for "/"
 *
 *   node tools/serve.mjs                      serve dist/web on http://localhost:8080
 *   node tools/serve.mjs --port 9000 --host 0.0.0.0
 *   node tools/serve.mjs --live               inject a live-reload script (used by tools/dev.mjs)
 *
 * localhost counts as a secure context, so the service worker and storage
 * behave as on https. Other hosts (e.g. a LAN IP from a phone) do not get a
 * service worker over plain http.
 */
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
};

const LIVE_SCRIPT = `// Injected by tools/serve.mjs --live: reloads the page after each rebuild.
const source = new EventSource("/__dev/events");
source.addEventListener("reload", () => location.reload());
source.addEventListener("error-build", (e) => console.error("[dev] build failed:\\n" + e.data));
`;

/** Parses a Cloudflare _headers file into [{ pattern, headers }] rules. */
export function parseHeaders(text) {
	const rules = [];
	let current = null;
	for (const raw of text.split("\n")) {
		if (!raw.trim() || raw.trim().startsWith("#")) continue;
		if (!/^\s/.test(raw)) {
			current = { pattern: raw.trim(), headers: [] };
			rules.push(current);
		} else if (current) {
			const at = raw.indexOf(":");
			if (at > 0) current.headers.push([raw.slice(0, at).trim(), raw.slice(at + 1).trim()]);
		}
	}
	return rules;
}

function matches(pattern, path) {
	if (!pattern.includes("*")) return pattern === path;
	const re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
	return re.test(path);
}

/**
 * Starts the server. Returns { server, reload(message?), url }.
 * `reload` tells connected pages to reload (live mode only).
 */
export async function serve({ dir = "dist/web", port = 8080, host = "127.0.0.1", live = false } = {}) {
	const root = resolve(dir);
	const clients = new Set();

	async function headerRules() {
		try {
			return parseHeaders(await readFile(join(root, "_headers"), "utf8"));
		} catch {
			return [];
		}
	}

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, "http://local");
		if (live && url.pathname === "/__dev/events") {
			res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
			res.write(": connected\n\n");
			clients.add(res);
			req.on("close", () => clients.delete(res));
			return;
		}
		if (live && url.pathname === "/__dev/live.js") {
			res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
			res.end(LIVE_SCRIPT);
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { Allow: "GET, HEAD" }).end();
			return;
		}

		let rel;
		try {
			rel = decodeURIComponent(url.pathname);
		} catch {
			res.writeHead(400).end("Bad Request");
			return;
		}
		const file = resolve(root, `.${rel.endsWith("/") ? `${rel}index.html` : rel}`);
		if (file !== root && !file.startsWith(root + sep)) {
			res.writeHead(404).end("Not Found");
			return;
		}
		let info;
		try {
			info = await stat(file);
			if (!info.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOENT" });
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
			log(req, 404);
			return;
		}

		const headers = { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes" };
		for (const rule of await headerRules()) {
			if (matches(rule.pattern, rel)) for (const [k, v] of rule.headers) headers[k] = v;
		}
		if (live) headers["Cache-Control"] = "no-store";

		if (live && file.endsWith(".html")) {
			const html = (await readFile(file, "utf8")).replace("</body>", '<script src="/__dev/live.js"></script>\n</body>');
			headers["Content-Length"] = Buffer.byteLength(html);
			res.writeHead(200, headers).end(req.method === "HEAD" ? undefined : html);
			log(req, 200);
			return;
		}

		const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
		if (range && (range[1] || range[2])) {
			let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
			let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
			start = Math.max(0, start);
			end = Math.min(end, info.size - 1);
			if (start > end) {
				res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
				return;
			}
			res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": end - start + 1 });
			if (req.method === "HEAD") res.end();
			else createReadStream(file, { start, end }).pipe(res);
			log(req, 206);
			return;
		}
		res.writeHead(200, { ...headers, "Content-Length": info.size });
		if (req.method === "HEAD") res.end();
		else createReadStream(file).pipe(res);
		log(req, 200);
	});

	function log(req, status) {
		if (status >= 400) console.log(`${status} ${req.method} ${req.url}`);
	}

	await new Promise((ok, fail) => {
		server.once("error", (err) => fail(err.code === "EADDRINUSE"
			? new Error(`port ${port} is already in use; pass --port to choose another`)
			: err));
		server.listen(port, host, ok);
	});

	const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host;
	return {
		server,
		url: `http://${shown === "127.0.0.1" ? "localhost" : shown}:${port}/`,
		reload(event = "reload", data = "") {
			for (const c of clients) c.write(`event: ${event}\ndata: ${String(data).replace(/\n/g, "\ndata: ")}\n\n`);
		},
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { values } = parseArgs({
		options: {
			dir: { type: "string", default: "dist/web" },
			port: { type: "string", default: "8080" },
			host: { type: "string", default: "127.0.0.1" },
			live: { type: "boolean", default: false },
		},
		strict: true,
	});
	try {
		await stat(join(values.dir, "index.html"));
	} catch {
		console.error(`error: ${values.dir}/index.html not found. Build first: npm run build`);
		process.exit(1);
	}
	try {
		const { url } = await serve({ ...values, port: Number(values.port) });
		console.log(`serving ${values.dir} at ${url}  (Ctrl+C to stop)`);
	} catch (err) {
		console.error(`error: ${err.message}`);
		process.exit(1);
	}
}
