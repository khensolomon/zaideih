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
		if (navigator.storage?.persisted) state.persisted = await navigator.storage.persisted();
		emit("downloads");
	},

	has: (id) => state.downloaded.has(id),
	isPending: (id) => state.active?.track.id === id || state.queue.some((t) => t.id === id),

	async blob(id) {
		const row = await db.get("audio", id);
		return row?.blob ?? null;
	},

	/** Queues tracks for download; already downloaded or queued tracks are skipped. */
	async enqueue(tracks) {
		const fresh = tracks.filter((t) => !state.downloaded.has(t.id) && !this.isPending(t.id));
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
		for (const id of ids) {
			await db.delete("audio", id);
			state.downloaded.delete(id);
		}
		emit("downloads");
	},

	/**
	 * Downloads again the songs whose downloaded version is not the one now
	 * played (trimmed in the audio studio, or made the original again). The
	 * copy kept plays until the new one has arrived.
	 */
	async refreshVersions(catalog) {
		const rows = await db.all("audio");
		const stale = rows.filter((r) => (r.v ?? 0) !== (versionOf(r.id) ?? 0)).map((r) => catalog.track(r.id)).filter(Boolean);
		if (!stale.length) return 0;
		state.queue.push(...stale.filter((t) => !this.isPending(t.id)));
		emit("downloads");
		pump();
		return stale.length;
	},

	async usage() {
		const rows = await db.all("audio");
		const bytes = rows.reduce((sum, r) => sum + r.size, 0);
		const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
		return { count: rows.length, bytes, quota: estimate?.quota ?? null, used: estimate?.usage ?? null };
	},
};

let running = false;

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
				state.downloaded.add(track.id);
			} catch (err) {
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
		await db.put("audio", { id: track.id, blob, size: blob.size, type, at: Date.now(), v: versionOf(track.id) ?? 0 });
	} catch (err) {
		const quota = err?.name === "QuotaExceededError";
		const e = new Error(quota ? "the device is out of storage space for downloads." : `saving failed (${err.message}).`);
		e.fatal = quota;
		throw e;
	}
}
