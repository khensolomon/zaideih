/**
 * Offline audio: downloads tracks into IndexedDB as Blobs.
 *
 * Blobs in IndexedDB are used instead of Cache Storage because <audio> issues
 * HTTP Range requests, which a service worker would have to answer with
 * hand-built 206 responses. Playing a Blob through an object URL avoids that.
 *
 * Downloads require the audio host to send CORS headers
 * (Access-Control-Allow-Origin) for this site's origin.
 */
import { audioUrl } from "../config.js";
import { versionOf } from "./audio-edits.js";
import { db } from "./db.js";
import { emit, notify } from "./store.js";

const state = {
	downloaded: new Set(),
	queue: [],            // track objects waiting
	active: null,         // { track, received, total }
	failed: new Map(),    // track id -> message
	persisted: false,
};

export const offline = {
	state,

	async init() {
		state.downloaded = new Set(await db.keys("audio"));
		await loadMeta();
		if (navigator.storage?.persisted) state.persisted = await navigator.storage.persisted();
		emit("downloads");
	},

	has: (id) => state.downloaded.has(id),
	/** Every song downloaded on this device (ids). */
	downloadedIds: () => [...state.downloaded],
	isPending: (id) => state.active?.track.id === id || state.queue.some((t) => t.id === id),

	async blob(id) {
		const row = await db.get("audio", id);
		return row?.blob ?? null;
	},

	/** Queues tracks for download; already downloaded or queued tracks are skipped. */
	async enqueue(tracks) {
		// Songs shared "listen only" (docs/library.md, "Sharing") are not downloaded.
		const fresh = tracks.filter((t) => !t.listenOnly && !state.downloaded.has(t.id) && !this.isPending(t.id));
		if (!fresh.length) return 0;
		// Ask once for persistent storage so the browser does not evict downloads.
		if (!state.persisted && navigator.storage?.persist) {
			state.persisted = await navigator.storage.persist();
		}
		for (const t of fresh) state.failed.delete(t.id);
		state.queue.push(...fresh);
		emit("downloads");
		pump();
		return fresh.length;
	},

	cancelAll() {
		state.queue = [];
		emit("downloads");
	},

	async remove(ids) {
		const gone = new Set(ids);
		// Waiting ones are not fetched; the one on its way is deleted once it lands (pump).
		state.queue = state.queue.filter((t) => !gone.has(t.id));
		for (const id of ids) {
			if (state.active?.track.id === id) removing.add(id);
			await db.delete("audio", id);
			state.downloaded.delete(id);
			meta.delete(id);
		}
		await saveMeta();
		emit("downloads");
	},

	/**
	 * Downloads again the songs whose downloaded version is not the one now
	 * played (trimmed in the audio studio, or made the original again). The
	 * copy kept plays until the new one has arrived.
	 */
	async refreshVersions(catalog) {
		const stale = [...meta].filter(([id, m]) => m.v !== (versionOf(id) ?? 0)).map(([id]) => catalog.track(id)).filter(Boolean);
		if (!stale.length) return 0;
		state.queue.push(...stale.filter((t) => !this.isPending(t.id)));
		emit("downloads");
		pump();
		return stale.length;
	},

	/** What is downloaded: the count and bytes (from the sizes kept beside the files, not the files), and the device's storage. */
	async usage() {
		let bytes = 0;
		for (const m of meta.values()) bytes += m.size;
		const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
		return { count: meta.size, bytes, quota: estimate?.quota ?? null, used: estimate?.usage ?? null };
	},
};

/*
 * The size and version of each download, kept as one small record (kv
 * "offline-meta"): the usage and the versions to refresh are read from it,
 * never by reading every downloaded song back out of the database.
 */
const META_KEY = "offline-meta";
const meta = new Map();
async function loadMeta() {
	meta.clear();
	let saved = null;
	try { saved = await db.get("kv", META_KEY); } catch (err) { console.warn("the downloads' sizes could not be read", err); }
	for (const [id, v] of Object.entries(saved ?? {})) if (state.downloaded.has(idOf(id))) meta.set(idOf(id), { size: v[0], v: v[1] });
	// Downloads from before this record was kept: read once, then kept.
	const missing = [...state.downloaded].filter((id) => !meta.has(id));
	for (const id of missing) {
		const row = await db.get("audio", id);
		if (row) meta.set(id, { size: row.size, v: row.v ?? 0 });
	}
	if (missing.length || Object.keys(saved ?? {}).length !== meta.size) await saveMeta();
}
// Keys are track ids: numbers for the catalog's songs, "u<n>" for uploads; a record's keys are text.
const idOf = (key) => (/^\d+$/.test(key) ? Number(key) : key);
async function saveMeta() {
	try { await db.put("kv", Object.fromEntries([...meta].map(([id, m]) => [id, [m.size, m.v]])), META_KEY); } catch (err) { console.warn("the downloads' sizes could not be kept", err); }
}

let running = false;
// Removed while downloading: deleted when the download finishes, never kept.
const removing = new Set();

async function pump() {
	if (running) return;
	running = true;
	try {
		while (state.queue.length) {
			const track = state.queue.shift();
			state.active = { track, received: 0, total: 0 };
			emit("downloads");
			try {
				await download(track);
				if (removing.delete(track.id)) { await db.delete("audio", track.id); meta.delete(track.id); await saveMeta(); }
				else state.downloaded.add(track.id);
			} catch (err) {
				removing.delete(track.id);
				state.failed.set(track.id, err.message);
				notify(`Couldn't download "${track.title}": ${err.message}`, { kind: "error" });
				if (err.fatal) {
					state.queue = [];
					break;
				}
			} finally {
				state.active = null;
				emit("downloads");
			}
		}
	} finally {
		running = false;
	}
}

async function download(track) {
	let url;
	try {
		url = audioUrl(track);
	} catch (err) {
		err.fatal = true;
		throw err;
	}
	if (!navigator.onLine) {
		const err = new Error("you are offline.");
		err.fatal = true;
		throw err;
	}
	let res;
	try {
		res = await fetch(url, { mode: "cors", credentials: "omit" });
	} catch {
		throw new Error("the audio server could not be reached, or it does not allow downloads from this site (CORS).");
	}
	if (!res.ok) throw new Error(`the audio server returned ${res.status}.`);

	const total = Number(res.headers.get("content-length")) || 0;
	const type = res.headers.get("content-type") || "audio/mpeg";
	const chunks = [];
	const reader = res.body.getReader();
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.byteLength;
		state.active = { track, received, total };
		emit("download-progress", state.active);
	}
	if (total && received !== total) throw new Error(`download was incomplete (${received} of ${total} bytes).`);
	const blob = new Blob(chunks, { type });
	try {
		// The version downloaded (core/audio-edits.js), to download it again when another becomes the one played.
		const v = versionOf(track.id) ?? 0;
		await db.put("audio", { id: track.id, blob, size: blob.size, type, at: Date.now(), v });
		meta.set(track.id, { size: blob.size, v });
		await saveMeta();
	} catch (err) {
		const quota = err?.name === "QuotaExceededError";
		const e = new Error(quota ? "the device is out of storage space for downloads." : `saving failed (${err.message}).`);
		e.fatal = quota;
		throw e;
	}
}
