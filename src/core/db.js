/**
 * Minimal promise wrapper over IndexedDB.
 *
 * Stores:
 *   kv         arbitrary key/value state (queue, settings, playback position)
 *   likes      liked track ids            key: track id, value: { id, at }
 *   playlists  user playlists             key: auto, value: { id, name, tracks, created, updated }
 *   history    play history               key: auto, value: { track, at }
 *   audio      downloaded audio blobs     key: track id, value: { id, blob, size, type, at }
 */
const DB_NAME = "zaideih";
const DB_VERSION = 1;

// An open that has not answered by then has hung (see below); the app says so instead of waiting for ever.
const OPEN_TIMEOUT_MS = 10_000;

let dbPromise;

/**
 * Safari (WebKit) can leave the first indexedDB.open() of a page without any
 * answer, typically when the page was reached by navigating from another
 * page of the same site; asking for the list of databases until it answers
 * wakes it. Elsewhere databases() answers at once.
 */
async function idbReady() {
	if (typeof indexedDB.databases !== "function") return;
	for (let i = 0; i < 20; i++) {
		const answered = await Promise.race([indexedDB.databases().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 100))]);
		if (answered) return;
	}
}

function open() {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		if (!("indexedDB" in globalThis)) {
			reject(new Error("This browser does not support IndexedDB, which is required for the library and offline audio."));
			return;
		}
		const timer = setTimeout(() => {
			dbPromise = null;
			reject(new Error("The library on this device did not open (the browser's storage did not answer). Close Zaideih completely and open it again."));
		}, OPEN_TIMEOUT_MS);
		const fail = (err) => { clearTimeout(timer); dbPromise = null; reject(err); };
		idbReady().then(() => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				db.createObjectStore("kv");
				db.createObjectStore("likes", { keyPath: "id" });
				db.createObjectStore("playlists", { keyPath: "id", autoIncrement: true });
				const history = db.createObjectStore("history", { keyPath: "key", autoIncrement: true });
				history.createIndex("at", "at");
				db.createObjectStore("audio", { keyPath: "id" });
			};
			req.onsuccess = () => {
				clearTimeout(timer);
				const db = req.result;
				db.onversionchange = () => db.close();
				resolve(db);
			};
			req.onerror = () => fail(req.error);
			req.onblocked = () => fail(new Error("The app database is blocked by another open tab. Close other Zaideih tabs and reload."));
		}, fail);
	});
	return dbPromise;
}

function wrap(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function run(store, mode, fn) {
	const db = await open();
	const tx = db.transaction(store, mode);
	const result = await fn(tx.objectStore(store));
	await new Promise((resolve, reject) => {
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error(`transaction on ${store} aborted`));
	});
	return result;
}

export const db = {
	get: (store, key) => run(store, "readonly", (s) => wrap(s.get(key))),
	all: (store) => run(store, "readonly", (s) => wrap(s.getAll())),
	keys: (store) => run(store, "readonly", (s) => wrap(s.getAllKeys())),
	put: (store, value, key) => run(store, "readwrite", (s) => wrap(key === undefined ? s.put(value) : s.put(value, key))),
	delete: (store, key) => run(store, "readwrite", (s) => wrap(s.delete(key))),
	clear: (store) => run(store, "readwrite", (s) => wrap(s.clear())),

	/** Most recent history entries, newest first. */
	recentHistory: (limit) =>
		run("history", "readonly", (s) => new Promise((resolve, reject) => {
			const out = [];
			const req = s.index("at").openCursor(null, "prev");
			req.onsuccess = () => {
				const cur = req.result;
				if (!cur || out.length >= limit) return resolve(out);
				out.push(cur.value);
				cur.continue();
			};
			req.onerror = () => reject(req.error);
		})),
};
