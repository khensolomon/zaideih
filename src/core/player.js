/**
 * Playback engine: a single HTMLAudioElement driven by a queue of track ids.
 *
 * Source selection is explicit: a downloaded track always plays from its local
 * Blob; otherwise the network URL is used. When neither is possible the player
 * stops with a message instead of skipping silently.
 */
import { AudioSourceError, audioUrl } from "../config.js";
import { creditOf } from "./catalog.js";
import { db } from "./db.js";
import { library } from "./library.js";
import { offline } from "./offline.js";
import { emit, notify } from "./store.js";

const PERSIST_KEY = "player";
const PREVIOUS_RESTART_SECONDS = 3;

const audio = new Audio();
audio.preload = "auto";

let catalog = null;
let objectUrl = null;
let recordedFor = null;
let persistTimer = 0;

const state = {
	queue: [],        // track ids in play order
	original: [],     // unshuffled order
	index: -1,
	shuffle: false,
	repeat: "off",    // "off" | "all" | "one"
	playing: false,
	loading: false,
	error: "",
	context: "",      // label of where playback started, e.g. an album title
};

const current = () => (state.index >= 0 ? catalog.tracks.get(state.queue[state.index]) ?? null : null);

function changed() {
	emit("player", state);
	schedulePersist();
}

function schedulePersist() {
	clearTimeout(persistTimer);
	persistTimer = setTimeout(persist, 800);
}

function persist() {
	const { queue, original, index, shuffle, repeat, context } = state;
	db.put("kv", { queue, original, index, shuffle, repeat, context, position: audio.currentTime || 0 }, PERSIST_KEY)
		.catch((err) => console.error("saving player state failed", err));
}

function shuffled(ids, firstId) {
	const rest = ids.filter((id) => id !== firstId);
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[rest[i], rest[j]] = [rest[j], rest[i]];
	}
	return firstId === undefined ? rest : [firstId, ...rest];
}

function releaseObjectUrl() {
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	objectUrl = null;
}

async function sourceFor(track) {
	if (offline.has(track.id)) {
		const blob = await offline.blob(track.id);
		if (!blob) throw new Error(`The download for "${track.title}" is missing. Download it again.`);
		releaseObjectUrl();
		objectUrl = URL.createObjectURL(blob);
		return objectUrl;
	}
	if (!navigator.onLine) throw new Error(`"${track.title}" isn't downloaded, and the device is offline.`);
	releaseObjectUrl();
	return audioUrl(track);
}

async function load(autoplay, startAt = 0) {
	const track = current();
	if (!track) return;
	state.error = "";
	state.loading = true;
	changed();
	updateMediaSession(track);
	try {
		audio.src = await sourceFor(track);
	} catch (err) {
		stopWithError(err instanceof AudioSourceError || err instanceof Error ? err.message : String(err));
		return;
	}
	if (startAt > 0) {
		audio.addEventListener("loadedmetadata", () => { audio.currentTime = startAt; }, { once: true });
	}
	if (autoplay) {
		try {
			await audio.play();
		} catch (err) {
			if (err.name === "NotAllowedError") {
				state.loading = false;
				state.playing = false;
				changed();
				return;
			}
			if (err.name !== "AbortError") stopWithError(`Playback failed: ${err.message}`);
		}
	} else {
		state.loading = false;
		changed();
	}
}

function stopWithError(message) {
	audio.pause();
	state.playing = false;
	state.loading = false;
	state.error = message;
	changed();
	notify(message, { kind: "error" });
}

const MEDIA_ERRORS = {
	1: "Playback was stopped.",
	2: "A network error interrupted playback.",
	3: "The audio file could not be decoded.",
	// Chromium also reports an unreachable server as code 4, so the message names both causes.
	4: "The audio could not be loaded. Check the connection; the file may also be missing on the server.",
};

audio.addEventListener("playing", () => {
	state.playing = true;
	state.loading = false;
	state.error = "";
	changed();
	const t = current();
	if (t && recordedFor !== t.id) {
		recordedFor = t.id;
		library.recordPlay(t.id).catch((err) => console.error("recording history failed", err));
	}
});
audio.addEventListener("pause", () => { state.playing = false; changed(); persist(); });
audio.addEventListener("waiting", () => { state.loading = true; emit("player", state); });
audio.addEventListener("canplay", () => { state.loading = false; emit("player", state); });
audio.addEventListener("timeupdate", () => {
	emit("time", { position: audio.currentTime, duration: audio.duration || current()?.duration || 0 });
	if ("mediaSession" in navigator && audio.duration && Number.isFinite(audio.duration)) {
		try {
			navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate });
		} catch { /* position state is advisory */ }
	}
});
audio.addEventListener("ended", () => {
	if (state.repeat === "one") {
		audio.currentTime = 0;
		audio.play();
		return;
	}
	if (state.index < state.queue.length - 1) player.jump(state.index + 1);
	else if (state.repeat === "all" && state.queue.length) player.jump(0);
	else { state.playing = false; changed(); }
});
audio.addEventListener("error", () => {
	if (!audio.src) return;
	stopWithError(MEDIA_ERRORS[audio.error?.code] ?? "Playback failed.");
});

function updateMediaSession(track) {
	if (!("mediaSession" in navigator)) return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: track.title,
		artist: creditOf(track.artists),
		album: track.album.title,
		artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
	});
}

function bindMediaSession() {
	if (!("mediaSession" in navigator)) return;
	const ms = navigator.mediaSession;
	const handlers = {
		play: () => player.play(),
		pause: () => player.pause(),
		previoustrack: () => player.previous(),
		nexttrack: () => player.next(),
		seekto: (d) => player.seek(d.seekTime),
		seekbackward: (d) => player.seek(audio.currentTime - (d.seekOffset || 10)),
		seekforward: (d) => player.seek(audio.currentTime + (d.seekOffset || 10)),
	};
	for (const [action, fn] of Object.entries(handlers)) {
		try { ms.setActionHandler(action, fn); } catch { /* unsupported action */ }
	}
}

export const player = {
	state,
	audio,
	current,

	async init(model) {
		catalog = model;
		bindMediaSession();
		const saved = await db.get("kv", PERSIST_KEY);
		if (saved?.queue?.length) {
			// Drop ids that no longer exist in the catalog, and say so.
			const known = (ids) => ids.filter((id) => catalog.tracks.has(id));
			const queue = known(saved.queue);
			if (queue.length !== saved.queue.length) {
				notify(`${saved.queue.length - queue.length} queued track(s) are no longer in the catalog and were removed.`);
			}
			if (queue.length) {
				const prevId = saved.queue[saved.index];
				Object.assign(state, {
					queue,
					original: known(saved.original ?? saved.queue),
					index: Math.max(0, queue.indexOf(prevId)),
					shuffle: !!saved.shuffle,
					repeat: saved.repeat ?? "off",
					context: saved.context ?? "",
				});
				const sameTrack = queue[state.index] === prevId;
				await load(false, sameTrack ? saved.position : 0);
			}
		}
		changed();
	},

	/** Replaces the queue with `ids` and starts at `startId` (or the first). */
	async playList(ids, startId, context = "") {
		if (!ids.length) return;
		state.original = [...ids];
		state.context = context;
		const first = startId ?? (state.shuffle ? undefined : ids[0]);
		state.queue = state.shuffle ? shuffled(ids, first) : [...ids];
		state.index = Math.max(0, state.queue.indexOf(first ?? state.queue[0]));
		await load(true);
	},

	async jump(index) {
		if (index < 0 || index >= state.queue.length) return;
		state.index = index;
		await load(true);
	},

	async play() {
		if (!current()) return;
		if (!audio.src || state.error) return load(true, audio.currentTime);
		try { await audio.play(); } catch (err) { if (err.name !== "AbortError") stopWithError(`Playback failed: ${err.message}`); }
	},

	pause() { audio.pause(); },
	toggle() { return state.playing ? player.pause() : player.play(); },

	next() {
		if (state.index < state.queue.length - 1) return player.jump(state.index + 1);
		if (state.repeat === "all") return player.jump(0);
	},

	previous() {
		if (audio.currentTime > PREVIOUS_RESTART_SECONDS || state.index === 0) { player.seek(0); return; }
		return player.jump(state.index - 1);
	},

	seek(seconds) {
		if (!Number.isFinite(seconds)) return;
		const max = Number.isFinite(audio.duration) ? audio.duration : current()?.duration ?? 0;
		audio.currentTime = Math.min(Math.max(0, seconds), max);
	},

	setShuffle(on) {
		const cur = state.queue[state.index];
		state.shuffle = on;
		state.queue = on ? shuffled(state.original, cur) : [...state.original];
		state.index = Math.max(0, state.queue.indexOf(cur));
		changed();
	},

	cycleRepeat() {
		state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
		changed();
	},

	/** Inserts tracks right after the current one. */
	playNext(ids) {
		if (!state.queue.length) return player.playList(ids);
		const curId = state.queue[state.index];
		const moving = ids.filter((id) => id !== curId);
		const movingSet = new Set(moving);
		state.queue = state.queue.filter((id) => !movingSet.has(id));
		state.index = state.queue.indexOf(curId);
		state.queue.splice(state.index + 1, 0, ...moving);
		const inOriginal = new Set(state.original);
		state.original.push(...moving.filter((id) => !inOriginal.has(id)));
		changed();
	},

	addToQueue(ids) {
		if (!state.queue.length) return player.playList(ids);
		const inQueue = new Set(state.queue);
		const fresh = ids.filter((id) => !inQueue.has(id));
		state.queue.push(...fresh);
		state.original.push(...fresh);
		changed();
	},

	removeAt(index) {
		if (index === state.index) return;
		const [id] = state.queue.splice(index, 1);
		state.original = state.original.filter((x) => x !== id);
		if (index < state.index) state.index -= 1;
		changed();
	},

	move(from, to) {
		if (from === to || to < 0 || to >= state.queue.length) return;
		const curId = state.queue[state.index];
		const [id] = state.queue.splice(from, 1);
		state.queue.splice(to, 0, id);
		state.index = state.queue.indexOf(curId);
		changed();
	},

	clearUpcoming() {
		state.queue = state.queue.slice(0, state.index + 1);
		state.original = [...state.queue];
		changed();
	},
};

addEventListener("pagehide", persist);
