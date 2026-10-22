/**
 * Play counting. A song counts as played after 10 seconds of listening, or
 * when a song shorter than that plays to the end. The count is sent to the
 * audio Worker (POST /plays) as the track id and the time of the play; no
 * cookie, device id or anything from the library goes with it.
 *
 * - Listening time is measured from playback progress, so seeking forward
 *   does not count and pausing then resuming counts once.
 * - A new play starts when another song loads, when a song ends (repeat one,
 *   or playing it again), and when it is restarted from the beginning.
 * - Plays wait in localStorage until sent: offline plays are sent in one
 *   batch once the device is online again. The queue keeps the newest
 *   MAX_PENDING plays; older ones are dropped with a console warning.
 * - Independent of the Google Analytics choice: nothing identifies the
 *   listener (see the Terms page).
 *
 * Builds set PLAYS_URL (tools/build.mjs); dev builds have counting off.
 */
import { PLAYS_URL } from "../config.js";

export const COUNT_AFTER_SECONDS = 10;
export const MAX_BATCH = 50;
const MAX_PENDING = 500;
const PENDING_KEY = "zaideih.plays";
const SEND_DELAY_MS = 3000;
const RETRY_MS = [30_000, 120_000, 600_000];
/** Answers that mean the batch can never be accepted as it is. */
const REFUSED = new Set([400, 403, 405, 413]);
/** Progress steps larger than this are seeks or stalls, not listening. */
const MAX_STEP_SECONDS = 2;

/**
 * Decides when the current song counts as played. Pure: fed with playback
 * events, returns the track id at the moment a play counts, otherwise null.
 */
export function createPlayTracker({ threshold = COUNT_AFTER_SECONDS } = {}) {
	let trackId = null;
	let listened = 0;
	let last = 0;
	let counted = false;

	const reset = (id) => { trackId = id; listened = 0; last = 0; counted = false; };

	return {
		/** A song (re)loaded: a new play begins. */
		load(id) { reset(id); },
		/** The position jumped (seek); restarting from the start begins a new play. */
		seek(position) {
			if (counted && position < 1) reset(trackId);
			last = position;
		},
		/** Playback progressed to `position` (seconds) of a song `duration` long. */
		time(position, playing, duration) {
			const step = position - last;
			last = position;
			if (!playing || trackId === null || counted || step <= 0 || step > MAX_STEP_SECONDS) return null;
			listened += step;
			// A song shorter than the threshold counts when nearly all of it has played.
			const need = duration > 0 && duration < threshold ? duration * 0.9 : threshold;
			if (listened < need) return null;
			counted = true;
			return trackId;
		},
		/** The song ended: a short song that was not yet counted counts now; a replay is a new play. */
		ended() {
			const id = !counted && listened > 0 ? trackId : null;
			reset(trackId);
			return id;
		},
	};
}

/**
 * The queue of plays waiting to be sent, with sending and retries.
 * `storage`, `send` and `now` are injectable for tests.
 */
export function createPlayQueue({
	url = PLAYS_URL,
	storage = globalThis.localStorage,
	send = (body, { keepalive }) => fetch(url, { method: "POST", body, keepalive, headers: { "Content-Type": "text/plain" }, credentials: "omit" }),
	now = () => Date.now(),
	online = () => globalThis.navigator?.onLine !== false,
} = {}) {
	let timer = 0;
	let sending = false;
	let failures = 0;

	const read = () => {
		try {
			const list = JSON.parse(storage.getItem(PENDING_KEY) ?? "[]");
			return Array.isArray(list) ? list.filter((p) => Array.isArray(p) && Number.isSafeInteger(p[0]) && Number.isSafeInteger(p[1])) : [];
		} catch {
			return [];
		}
	};
	const write = (list) => {
		try {
			if (list.length) storage.setItem(PENDING_KEY, JSON.stringify(list));
			else storage.removeItem(PENDING_KEY);
		} catch (err) {
			console.warn("play counts could not be saved for sending later", err);
		}
	};
	const removeSent = (sent) => {
		// Plays may have been added while the batch was out; remove only the sent ones.
		const list = read();
		for (const p of sent) {
			const i = list.findIndex((q) => q[0] === p[0] && q[1] === p[1]);
			if (i >= 0) list.splice(i, 1);
		}
		write(list);
	};

	const schedule = (ms) => {
		clearTimeout(timer);
		timer = setTimeout(() => queue.flush(), ms);
	};

	const queue = {
		get enabled() { return Boolean(url); },
		pending: () => read(),

		/** Records one play of a track, now, and schedules sending. */
		add(trackId) {
			if (!url) return;
			const list = read();
			list.push([trackId, Math.floor(now() / 1000)]);
			if (list.length > MAX_PENDING) {
				const dropped = list.splice(0, list.length - MAX_PENDING);
				console.warn(`${dropped.length} unsent play count(s) were dropped; at most ${MAX_PENDING} are kept while offline`);
			}
			write(list);
			schedule(SEND_DELAY_MS);
		},

		/**
		 * Sends waiting plays, one batch at a time. `leaving`: the page is being
		 * hidden or closed, so the batch is sent with keepalive and taken off the
		 * queue before the answer, which may never arrive.
		 */
		async flush({ leaving = false } = {}) {
			clearTimeout(timer);
			if (!url || sending || !online()) return;
			const batch = read().slice(0, MAX_BATCH);
			if (!batch.length) return;
			sending = true;
			if (leaving) removeSent(batch);
			let res = null;
			try {
				res = await send(JSON.stringify({ v: 1, plays: batch }), { keepalive: leaving });
			} catch (err) {
				res = null;
				if (!leaving) console.warn("sending play counts failed; retrying later", err);
			} finally {
				sending = false;
			}
			if (leaving) return;
			if (res && res.ok) {
				failures = 0;
				removeSent(batch);
				const body = await res.json().catch(() => null);
				if (body?.rejected?.length) console.warn("some play counts were not accepted", body.rejected);
				if (read().length) schedule(0);
				return;
			}
			if (res && REFUSED.has(res.status)) {
				// The server will never accept this batch (malformed, refused origin):
				// drop it so it does not block the queue, and say so. Anything else
				// (offline, 404 while a new Worker rolls out, 429, 5xx) is retried.
				console.warn(`play counts refused with HTTP ${res.status}; ${batch.length} dropped`, await res.text().catch(() => ""));
				removeSent(batch);
				if (read().length) schedule(SEND_DELAY_MS);
				return;
			}
			schedule(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
		},
	};
	return queue;
}

/** Wires counting to the player's audio element. Does nothing when this build has counting off. */
export function startPlayCounting(audio, currentTrack, queue = createPlayQueue()) {
	if (!queue.enabled) return queue;
	const tracker = createPlayTracker();
	// Only catalog songs count; uploads (text ids, src/core/uploads.js) never do.
	const count = (id) => { if (typeof id === "number") queue.add(id); };
	audio.addEventListener("loadstart", () => tracker.load(currentTrack()?.id ?? null));
	audio.addEventListener("seeking", () => tracker.seek(audio.currentTime));
	// Passing quickly over silence (core/sound.js) is not listening.
	audio.addEventListener("timeupdate", () => count(tracker.time(audio.currentTime, !audio.paused && audio.playbackRate <= 1.5, audio.duration || currentTrack()?.duration || 0)));
	audio.addEventListener("ended", () => count(tracker.ended()));
	addEventListener("online", () => queue.flush());
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") queue.flush({ leaving: true }); });
	queue.flush();
	return queue;
}
