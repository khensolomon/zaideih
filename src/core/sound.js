/**
 * Sound features for old recordings, applied live while a song plays: the
 * files themselves are never changed.
 *
 *   Skip silence   Quiet tape at the start is passed over at 8x speed with the
 *                  sound muted until the music begins; quiet tape at the end
 *                  moves on to the next song. Where a song's music starts is
 *                  remembered per device, so the next time it starts there.
 *   Clean up       Light: cuts the lowest rumble (air blowing, wind, handling)
 *                  and softens the top hiss band, with gentle hiss reduction.
 *                  Strong: deeper hiss reduction (core/sound-worklet.js).
 *   Even volume    Brings quiet and loud recordings to a similar loudness, with
 *                  a limiter so a boosted song never distorts. The measured
 *                  loudness is remembered per song.
 *   One-sided fix  A recording heard in one ear only (one tape channel lost)
 *                  is played in both.
 *   Equaliser      Bass, voice and treble, ±6 dB.
 *
 * Signal path (Web Audio):
 *   <audio> → meter → [one-sided fix] → rumble cut → hiss shelf → denoise →
 *   bass → voice → treble → level → limiter → mute → analyser → speakers
 * The meter (before any processing) drives the silence, level and one-sided
 * decisions; the analyser (after everything) drives the animations, so they
 * show what is heard.
 *
 * Not available on iPhone and iPad: iOS suspends Web Audio when the screen
 * locks, which would stop playback, so the element plays directly there.
 * Settings are kept per device in localStorage.
 */
import { SOUND_WORKLET_URL } from "../config.js";

export const SETTINGS_KEY = "zaideih.sound";
const MEMORY_KEY = "zaideih.sound.tracks";
const MEMORY_MAX = 3000;
const FFT_SIZE = 512;
export const DEFAULTS = Object.freeze({ skip: true, clean: "light", level: true, balance: true, bass: 0, voice: 0, treble: 0 });
const CLEAN = {
	off: { rumble: 10, shelf: 0, amount: 0 },
	light: { rumble: 75, shelf: -4, amount: 0.5 },
	strong: { rumble: 90, shelf: -3, amount: 1 },
};
const FAST_RATE = 8;

/* ------------------------------------------------------------ decisions ---- */
/* Pure state machines, fed with meter readings, so they can be tested alone. */

/**
 * Silence at the start and end of a song. Feed it each meter reading with
 * update(); it returns what to do: { fast: true } to pass quickly over
 * silence, { play: true, seek } when the music begins, { finish: true } when
 * the song has ended in silence, or null.
 *
 * Tape silence is hiss, not digital silence, so "silence" is judged against
 * each recording's own quiet level, measured in its first half second.
 */
export function createSilenceSkipper() {
	let state = "off";
	let floor = [];
	let threshold = -60;
	let loudSince = 0;
	let loudWindows = 0;
	let quiet = null;  // the recording's quiet level, from its first half second
	let quietFor = 0;
	let music = -30;   // running level of the music, for the end
	let heard = 0;     // seconds of music heard

	return {
		get state() { return state; },
		/** The quiet level measured at the start (dBFS), or null. */
		get quiet() { return quiet; },
		/** A song begins at `position` seconds (0 unless resumed part way). */
		start(position) {
			state = position > 1 ? "play" : "listen";
			floor = [];
			quiet = null;
			loudSince = 0;
			loudWindows = 0;
			quietFor = 0;
			music = -30;
			heard = 0;
		},
		/** The listener moved the position: no automatic skipping at the start any more. */
		seeked() { if (state === "listen" || state === "fast") state = "play"; },
		stop() { state = "off"; },
		/**
		 * @param {number} level  dBFS (louder channel) of the last 50 ms
		 * @param {number} position  seconds into the song
		 * @param {number} duration  seconds, or NaN when unknown
		 * @param {number} step  seconds of the song the reading covers (50 ms × speed)
		 */
		update(level, position, duration, step) {
			if (state === "off") return null;
			if (state === "listen") {
				floor.push(level);
				if (level > -32) { state = "play"; return null; }          // music from the first moment
				if (position < 0.5) return null;
				const sorted = [...floor].sort((a, b) => a - b);
				quiet = sorted[Math.floor(sorted.length / 2)];
				if (quiet > -38) { state = "play"; return null; }          // not quiet enough to be silence
				threshold = Math.max(quiet + 10, -55);
				state = "fast";
				return { fast: true };
			}
			if (state === "fast") {
				if (level > threshold) {
					loudSince += step;
					loudWindows += 1;
					// Music for three readings in a row (a click or a thump on the tape is
					// shorter): it began about that long ago, plus the meter's own delay;
					// start a little before it.
					if (loudWindows >= 3 && loudSince >= 0.4) {
						state = "play";
						return { play: true, seek: Math.max(0, position - loudSince - 1.2) };
					}
				} else { loudSince = 0; loudWindows = 0; }
				if (position > 120) { state = "play"; return { play: true, seek: null }; } // no music found: play as it is
				return null;
			}
			if (state === "play") {
				// Music: clearly above the tape's own noise (measured at the start when it was quiet).
				const musicFloor = quiet === null ? -45 : Math.max(-45, quiet + 12);
				if (level > musicFloor) {
					music += (level - music) * Math.min(1, step / 4);
					heard += step;
				}
				const left = duration - position;
				if (!(left < 45) || position < 30 || heard < 5) { quietFor = 0; return null; }
				// Silent again: back near the tape noise, or far below the music.
				const quietLevel = quiet === null ? Math.max(-52, music - 26) : Math.max(quiet + 6, Math.min(-40, music - 26));
				quietFor = level < quietLevel ? quietFor + step : 0;
				if (quietFor >= 2.5) { state = "off"; return { finish: true }; }
			}
			return null;
		},
	};
}

/**
 * Loudness of the music (dBFS RMS of its louder passages, slowly averaged)
 * and the gain that brings it to TARGET_DB, limited to -6..+10 dB.
 */
export const TARGET_DB = -20;
export function createLeveler() {
	let loud = null;
	let heard = 0;
	return {
		reset(known = null) { loud = known; heard = known === null ? 0 : 30; },
		get loudness() { return loud; },
		get settled() { return heard >= 12; },
		/** `minLevel`: readings below it are tape noise, not music. */
		update(level, step, minLevel = -45) {
			if (level < Math.max(-45, minLevel)) return;
			loud = loud === null ? level : loud + (level - loud) * Math.min(1, step / (heard < 8 ? 2 : 6));
			heard += step;
		},
		gainDb() {
			if (loud === null || heard < 2) return 0;
			// Boost carefully until the song's loudness is known.
			return Math.max(-6, Math.min(heard < 8 ? 3 : 10, TARGET_DB - loud));
		},
	};
}

/**
 * One-sided recordings: "left" or "right" when only that channel carries the
 * music (the other at least 18 dB lower for 3 s of music), otherwise "both".
 */
export function createBalance() {
	let side = "both";
	let left = 0;
	let right = 0;
	return {
		reset() { side = "both"; left = right = 0; },
		get side() { return side; },
		update(l, r, step) {
			if (Math.max(l, r) < -45) return side;
			if (l - r > 18) { left += step; right = 0; } else if (r - l > 18) { right += step; left = 0; } else { left = right = 0; if (side !== "both" && Math.abs(l - r) < 8) side = "both"; }
			if (left >= 3) side = "left";
			if (right >= 3) side = "right";
			return side;
		},
	};
}

/* ------------------------------------------------------------ settings ---- */

export function readSettings(storage = globalThis.localStorage) {
	try {
		const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? "null");
		const out = { ...DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
		if (!(out.clean in CLEAN)) out.clean = DEFAULTS.clean;
		for (const k of ["bass", "voice", "treble"]) out[k] = Math.max(-6, Math.min(6, Number(out[k]) || 0));
		for (const k of ["skip", "level", "balance"]) out[k] = Boolean(out[k]);
		return out;
	} catch {
		return { ...DEFAULTS };
	}
}

function memory() {
	try {
		const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}");
		return m && typeof m === "object" ? m : {};
	} catch {
		return {};
	}
}
function remember(id, patch) {
	try {
		const m = memory();
		const key = String(id);
		const entry = { ...(m[key] ?? {}), ...patch };
		delete m[key];
		m[key] = entry; // newest last; the oldest are dropped first
		const keys = Object.keys(m);
		for (let i = 0; i < keys.length - MEMORY_MAX; i++) delete m[keys[i]];
		localStorage.setItem(MEMORY_KEY, JSON.stringify(m));
	} catch { /* remembering is a convenience: the features still work without it */ }
}

/* ------------------------------------------------------------ the graph ---- */

function isAppleMobile() {
	const ua = navigator.userAgent;
	// iPadOS reports a desktop Mac user agent; touch support tells them apart.
	return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
function unsupportedReason() {
	if (typeof AudioContext !== "function" && typeof webkitAudioContext !== "function") return "This browser has no Web Audio, which these features need.";
	if (isAppleMobile()) return "Not available on iPhone and iPad: iOS stops this processing when the screen locks, which would stop the music.";
	return "";
}

const listeners = new Set();
const status = { skipped: 0, side: "both", gainDb: 0, cleaning: false };

function emitStatus() { for (const fn of listeners) fn({ ...status }); }

let reason = typeof navigator === "undefined" ? "no browser" : unsupportedReason();
let ctx = null;
let nodes = null;
let analyser = null;
let settings = typeof localStorage === "undefined" ? { ...DEFAULTS } : readSettings();
let workletError = "";

const skipper = createSilenceSkipper();
const leveler = createLeveler();
const balance = createBalance();

function ramp(param, value, seconds = 0.08) {
	if (!ctx) return;
	param.cancelScheduledValues(ctx.currentTime);
	param.setTargetAtTime(value, ctx.currentTime, seconds / 3);
}

function applySettings() {
	if (!nodes) return;
	const c = CLEAN[settings.clean];
	ramp(nodes.rumble.frequency, c.rumble);
	ramp(nodes.shelf.gain, c.shelf);
	if (nodes.denoise) ramp(nodes.denoise.parameters.get("amount"), c.amount);
	ramp(nodes.bass.gain, settings.bass);
	ramp(nodes.voice.gain, settings.voice);
	ramp(nodes.treble.gain, settings.treble);
	nodes.limiter.ratio.value = settings.level ? 6 : 1;
	nodes.limiter.threshold.value = settings.level ? -10 : 0;
	applyLevel();
	applyBalance(settings.balance ? balance.side : "both");
	status.cleaning = settings.clean !== "off";
}

function applyLevel() {
	const db = settings.level ? leveler.gainDb() : 0;
	status.gainDb = Math.round(db);
	ramp(nodes.level.gain, 10 ** (db / 20), 1.5);
}

function applyBalance(side) {
	// out L = ll*L + rl*R, out R = lr*L + rr*R
	const m = side === "left" ? [1, 1, 0, 0] : side === "right" ? [0, 0, 1, 1] : [1, 0, 0, 1];
	ramp(nodes.ll.gain, m[0], 0.3); ramp(nodes.lr.gain, m[1], 0.3);
	ramp(nodes.rl.gain, m[2], 0.3); ramp(nodes.rr.gain, m[3], 0.3);
	status.side = side;
}

async function build(audio) {
	const Ctx = window.AudioContext ?? window.webkitAudioContext;
	ctx = new Ctx();
	// The worklet loads first: the element keeps playing to the speakers meanwhile,
	// and is moved into the graph only once every node exists and is connected
	// (an element captured by a source with nowhere to play can stall in Chrome).
	let workletReady = false;
	try {
		if (!SOUND_WORKLET_URL) throw new Error("this build has no sound worklet");
		await ctx.audioWorklet.addModule(SOUND_WORKLET_URL);
		workletReady = true;
	} catch (err) {
		workletError = `Skip silence, even volume, the one-sided fix and strong clean-up are off: ${err.message}`;
		console.error(workletError);
	}
	const n = {};
	n.split = ctx.createChannelSplitter(2);
	n.merge = ctx.createChannelMerger(2);
	for (const k of ["ll", "lr", "rl", "rr"]) n[k] = ctx.createGain();
	n.rumble = Object.assign(ctx.createBiquadFilter(), { type: "highpass" });
	n.rumble.Q.value = 0.7;
	n.shelf = Object.assign(ctx.createBiquadFilter(), { type: "highshelf" });
	n.shelf.frequency.value = 7500;
	n.bass = Object.assign(ctx.createBiquadFilter(), { type: "lowshelf" });
	n.bass.frequency.value = 160;
	n.voice = Object.assign(ctx.createBiquadFilter(), { type: "peaking" });
	n.voice.frequency.value = 1800;
	n.voice.Q.value = 0.8;
	n.treble = Object.assign(ctx.createBiquadFilter(), { type: "highshelf" });
	n.treble.frequency.value = 5000;
	n.level = ctx.createGain();
	n.limiter = ctx.createDynamicsCompressor();
	n.limiter.knee.value = 6;
	n.limiter.attack.value = 0.004;
	n.limiter.release.value = 0.25;
	n.mute = ctx.createGain();
	analyser = ctx.createAnalyser();
	analyser.fftSize = FFT_SIZE;
	analyser.smoothingTimeConstant = 0.78;
	analyser.minDecibels = -88;
	analyser.maxDecibels = -18;

	// The meter and denoiser run in the audio worklet. Without it (an old browser)
	// the filters still work and the decisions that need the meter are off.
	n.meter = workletReady ? new AudioWorkletNode(ctx, "zaideih-meter", { outputChannelCount: [2] }) : null;
	n.denoise = workletReady ? new AudioWorkletNode(ctx, "zaideih-denoise", { outputChannelCount: [2] }) : null;
	if (n.meter) n.meter.port.onmessage = (e) => onMeter(e.data[0], e.data[1]);
	// The meter listens on a side branch above 100 Hz, so rumble and air thumps on
	// the tape do not count as music; it feeds a silent output to keep it running.
	n.detect = Object.assign(ctx.createBiquadFilter(), { type: "highpass" });
	n.detect.frequency.value = 100;
	n.sink = ctx.createGain();
	n.sink.gain.value = 0;

	const source = ctx.createMediaElementSource(audio);
	if (n.meter) { source.connect(n.detect); n.detect.connect(n.meter); n.meter.connect(n.sink); n.sink.connect(ctx.destination); }
	source.connect(n.split);
	n.split.connect(n.ll, 0); n.split.connect(n.lr, 0);
	n.split.connect(n.rl, 1); n.split.connect(n.rr, 1);
	n.ll.connect(n.merge, 0, 0); n.rl.connect(n.merge, 0, 0);
	n.lr.connect(n.merge, 0, 1); n.rr.connect(n.merge, 0, 1);
	const chain = [n.merge, n.rumble, n.shelf, n.denoise, n.bass, n.voice, n.treble, n.level, n.limiter, n.mute, analyser, ctx.destination].filter(Boolean);
	for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
	nodes = n;
	applySettings();
}

/* ------------------------------------------------------------ the player ---- */

let player = null; // { audio, current(), finish() }

function onMeter(l, r) {
	if (!player) return;
	const { audio } = player;
	if (audio.paused) return;
	const step = 0.05 * audio.playbackRate;
	// Test hook: a page that sets globalThis.__soundTrace = [] gets every reading and decision.
	globalThis.__soundTrace?.push([Math.round(l), Math.round(r), skipper.state, Number(audio.currentTime.toFixed(1)), Number(audio.duration?.toFixed?.(1)), balance.side, Math.round(leveler.gainDb())]);
	const level = Math.max(l, r);
	const t = player.current();
	if (settings.balance) {
		const before = balance.side;
		if (balance.update(l, r, step) !== before) { applyBalance(balance.side); emitStatus(); }
	}
	if (skipper.state === "play" || !settings.skip) {
		leveler.update(level, step, skipper.quiet === null ? -45 : skipper.quiet + 10);
		if (settings.level) applyLevel();
		if (leveler.settled && t) remember(t.id, { loud: Math.round(leveler.loudness * 10) / 10 });
	}
	if (!settings.skip) return;
	const action = skipper.update(level, audio.currentTime, audio.duration, step);
	if (!action) return;
	if (action.fast) {
		ramp(nodes.mute.gain, 0, 0.03);
		audio.preservesPitch = false; // muted anyway; saves the time-stretching work
		audio.playbackRate = FAST_RATE;
	} else if (action.play) {
		audio.playbackRate = 1;
		audio.preservesPitch = true;
		if (action.seek !== null) {
			status.skipped = Math.round(action.seek);
			if (t && action.seek > 1.5) remember(t.id, { start: Math.round(action.seek * 10) / 10 });
			// Step back to just before the music began, when that part can be played again
			// (a server without range requests makes a stream unseekable: play on from here).
			if (seekable(audio, action.seek)) audio.currentTime = action.seek;
		}
		ramp(nodes.mute.gain, 1, 0.25);
		emitStatus();
	} else if (action.finish) {
		player.finish();
		// Repeating this song: it starts over at once, so it begins as a new song here.
		if (audio.currentTime < 1.5) onSongStart();
	}
}

function seekable(audio, time) {
	const r = audio.seekable;
	for (let i = 0; i < r.length; i++) if (time >= r.start(i) && time <= r.end(i)) return true;
	return false;
}

function onSongStart() {
	const { audio } = player;
	const t = player.current();
	audio.playbackRate = 1;
	audio.preservesPitch = true;
	if (nodes) ramp(nodes.mute.gain, 1, 0.05);
	const known = t ? memory()[String(t.id)] : null;
	leveler.reset(typeof known?.loud === "number" ? known.loud : null);
	balance.reset();
	status.skipped = 0;
	if (nodes) { applyLevel(); applyBalance("both"); }
	// A song started from the beginning goes straight to where its music was found before.
	if (settings.skip && known?.start > 1.5 && audio.currentTime < 0.5) {
		audio.currentTime = known.start;
		status.skipped = Math.round(known.start);
		skipper.start(known.start);
	} else skipper.start(audio.currentTime);
	emitStatus();
}

export const sound = {
	/** Empty when the features can run; otherwise why not, for the listener. */
	get unavailable() { return reason; },
	/** Why some features are off although the rest run (no audio worklet). */
	get partial() { return workletError; },
	get active() { return !!analyser && ctx?.state === "running"; },
	/** The analyser after all processing, for the animations. */
	get analyser() { return analyser; },
	get settings() { return { ...settings }; },
	get status() { return { ...status }; },
	onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },

	/** Changes settings (partial), keeps them, and applies them at once. */
	set(patch) {
		settings = readSettings({ getItem: () => JSON.stringify({ ...settings, ...patch }) });
		try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* kept for this visit only */ }
		if (!settings.skip && player?.audio.playbackRate !== 1) { player.audio.playbackRate = 1; ramp(nodes.mute.gain, 1, 0.1); skipper.stop(); }
		applySettings();
		emitStatus();
	},
	reset() { this.set({ ...DEFAULTS }); },

	/**
	 * Routes the player's audio element through the graph on its first play (a
	 * user gesture, which also satisfies autoplay rules) and follows its songs.
	 * `finish` ends the current song as if it had played to the end.
	 */
	attach(audio, { current, finish }) {
		player = { audio, current, finish };
		if (reason) return;
		let building = null;
		audio.addEventListener("play", () => {
			if (reason) return;
			if (!building) {
				building = build(audio).catch((err) => {
					reason = `The sound features could not start: ${err.message}`;
					console.error(reason);
				});
			}
			building.then(() => {
				if (ctx?.state === "suspended") ctx.resume().catch((err) => console.error("audio context resume failed", err));
			});
		});
		audio.addEventListener("loadstart", () => { skipper.stop(); audio.playbackRate = 1; audio.preservesPitch = true; });
		// A song begins (from the start, or resumed part way after a reload).
		audio.addEventListener("playing", () => { if (skipper.state === "off") onSongStart(); });
		audio.addEventListener("seeking", () => {
			// Seeks made here (skipping) keep their own state; the listener's end the start-skip.
			if (audio.playbackRate === FAST_RATE) return;
			if (skipper.state === "listen" || skipper.state === "fast") skipper.seeked();
		});
		audio.addEventListener("ended", () => skipper.stop());
	},
};
