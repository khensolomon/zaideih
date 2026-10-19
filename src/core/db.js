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

let dbPromise;

function open() {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		if (!("indexedDB" in globalThis)) {
			reject(new Error("This browser does not support IndexedDB, which is required for the library and offline audio."));
			return;
		}
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
			const db = req.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error("The app database is blocked by another open tab. Close other Zaideih tabs and reload."));
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
