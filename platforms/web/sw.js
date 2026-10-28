/**
 * Service worker.
 *
 * Strategy:
 *   shell (html, js, css, fonts, icons)   precached at install, cache-first; a
 *                                          content-hashed file the last release's
 *                                          cache holds is copied, not downloaded
 *                                          again; the Workspace's files are not
 *                                          precached (editors only) but kept once
 *                                          fetched
 *   catalog/meta.json                      network-first; the cached copy offline, or when
 *                                          the network has not answered in META_WAIT_MS
 *   catalog/catalog.<hash>.json            cache-first (immutable, content-hashed)
 *   audio                                  never handled here; downloaded audio
 *                                          lives in IndexedDB and plays from Blobs
 *
 * __PRECACHE__ and __VERSION__ are replaced by build.mjs.
 */
/* global __PRECACHE__, __VERSION__ */
const VERSION = __VERSION__;
const SHELL = `shell-${VERSION}`;
const DATA = "catalog";
const PRECACHE = __PRECACHE__;
// Files named by their content (assets/name.HASH.ext): the same name is the same file, in any release.
const HASHED = /^assets\/[^/]+\.[0-9A-Z]{8}\.[a-z0-9]+$/;

self.addEventListener("install", (event) => {
	event.waitUntil((async () => {
		// addAll fails the whole install if any file is missing, which is intended.
		const isData = (p) => p.startsWith("catalog/");
		const reload = (p) => new Request(p, { cache: "reload" });
		const [shellCache, dataCache] = await Promise.all([caches.open(SHELL), caches.open(DATA)]);
		// A new release changes a few files; the rest, named by their content, are copied from the last release's cache.
		const older = await Promise.all((await caches.keys()).filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.open(k)));
		const fresh = [];
		await Promise.all(PRECACHE.filter((p) => !isData(p)).map(async (p) => {
			if (!HASHED.test(p)) { fresh.push(p); return; }
			for (const c of older) {
				const hit = await c.match(p);
				if (hit) { await shellCache.put(p, hit); return; }
			}
			fresh.push(p);
		}));
		await shellCache.addAll(fresh.map(reload));
		// The catalog is stored at install so the very first visit works offline afterwards.
		await dataCache.addAll(PRECACHE.filter(isData).map(reload));
	})());
});

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k)));
		await self.clients.claim();
	})());
});

self.addEventListener("message", (event) => {
	if (event.data?.type === "skip-waiting") self.skipWaiting();
});

const scope = new URL(self.registration.scope);

// A connection that does not answer in this time is treated as offline for starting the app.
const META_WAIT_MS = 4000;

async function catalogMeta(request) {
	const cache = await caches.open(DATA);
	const network = fetch(request, { cache: "no-cache" }).then(async (res) => {
		if (res.ok) await keepMeta(cache, request, res.clone());
		return res;
	});
	const slow = new Promise((resolve) => setTimeout(() => resolve(null), META_WAIT_MS));
	try {
		const first = await Promise.race([network, slow]);
		if (first) return first;
		// Slow: the saved copy now, and the network's answer is saved when it comes.
		const hit = await cache.match(request);
		if (hit) { network.catch(() => {}); return hit; }
		return await network;
	} catch (err) {
		const hit = await cache.match(request);
		if (hit) return hit;
		throw err;
	}
}

/**
 * A new meta.json is kept only once the catalog file it names is kept too,
 * and older catalog files go only after that: the app always starts offline
 * from a meta whose catalog is there, even when an update was cut short.
 */
async function keepMeta(cache, request, res) {
	try {
		const meta = await res.clone().json();
		if (typeof meta.catalog !== "string" || !/^catalog\.[0-9a-f]+\.json$/.test(meta.catalog)) throw new Error("meta.json names no catalog file");
		const file = new URL(meta.catalog, request.url).href;
		if (!(await cache.match(file))) {
			const got = await fetch(file, { cache: "reload" });
			if (!got.ok) throw new Error(`${meta.catalog}: HTTP ${got.status}`);
			await cache.put(file, got);
		}
		await cache.put(request, res);
		await pruneCatalogs(cache, meta.catalog);
	} catch (err) {
		// The saved meta and its catalog stay as they were; the next start tries again.
		console.warn("the new catalog was not kept for offline use", err);
	}
}

async function pruneCatalogs(cache, keep) {
	for (const req of await cache.keys()) {
		const name = new URL(req.url).pathname.split("/").pop();
		if (/^catalog\.[0-9a-f]+\.json$/.test(name) && name !== keep) await cache.delete(req);
	}
}

async function catalogFile(request) {
	const cache = await caches.open(DATA);
	const hit = await cache.match(request);
	if (hit) return hit;
	const res = await fetch(request);
	if (res.ok) await cache.put(request, res.clone());
	return res;
}

/*
 * Safari refuses a page visit answered with a response that went through a
 * redirect ("Response served by service worker has redirections"), which a
 * cached copy can be (privacy.html is redirected to /privacy by Cloudflare):
 * such a response is answered as a plain copy of itself.
 */
const plain = async (res) => (res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res);

async function shell(request) {
	const cache = await caches.open(SHELL);
	const navigate = request.mode === "navigate";
	// A page with an address of its own (privacy, precached under it) is that page; every other address is the app.
	const hit = await cache.match(request, { ignoreSearch: navigate });
	if (hit) return navigate ? plain(hit) : hit;
	if (navigate) {
		const index = await cache.match(new URL("./", scope).href);
		if (index) return plain(index);
		return plain(await fetch(request));
	}
	const res = await fetch(request);
	// A content-hashed file not precached (the Workspace's): kept once fetched, for the next visit and offline.
	if (res.ok && HASHED.test(new URL(request.url).pathname.slice(scope.pathname.length))) await cache.put(request, res.clone());
	return res;
}

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
	const rel = url.pathname.slice(scope.pathname.length);
	if (rel === "catalog/meta.json") event.respondWith(catalogMeta(request));
	else if (/^catalog\/catalog\.[0-9a-f]+\.json$/.test(rel)) event.respondWith(catalogFile(request));
	else event.respondWith(shell(request));
});
