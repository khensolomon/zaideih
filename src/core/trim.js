/**
 * Where a recording's music starts and ends, for the audio studio
 * (docs/audio-studio.md): the sound's level in short windows, the tape's
 * noise floor from the quietest of them, and the music as where the level
 * stays well above that floor. The studio shows the suggestion; a person
 * decides.
 *
 * Tape is never digitally silent: before and after the music there is hiss,
 * hum, wind or handling noise, so "quiet" is judged against the recording's
 * own floor, not against zero.
 */

export const WINDOW_MS = 20;
/** The music is this far (dB) above the floor. */
export const ABOVE_DB = 12;
/** …and stays there this long, so a click or a bump is not taken for it. */
export const HOLD_MS = 600;
/** Kept before the music starts, and after it ends (a note dying away). */
export const LEAD_MS = 250;
export const TAIL_MS = 700;

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

/**
 * The suggested cut: { startMs, endMs, floorDb, thresholdDb }, where the
 * music starts (LEAD_MS before the level first stays ABOVE_DB over the
 * floor for HOLD_MS) and ends (TAIL_MS after it last does). The whole
 * recording when no such stretch is found.
 */
export function suggestTrim(levels, windowMs = WINDOW_MS) {
	const totalMs = levels.length * windowMs;
	if (!levels.length) return { startMs: 0, endMs: 0, floorDb: -120, thresholdDb: -120 };
	// The floor: the quieter tenth of the windows, but never below near-silence.
	const floorDb = Math.max(-90, quantile(levels, 0.1));
	const thresholdDb = floorDb + ABOVE_DB;
	const hold = Math.max(1, Math.round(HOLD_MS / windowMs));
	const loud = (w) => levels[w] >= thresholdDb;
	// A stretch counts when most of its windows (80 %) are loud.
	const stretch = (from) => {
		let n = 0;
		for (let k = from; k < from + hold && k < levels.length; k++) if (loud(k)) n++;
		return n >= hold * 0.8;
	};
	let first = -1;
	for (let w = 0; w + hold <= levels.length; w++) if (loud(w) && stretch(w)) { first = w; break; }
	let last = -1;
	for (let w = levels.length - hold; w >= 0; w--) if (loud(w + hold - 1) && stretch(w)) { last = w + hold - 1; break; }
	if (first < 0 || last < first) return { startMs: 0, endMs: totalMs, floorDb, thresholdDb };
	return {
		startMs: Math.max(0, first * windowMs - LEAD_MS),
		endMs: Math.min(totalMs, (last + 1) * windowMs + TAIL_MS),
		floorDb,
		thresholdDb,
	};
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

/** 62400 from "1:02.4", "62.4" or "1:02"; NaN when it is not a time. */
export function parseClock(text) {
	const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(String(text ?? ""));
	if (!m) return NaN;
	return Math.round(((Number(m[1] ?? 0) * 60) + Number(m[2])) * 1000);
}
