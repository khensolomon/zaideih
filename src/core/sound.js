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
 *   Equaliser      Ten bands (31 Hz to 16 kHz), ±12 dB each, with presets
 *                  for common needs (bass, voice, old tape, small speakers…).
 *                  Boosts lower the level first (headroom), and a limiter
 *                  stops any remaining peak from distorting.
 *
 * Signal path (Web Audio):
 *   <audio> → meter → [one-sided fix] → rumble cut → hiss shelf → denoise →
 *   headroom → 10 equaliser bands → level → limiter → mute → analyser → speakers
 * The meter (before any processing) drives the silence, level and one-sided
 * decisions; the analyser (after everything) drives the animations, so they
 * show what is heard.
 *
 * Not available on iPhone and iPad: iOS suspends Web Audio when the screen
 * locks, which would stop playback, so the element plays directly there.
 * Settings are kept per device in localStorage.
 */
import { versionOf } from "./audio-edits.js";
import { SOUND_WORKLET_URL } from "../config.js";

export const SETTINGS_KEY = "zaideih.sound";
const MEMORY_KEY = "zaideih.sound.tracks";
const MEMORY_MAX = 3000;
const FFT_SIZE = 512;
/** Equaliser band centres (Hz): one per octave; the lowest is a low shelf, the highest a high shelf. */
export const EQ_BANDS = Object.freeze([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
export const EQ_LIMIT = 12;
const flat = () => EQ_BANDS.map(() => 0);
/** Presets (dB per band, 31 Hz … 16 kHz). "custom" is whatever the listener set by hand. */
export const PRESETS = Object.freeze([
	{ id: "flat", name: "Flat", gains: flat() },
	{ id: "bass", name: "Bass boost", gains: [6, 7, 6, 3, 1, 0, 0, 0, 0, 0] },
	{ id: "voice", name: "Clear voice", gains: [-4, -3, -1, 0, 2, 4, 5, 4, 2, 0] },
	{ id: "tape", name: "Old tape", gains: [-6, -2, 2, 2, 1, 1, 3, 4, 1, -3] },
	{ id: "warm", name: "Warm", gains: [2, 3, 4, 2, 1, 0, -1, -2, -3, -4] },
	{ id: "bright", name: "Bright", gains: [0, 0, 0, -1, 0, 1, 2, 4, 6, 7] },
	{ id: "loud", name: "Loudness", gains: [6, 5, 3, 0, -1, -1, 0, 2, 4, 5] },
	{ id: "small", name: "Small speakers", gains: [-8, -6, 0, 3, 4, 3, 2, 1, 0, -1] },
	{ id: "choir", name: "Choir and hall", gains: [-2, 0, 1, 2, 1, 0, 2, 3, 2, 1] },
]);
export const DEFAULTS = Object.freeze({ skip: true, clean: "light", level: true, balance: true, preset: "flat", eq: Object.freeze(flat()) });
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
						return { play: true, seek: Math.max(0, position - loudSince - 0.9) };
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
		const s = saved && typeof saved === "object" ? saved : {};
		const out = { ...DEFAULTS, ...s };
		if (!(out.clean in CLEAN)) out.clean = DEFAULTS.clean;
		for (const k of ["skip", "level", "balance"]) out[k] = Boolean(out[k]);
		let eq = Array.isArray(s.eq) && s.eq.length === EQ_BANDS.length ? s.eq : null;
		// Settings from the three-band equaliser (26.10.21.8): bass, voice and treble.
		if (!eq && ["bass", "voice", "treble"].some((k) => typeof s[k] === "number")) {
			const [b, v, t] = ["bass", "voice", "treble"].map((k) => Number(s[k]) || 0);
			eq = [b, b, b, b / 2, v / 2, v, v, (v + t) / 2, t, t];
			out.preset = "custom";
		}
		out.eq = (eq ?? flat()).map((g) => Math.max(-EQ_LIMIT, Math.min(EQ_LIMIT, Math.round((Number(g) || 0) * 2) / 2)));
		if (out.preset !== "custom" && !PRESETS.some((p) => p.id === out.preset)) out.preset = "custom";
		delete out.bass; delete out.voice; delete out.treble;
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
/**
 * What is remembered of a song is of the recording heard: a song trimmed in
 * the audio studio (core/audio-edits.js) starts elsewhere, so each version
 * has its own (the original keeps the song's id alone).
 */
const memoryKey = (t) => (versionOf(t.id) ? `${t.id}v${versionOf(t.id)}` : String(t.id));
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
	ramp(nodes.rumble.frequency, rumbleCut(settings));
	ramp(nodes.shelf.gain, c.shelf);
	if (nodes.denoise) ramp(nodes.denoise.parameters.get("amount"), c.amount);
	settings.eq.forEach((g, i) => ramp(nodes.eq[i].gain, g));
	// Headroom: boosting bands lowers the whole level first, so peaks have room.
	ramp(nodes.headroom.gain, 10 ** (-headroomDb(settings.eq) / 20));
	// With even volume the limiter also catches boosted songs; otherwise it only stops clipping.
	nodes.limiter.threshold.value = settings.level ? -10 : -1.5;
	nodes.limiter.ratio.value = settings.level ? 6 : 20;
	applyLevel();
	applyBalance(settings.balance ? balance.side : "both");
	status.cleaning = settings.clean !== "off";
}

/**
 * The rumble cut's frequency: Clean up's, moved down to 45 Hz when the two
 * lowest equaliser bands are boosted, so a bass boost is heard.
 */
export function rumbleCut(s) {
	const f = CLEAN[s.clean].rumble;
	return Math.max(s.eq[0], s.eq[1]) > 2 ? Math.min(f, 45) : f;
}

/** dB to lower the level by before the equaliser: most of the largest boost. */
export function headroomDb(eq) {
	return Math.max(0, ...eq) * 0.7;
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
	n.headroom = ctx.createGain();
	n.eq = EQ_BANDS.map((f, i) => {
		const last = i === EQ_BANDS.length - 1;
		const band = Object.assign(ctx.createBiquadFilter(), { type: i === 0 ? "lowshelf" : last ? "highshelf" : "peaking" });
		// The shelves sit inside the audible range so they are heard: 45 Hz and 11 kHz.
		band.frequency.value = i === 0 ? 45 : last ? 11000 : f;
		band.Q.value = 1.4; // about one octave wide
		return band;
	});
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
	const chain = [n.merge, n.rumble, n.shelf, n.denoise, n.headroom, ...n.eq, n.level, n.limiter, n.mute, analyser, ctx.destination].filter(Boolean);
	for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
	nodes = n;
	if (globalThis.__soundTrace) globalThis.__soundNodes = n; // test hook, see __soundTrace
	applySettings();
}

/* ------------------------------------------------------------ the player ---- */

let player = null; // { audio, current(), finish() }

const REMEMBER_EVERY_MS = 5000;
const kept = { key: "", loud: null, at: 0 };

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
		// Written when the remembered loudness changes by a tenth of a dB, and at most every few
		// seconds: the meter reads 20 times a second, the memory holds thousands of songs.
		if (leveler.settled && t) {
			const key = memoryKey(t);
			const loud = Math.round(leveler.loudness * 10) / 10;
			const nowMs = performance.now();
			if (key !== kept.key || (loud !== kept.loud && nowMs - kept.at >= REMEMBER_EVERY_MS)) {
				remember(key, { loud });
				kept.key = key; kept.loud = loud; kept.at = nowMs;
			}
		}
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
			if (t && action.seek > 1.5) remember(memoryKey(t), { start: Math.round(action.seek * 10) / 10 });
			// Step back to just before the music began, when that part can be played again
			// (a server without range requests makes a stream unseekable: play on from here).
			if (seekable(audio, action.seek)) audio.currentTime = action.seek;
		}
		// Stay muted until the step back has happened: unmuting at once let the
		// sound at the detection point (the music's first beat) through for a
		// moment before the jump, heard as a kick at the start of every song.
		unmuteWhenSettled(audio, 0.3);
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

/** Mutes at once (no ramp): used between songs and before a jump. */
function muteNow() {
	if (!nodes) return;
	const g = nodes.mute.gain;
	g.cancelScheduledValues(ctx.currentTime);
	g.setValueAtTime(0, ctx.currentTime);
}

/**
 * Fades the sound in once the element has finished any seek, plus a little
 * for the samples already on their way through the graph (the denoiser alone
 * holds 23 ms), so nothing from before a jump is heard.
 */
function unmuteWhenSettled(audio, fade) {
	if (!nodes) return;
	const go = () => {
		const g = nodes.mute.gain;
		const at = ctx.currentTime + 0.06 + (ctx.baseLatency || 0);
		g.cancelScheduledValues(ctx.currentTime);
		g.setValueAtTime(0, ctx.currentTime);
		g.setTargetAtTime(1, at, fade / 3);
	};
	if (audio.seeking) audio.addEventListener("seeked", go, { once: true });
	else go();
}

/** The next song's remembered loudness, applied at once so it does not start at the last song's volume. */
function prepareSong() {
	const t = player?.current();
	const known = t ? memory()[memoryKey(t)] : null;
	leveler.reset(typeof known?.loud === "number" ? known.loud : null);
	balance.reset();
	if (!nodes) return known;
	const db = settings.level ? leveler.gainDb() : 0;
	nodes.level.gain.cancelScheduledValues(ctx.currentTime);
	nodes.level.gain.setValueAtTime(10 ** (db / 20), ctx.currentTime);
	status.gainDb = Math.round(db);
	applyBalance("both");
	return known;
}

function onSongStart() {
	const { audio } = player;
	audio.playbackRate = 1;
	audio.preservesPitch = true;
	const known = prepareSong();
	status.skipped = 0;
	// A song started from the beginning goes straight to where its music was found before.
	if (settings.skip && known?.start > 1.5 && audio.currentTime < 0.5) {
		muteNow();
		audio.currentTime = known.start;
		status.skipped = Math.round(known.start);
		skipper.start(known.start);
		unmuteWhenSettled(audio, 0.3);
	} else {
		skipper.start(audio.currentTime);
		unmuteWhenSettled(audio, 0.08);
	}
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

	/** Changes settings (partial), keeps them, and applies them at once. A preset id sets its gains. */
	set(patch) {
		if (patch.preset && patch.preset !== "custom" && !patch.eq) patch = { ...patch, eq: PRESETS.find((p) => p.id === patch.preset)?.gains ?? flat() };
		settings = readSettings({ getItem: () => JSON.stringify({ ...settings, ...patch }) });
		try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* kept for this visit only */ }
		if (!settings.skip && player?.audio.playbackRate !== 1) { player.audio.playbackRate = 1; unmuteWhenSettled(player.audio, 0.1); skipper.stop(); }
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
		// Between songs: silent until the next one starts, at its own volume.
		audio.addEventListener("loadstart", () => { skipper.stop(); audio.playbackRate = 1; audio.preservesPitch = true; muteNow(); prepareSong(); });
		// A song begins (from the start, or resumed part way after a reload).
		audio.addEventListener("playing", () => { if (skipper.state === "off") onSongStart(); });
		audio.addEventListener("seeking", () => {
			// Seeks made here (skipping) keep their own state; the listener's end the start-skip.
			if (audio.playbackRate === FAST_RATE) return;
			if (skipper.state === "listen" || skipper.state === "fast") skipper.seeked();
		});
		audio.addEventListener("ended", () => skipper.stop());
		// Paused for a while: the audio graph rests (no audio thread, less battery); "play" resumes it above.
		let rest = 0;
		const restSoon = () => {
			clearTimeout(rest);
			rest = setTimeout(() => {
				if (audio.paused && ctx?.state === "running") ctx.suspend().catch((err) => console.warn("audio context suspend failed", err));
			}, 3000);
		};
		audio.addEventListener("pause", restSoon);
		audio.addEventListener("ended", restSoon);
		audio.addEventListener("play", () => clearTimeout(rest));
	},
};
