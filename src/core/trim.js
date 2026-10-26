/**
 * Where a recording's music starts and ends, and what is safe to cut, for
 * the audio studio (docs/audio-studio.md). The studio shows the suggestion;
 * a person decides.
 *
 * Tape is never digitally silent: before and after the music there is hiss,
 * hum, wind or handling noise, so "quiet" is judged against the recording's
 * own noise floor (measured at its two ends, where the tape runs), not
 * against zero.
 *
 * The suggestion is cautious. Only steady tape noise is cut: anything
 * clearly louder than the tape (6 dB above the floor for 0.2 s or more,
 * a click excepted) is sound, and the cut keeps 1 s before the first sound
 * and 2 s after the last. Sound that is quieter than the music and lies
 * apart from it (a hum, a count-in, a voice, a long fade) is kept, and the
 * suggestion says "check" so a person listens; so is anything to be cut that
 * is not steady, as tape noise is. Where no steady noise is long enough to
 * cut, it says so and cuts nothing.
 */

export const WINDOW_MS = 20;
/** Sound: this far (dB) above the tape's floor… */
export const SOUND_DB = 6;
/** …for at least this long, so a click or a bump is not taken for it. */
export const MIN_SOUND_MS = 200;
/** The music: this far above the floor, and no more than MUSIC_BELOW_DB under the recording's loud parts… */
export const ABOVE_DB = 12;
export const MUSIC_BELOW_DB = 20;
/** …for most of this long. */
export const HOLD_MS = 600;
/** Tape kept before the first sound, and after the last (a note dying away). */
export const LEAD_MS = 1000;
export const TAIL_MS = 2000;
/** A cut shorter than this is not worth making. */
export const MIN_CUT_MS = 300;
/** Sound going on this long after the music is no longer its last note dying away: it is checked. */
export const DECAY_MS = 3000;

/**
 * The level of each window (dB, full scale), from the channels' samples
 * (Float32Arrays at `rate`). Silence is -120.
 */
export function envelope(channels, rate, windowMs = WINDOW_MS) {
	const size = Math.max(1, Math.round((rate * windowMs) / 1000));
	const n = Math.ceil(channels[0].length / size);
	const out = new Float32Array(n);
	for (let w = 0; w < n; w++) {
		let sum = 0;
		let count = 0;
		const from = w * size;
		const to = Math.min(channels[0].length, from + size);
		for (const ch of channels) {
			for (let i = from; i < to; i++) sum += ch[i] * ch[i];
			count += to - from;
		}
		const rms = Math.sqrt(sum / Math.max(1, count));
		out[w] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
	}
	return out;
}

/** The value at fraction `q` (0..1) of the sorted levels. */
function quantile(levels, q) {
	const sorted = Float32Array.from(levels).sort();
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

/** Each end of a recording, where the tape's own noise is measured. */
export const EDGE_MS = 3000;
/** Tape noise is steady: across a stretch to be cut, its levels spread no more than this (dB, tenth to ninetieth). */
export const STEADY_DB = 9;

/**
 * The tape's floor: the quieter of the two ends' median levels (the tape
 * runs there, before and after the music) and the quietest 2 % of the
 * recording, digital silence left out, and never below near-silence. Hiss is
 * usually a few seconds of a song of minutes, so a share of the whole
 * recording alone would find quiet music instead.
 */
export function floorOf(levels, windowMs = WINDOW_MS) {
	const real = levels.filter((l) => l > -100);
	if (!real.length) return -90;
	const k = Math.max(1, Math.round(EDGE_MS / windowMs));
	const ends = [real.slice(0, k), real.slice(-k)].map((part) => quantile(part, 0.5));
	return Math.max(-90, Math.min(...ends, quantile(real, 0.02)));
}

/** Whether the levels between two times are steady, as tape noise is. */
function steady(levels, fromMs, toMs, windowMs) {
	const part = levels.slice(Math.floor(fromMs / windowMs), Math.ceil(toMs / windowMs)).filter((l) => l > -100);
	return part.length < 2 || quantile(part, 0.9) - quantile(part, 0.1) <= STEADY_DB;
}

/**
 * Which windows hold sound (1) and which only tape (0): the median level of
 * the 7 windows around each is SOUND_DB above `floorDb` (so a click of a
 * window or two does not count), in runs of MIN_SOUND_MS or more.
 */
export function soundMask(levels, floorDb, windowMs = WINDOW_MS) {
	const n = levels.length;
	const mask = new Uint8Array(n);
	const above = floorDb + SOUND_DB;
	const near = new Float32Array(7);
	for (let w = 0; w < n; w++) {
		let k = 0;
		for (let j = w - 3; j <= w + 3; j++) near[k++] = levels[Math.min(n - 1, Math.max(0, j))];
		near.sort();
		mask[w] = near[3] >= above ? 1 : 0;
	}
	const run = Math.max(1, Math.round(MIN_SOUND_MS / windowMs));
	for (let w = 0; w < n;) {
		if (!mask[w]) { w++; continue; }
		let e = w;
		while (e < n && mask[e]) e++;
		if (e - w < run) mask.fill(0, w, e);
		w = e;
	}
	return mask;
}

/**
 * The sound between two times: [firstMs, lastMs] of the sound windows wholly
 * inside [fromMs, toMs], or null when there is only tape there.
 */
export function soundIn(mask, fromMs, toMs, windowMs = WINDOW_MS) {
	const a = Math.max(0, Math.ceil(fromMs / windowMs));
	const b = Math.min(mask.length, Math.floor(toMs / windowMs));
	let first = -1;
	let last = -1;
	for (let w = a; w < b; w++) if (mask[w]) { if (first < 0) first = w; last = w; }
	return first < 0 ? null : [first * windowMs, (last + 1) * windowMs];
}

/**
 * The suggested cut:
 *
 *   { verdict, startMs, endMs, floorDb, musicDb,
 *     musicStartMs, musicEndMs, soundStartMs, soundEndMs,
 *     quiet: { start: [fromMs, toMs] | null, end: [fromMs, toMs] | null } }
 *
 * `verdict` is "safe" (only steady tape noise is cut), "check" (a quiet sound
 * apart from the music is kept: listen) or "none" (nothing long enough to cut
 * safely; the whole recording). Without music (all tape, or all quiet) the
 * whole recording, "none".
 */
export function suggestTrim(levels, windowMs = WINDOW_MS) {
	const n = levels.length;
	const totalMs = n * windowMs;
	const whole = (floorDb = -120, musicDb = -120) => ({ verdict: "none", startMs: 0, endMs: totalMs, floorDb, musicDb, musicStartMs: null, musicEndMs: null, soundStartMs: null, soundEndMs: null, quiet: { start: null, end: null } });
	if (!n) return whole();
	const floorDb = floorOf(levels);
	const musicDb = Math.max(floorDb + ABOVE_DB, quantile(levels, 0.9) - MUSIC_BELOW_DB);
	const hold = Math.max(1, Math.round(HOLD_MS / windowMs));
	const loud = (w) => levels[w] >= musicDb;
	// A stretch counts as music when most of its windows (80 %) are loud.
	const stretch = (from) => {
		let k = 0;
		for (let w = from; w < from + hold && w < n; w++) if (loud(w)) k++;
		return k >= hold * 0.8;
	};
	let musicFirst = -1;
	for (let w = 0; w + hold <= n; w++) if (loud(w) && stretch(w)) { musicFirst = w; break; }
	let musicLast = -1;
	for (let w = n - hold; w >= 0; w--) if (loud(w + hold - 1) && stretch(w)) { musicLast = w + hold - 1; break; }
	if (musicFirst < 0 || musicLast < musicFirst) return whole(floorDb, musicDb);

	const mask = soundMask(levels, floorDb, windowMs);
	let soundFirst = mask.indexOf(1);
	let soundLast = mask.lastIndexOf(1);
	// The music is sound, whatever the mask made of its edges.
	if (soundFirst < 0 || soundFirst > musicFirst) soundFirst = musicFirst;
	if (soundLast < musicLast) soundLast = musicLast;

	const musicStartMs = musicFirst * windowMs;
	const musicEndMs = (musicLast + 1) * windowMs;
	const soundStartMs = soundFirst * windowMs;
	const soundEndMs = (soundLast + 1) * windowMs;
	let startMs = soundStartMs - LEAD_MS;
	if (startMs < MIN_CUT_MS) startMs = 0;
	let endMs = soundEndMs + TAIL_MS;
	if (totalMs - endMs < MIN_CUT_MS) endMs = totalMs;
	const quiet = {
		start: soundStartMs < musicStartMs - LEAD_MS ? [soundStartMs, musicStartMs] : null,
		end: soundEndMs > musicEndMs + DECAY_MS ? [musicEndMs, soundEndMs] : null,
	};
	// What would be cut is not steady (a fade, wind, a room): nothing is cut there, and it is kept to be checked.
	if (startMs > 0 && !steady(levels, 0, startMs, windowMs)) { startMs = 0; quiet.start = [0, musicStartMs]; }
	if (endMs < totalMs && !steady(levels, endMs, totalMs, windowMs)) { endMs = totalMs; quiet.end = [musicEndMs, totalMs]; }
	const verdict = quiet.start || quiet.end ? "check" : startMs === 0 && endMs === totalMs ? "none" : "safe";
	return { verdict, startMs, endMs, floorDb, musicDb, musicStartMs, musicEndMs, soundStartMs, soundEndMs, quiet };
}

/**
 * The quietest moment within `radiusMs` of `atMs` (the middle of the
 * quietest window), for setting a cut where a cut is not heard.
 */
export function quietest(levels, atMs, radiusMs = 150, windowMs = WINDOW_MS) {
	const from = Math.max(0, Math.floor((atMs - radiusMs) / windowMs));
	const to = Math.min(levels.length - 1, Math.ceil((atMs + radiusMs) / windowMs));
	let best = Math.min(Math.max(0, Math.round(atMs / windowMs)), levels.length - 1);
	for (let w = from; w <= to; w++) if (levels[w] < levels[best]) best = w;
	return Math.round(best * windowMs + windowMs / 2);
}

/** "1:02.4" for 62400 ms; "-" for none. */
export function clock(ms) {
	if (!Number.isFinite(ms)) return "-";
	const t = Math.max(0, Math.round(ms / 100)) / 10;
	const m = Math.floor(t / 60);
	return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** "4.0" for 4000 ms: seconds with one decimal. */
export const seconds = (ms) => (Math.max(0, Math.round(ms / 100)) / 10).toFixed(1);

/** 62400 from "1:02.4", "62.4" or "1:02"; NaN when it is not a time. */
export function parseClock(text) {
	const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(String(text ?? ""));
	if (!m) return NaN;
	return Math.round(((Number(m[1] ?? 0) * 60) + Number(m[2])) * 1000);
}
