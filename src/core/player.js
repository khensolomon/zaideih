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
import { KIND_OF_MEDIA_ERROR } from "./diagnostic.js";
import { library } from "./library.js";
import { offline } from "./offline.js";
import { diagnose } from "./probe.js";
import { emit, notify } from "./store.js";
import { sound } from "./sound.js";

const PERSIST_KEY = "player";
const PREVIOUS_RESTART_SECONDS = 3;

const audio = new Audio();
audio.preload = "auto";
// CORS mode is required for the live sound processing and the animations
// (core/sound.js); the audio Worker answers allowed origins with
// Access-Control-Allow-Origin.
audio.crossOrigin = "anonymous";
// Skip silence can end a song early (silent tape at the end), as if it had ended.
sound.attach(audio, { current: () => current(), finish: () => songEnded() });

const VOLUME_KEY = "zaideih.volume";
try {
	const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null");
	if (saved && Number.isFinite(saved.volume)) {
		audio.volume = Math.min(1, Math.max(0, saved.volume));
		audio.muted = !!saved.muted;
	}
} catch { /* volume memory is a per-device convenience only */ }

let catalog = null;
let objectUrl = null;
let recordedFor = null;
/** Track id already retried past the browser cache for the current load. */
let retriedFor = null;
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
	errorCode: "",    // diagnostic code for the last failure (see core/diagnostic.js)
	context: "",      // label of where playback started, e.g. an album title
	sleep: null,      // sleep timer: { at } (ms, wall clock) or { end: true } (at the end of this song)
};

/*
 * Sleep timer: playback fades out and pauses at a time, or stops when the
 * song playing ends. Not kept across visits: a timer set yesterday means
 * nothing today.
 */
let sleepTimer = 0;
let fading = false;
const FADE_MS = 6000;

function sleepNow() {
	clearTimeout(sleepTimer);
	state.sleep = null;
	const from = audio.volume;
	const start = performance.now();
	// A slow fade, then the pause, then the volume as it was for the next listen.
	fading = true;
	const step = () => {
		const k = Math.min(1, (performance.now() - start) / FADE_MS);
		audio.volume = from * (1 - k);
		if (k < 1 && !audio.paused) { requestAnimationFrame(step); return; }
		audio.pause();
		fading = false;
		audio.volume = from;
		notify("Sleep timer: playback stopped");
		changed();
	};
	if (audio.paused) { changed(); return; }
	requestAnimationFrame(step);
}

const current = () => (state.index >= 0 ? catalog.track(state.queue[state.index]) ?? null : null);

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

/** The address to play `track` from: its download (a blob), or the stream. `{ url, blob }`. */
async function sourceFor(track) {
	// An album whose streaming is off (core/holds.js): not even its downloads play.
	if (track.album?.off) throw new AudioSourceError(`"${track.title}" is not available right now.`);
	if (offline.has(track.id)) {
		const blob = await offline.blob(track.id);
		if (!blob) throw new Error(`The download for "${track.title}" is missing. Download it again.`);
		return { url: URL.createObjectURL(blob), blob: true };
	}
	if (!navigator.onLine) throw new Error(`"${track.title}" isn't downloaded, and the device is offline.`);
	return { url: audioUrl(track), blob: false };
}

// Each load is numbered: one overtaken by a newer load (Next tapped again while a
// download was being read) changes nothing, and its blob address is let go.
let loads = 0;
let resumeAt = null;

async function load(autoplay, startAt = 0) {
	const track = current();
	if (!track) return;
	const mine = ++loads;
	// A position waiting from an earlier load is not this song's.
	if (resumeAt) { audio.removeEventListener("loadedmetadata", resumeAt); resumeAt = null; }
	state.error = "";
	state.errorCode = "";
	state.loading = true;
	retriedFor = null;
	changed();
	updateMediaSession(track);
	let source;
	try {
		source = await sourceFor(track);
	} catch (err) {
		if (mine !== loads) return;
		const kind = !navigator.onLine && !offline.has(track.id) ? "offline" : offline.has(track.id) ? "download-missing" : "unknown";
		stopWithError(err instanceof AudioSourceError || err instanceof Error ? err.message : String(err), kind);
		return;
	}
	if (mine !== loads) {
		if (source.blob) URL.revokeObjectURL(source.url);
		return;
	}
	releaseObjectUrl();
	if (source.blob) objectUrl = source.url;
	audio.src = source.url;
	if (startAt > 0) {
		resumeAt = () => { resumeAt = null; audio.currentTime = startAt; };
		audio.addEventListener("loadedmetadata", resumeAt, { once: true });
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
			// NotSupportedError: the media element's error event reports it with a code.
			if (err.name !== "AbortError" && err.name !== "NotSupportedError") stopWithError(`Playback failed: ${err.message}`, "play-rejected");
		}
	} else {
		state.loading = false;
		changed();
	}
}

/**
 * Stops with a message, then probes the failure and attaches a diagnostic
 * code to the state and the notice, for those looking after the catalog to decode
 * (tools/diagnose.mjs or the hidden #/code/<code> page).
 */
function stopWithError(message, kind = "unknown", extra = {}) {
	audio.pause();
	state.playing = false;
	state.loading = false;
	state.error = message;
	changed();
	const track = current();
	if (!track) { notify(message, { kind: "error" }); return; }
	diagnose(track, kind, extra).then((code) => {
		if (current() !== track || state.error !== message) return;
		state.errorCode = code;
		changed();
		notify(message, { kind: "error", code, help: true, playback: true });
	}, (err) => {
		console.error("diagnosing the failure failed", err);
		notify(message, { kind: "error", help: true, playback: true });
	});
}

const MEDIA_ERRORS = {
	1: "Playback was stopped.",
	2: "A network error interrupted playback.",
	3: "The audio file could not be decoded.",
	// Chromium reports an unreachable server, a missing file and a refused saved copy all as code 4.
	4: "This song could not be played. If other songs play, see Help.",
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
/** What happens when a song ends: repeat it, play the next one, or stop. */
function songEnded() {
	if (state.sleep?.end) {
		state.sleep = null;
		audio.pause();
		state.playing = false;
		notify("Sleep timer: stopped at the end of the song");
		changed();
		return;
	}
	if (state.repeat === "one") {
		audio.currentTime = 0;
		audio.play();
		return;
	}
	if (state.index < state.queue.length - 1) player.jump(state.index + 1);
	else if (state.repeat === "all" && state.queue.length) player.jump(0);
	else { audio.pause(); state.playing = false; changed(); }
}
audio.addEventListener("ended", songEnded);
/**
 * The URL with a one-off query, so the browser fetches it again instead of
 * reusing a saved copy. The Worker reads only the path.
 */
function bypassingCache(url) {
	return `${url}${url.includes("?") ? "&" : "?"}fresh=${Date.now().toString(36)}`;
}

audio.addEventListener("error", () => {
	if (!audio.src) return;
	const code = audio.error?.code;
	const track = current();
	// A browser can keep a saved copy of a song from an older server answer
	// (for example one without the CORS header the player now needs) and
	// refuse it. Retry a failed stream once past the browser cache.
	if (track && (code === 2 || code === 4) && !offline.has(track.id) && retriedFor !== track.id && navigator.onLine) {
		retriedFor = track.id;
		const at = audio.currentTime || 0;
		try {
			audio.src = bypassingCache(audioUrl(track));
		} catch (err) {
			stopWithError(err.message, "unknown");
			return;
		}
		if (at > 0) audio.addEventListener("loadedmetadata", () => { audio.currentTime = at; }, { once: true });
		audio.play().catch((err) => {
			if (err.name !== "AbortError" && err.name !== "NotSupportedError") stopWithError(`Playback failed: ${err.message}`, "play-rejected");
		});
		return;
	}
	stopWithError(MEDIA_ERRORS[code] ?? "Playback failed.", KIND_OF_MEDIA_ERROR[code] ?? "unknown", { retried: retriedFor === track?.id });
});

/** Optional (track) => url, or Promise<url>, supplying lock-screen artwork; see player.setArtwork. */
let artworkFor = null;

/*
 * Covers drawn for the lock screen, by track id, the newest last. A car
 * stereo, CarPlay or an iPod connector reads the artwork once, when the song
 * changes; a change made from there (next, previous) happens with the page
 * in the background, where drawing a cover can be slow or held back. So the
 * songs around the playing one are drawn ahead, while the page is in front,
 * and a change sets the metadata once, with its cover, instead of the app
 * icon followed by the cover a moment later (which such devices miss).
 */
const drawn = new Map();
const DRAWN_KEEP = 10;

function keep(track, src) {
	if (!src) return;
	drawn.set(track.id, src);
	while (drawn.size > DRAWN_KEEP) drawn.delete(drawn.keys().next().value);
}

async function artworkOf(track) {
	if (drawn.has(track.id)) return drawn.get(track.id);
	const src = await artworkFor(track);
	keep(track, src);
	return src;
}

/**
 * The artwork now, when it can be had without waiting: drawn ahead, or drawn
 * at once by a provider that answers a URL (now-art.js does); else null.
 */
function artworkNow(track) {
	if (drawn.has(track.id)) return drawn.get(track.id);
	if (!artworkFor) return null;
	try {
		const src = artworkFor(track);
		if (typeof src !== "string") return null;
		keep(track, src);
		return src;
	} catch (err) {
		console.warn("Cover artwork could not be drawn; the app icon is shown instead.", err);
		return null;
	}
}

/** When the main thread is free: an idle moment, or soon where the browser has no idle callback. */
const whenIdle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 50));

let aheadQueued = false;
/**
 * Draws the covers of the songs next to the playing one: one back, three
 * ahead (around the end with repeat all). One cover per idle moment, while
 * the page is in front: a cover takes some 100 ms to draw (several times
 * that on a phone), and four in a row held the page up as a song started.
 */
function drawAhead() {
	if (!artworkFor || !state.queue.length || aheadQueued) return;
	aheadQueued = true;
	const next = () => {
		aheadQueued = false;
		if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
		const n = state.queue.length;
		for (const step of [1, -1, 2, 3]) {
			let i = state.index + step;
			if (i < 0 || i >= n) {
				if (state.repeat !== "all") continue;
				i = (i + n) % n;
			}
			const t = catalog?.track(state.queue[i]);
			if (t && !drawn.has(t.id)) {
				artworkOf(t).catch(() => { /* drawn when it plays */ });
				// The next one in another idle moment.
				aheadQueued = true;
				whenIdle(next);
				return;
			}
		}
	};
	whenIdle(next);
}

function metadataFor(track, src) {
	const art = src
		? [{ src, sizes: "512x512", type: src.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png" }]
		: [{ src: new URL("icons/icon-512.png", document.baseURI).href, sizes: "512x512", type: "image/png" }];
	return new MediaMetadata({ title: track.title, artist: creditOf(track.artists), album: track.album.title, artwork: art });
}

function updateMediaSession(track) {
	if (!("mediaSession" in navigator)) return;
	// In front (a tap in the app), the song starts first and its cover is drawn a moment later; in the
	// background (a car's or the lock screen's buttons) it is drawn now, since such devices read it once.
	if (typeof document !== "undefined" && document.visibilityState === "visible" && !drawn.has(track.id) && artworkFor) {
		navigator.mediaSession.metadata = metadataFor(track, null);
		whenIdle(() => {
			if (state.queue[state.index] !== track.id) return;
			const set = (src) => { if (src && state.queue[state.index] === track.id) navigator.mediaSession.metadata = metadataFor(track, src); };
			const src = artworkNow(track);
			if (src) set(src);
			else artworkOf(track).then(set, (err) => console.warn("Cover artwork could not be drawn; the app icon is shown instead.", err));
		});
		return;
	}
	const ready = artworkNow(track);
	navigator.mediaSession.metadata = metadataFor(track, ready);
	if (ready || !artworkFor) return;
	artworkOf(track).then((src) => {
		if (src && state.queue[state.index] === track.id) navigator.mediaSession.metadata = metadataFor(track, src);
	}, (err) => console.warn("Cover artwork could not be drawn; the app icon is shown instead.", err));
}

// Back in front: the covers ahead are drawn while drawing is quick.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") drawAhead(); });
// Playing: the metadata again (some devices read it only once the new song sounds), and the next covers drawn.
audio.addEventListener("playing", () => {
	const t = current();
	if (!t || !("mediaSession" in navigator)) return;
	const ready = drawn.get(t.id);
	if (ready) navigator.mediaSession.metadata = metadataFor(t, ready);
	drawAhead();
});

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

function saveVolume() {
	try {
		localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: audio.volume, muted: audio.muted }));
	} catch { /* storage unavailable: the setting lasts for this session */ }
}
audio.addEventListener("volumechange", () => {
	// The sleep timer's fade is not the listener's volume.
	if (fading) return;
	saveVolume();
	emit("volume", { volume: audio.volume, muted: audio.muted });
});

export const player = {
	/** Sets the provider of lock-screen and media-key artwork for the playing track. */
	setArtwork(fn) { artworkFor = fn; },
	/** Draws the artwork again (fonts have arrived, say): the drawn ones are forgotten, the playing song's is set anew. */
	refreshArtwork() {
		drawn.clear();
		const t = current();
		if (t) updateMediaSession(t);
	},
	state,
	audio,
	current,

	/** 0..1; unmutes when a volume above zero is chosen. */
	setVolume(value) {
		const v = Math.min(1, Math.max(0, Number(value)));
		if (!Number.isFinite(v)) return;
		audio.volume = v;
		if (v > 0 && audio.muted) audio.muted = false;
	},
	toggleMute() { audio.muted = !audio.muted; },

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
		// Songs of an album whose streaming is off are left out (core/holds.js).
		const playable = ids.filter((id) => !catalog.track(id)?.album?.off);
		if (ids.length && !playable.length) {
			notify(ids.length === 1 ? "This song is not available right now." : "These songs are not available right now.");
			return;
		}
		ids = playable;
		if (!playable.includes(startId)) startId = undefined;
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
		try { await audio.play(); } catch (err) { if (err.name !== "AbortError" && err.name !== "NotSupportedError") stopWithError(`Playback failed: ${err.message}`, "play-rejected"); }
	},

	pause() { audio.pause(); },

	/**
	 * The sleep timer: `minutes` from now, "end" for the end of this song, or
	 * null for none.
	 */
	setSleep(minutes) {
		clearTimeout(sleepTimer);
		if (minutes === null) state.sleep = null;
		else if (minutes === "end") state.sleep = { end: true };
		else {
			if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`a sleep timer needs minutes above 0, not ${minutes}`);
			state.sleep = { at: Date.now() + minutes * 60_000 };
			sleepTimer = setTimeout(sleepNow, minutes * 60_000);
		}
		changed();
	},
	/** Where the song is now, in seconds, exactly (the "time" event comes only a few times a second). */
	get position() { return audio.currentTime || 0; },
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
