/**
 * Service worker.
 *
 * Strategy:
 *   shell (html, js, css, fonts, icons)   precached at install, cache-first
 *   catalog/meta.json                      network-first, cached copy offline
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

self.addEventListener("install", (event) => {
	event.waitUntil((async () => {
		// addAll fails the whole install if any file is missing, which is intended.
		const isData = (p) => p.startsWith("catalog/");
		const reload = (p) => new Request(p, { cache: "reload" });
		const [shellCache, dataCache] = await Promise.all([caches.open(SHELL), caches.open(DATA)]);
		await shellCache.addAll(PRECACHE.filter((p) => !isData(p)).map(reload));
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

async function catalogMeta(request) {
	const cache = await caches.open(DATA);
	try {
		const res = await fetch(request, { cache: "no-cache" });
		if (res.ok) {
			await cache.put(request, res.clone());
			const meta = await res.clone().json();
			pruneCatalogs(cache, meta.catalog);
		}
		return res;
	} catch (err) {
		const hit = await cache.match(request);
		if (hit) return hit;
		throw err;
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
	return fetch(request);
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
