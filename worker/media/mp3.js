/**
 * MP3 files cut without decoding (docs/audio-studio.md): an MP3 is a chain
 * of frames, each about 26 ms of sound, so a song is trimmed by keeping the
 * frames between two times. Nothing is decoded or encoded again: the frames
 * kept are the original's, byte for byte, and the sound loses nothing.
 *
 * What a cut keeps around the frames: the ID3v2 tag at the start (title,
 * artist, pictures) and the ID3v1 tag at the end. The first frame of many
 * files carries no sound but a Xing/Info header (frame and byte counts and
 * a seek table) or a VBRI header; those describe the whole song, so a cut
 * writes a new Xing/Info frame for what it keeps, or none when the original
 * had none. The LAME extension (encoder delay, gapless padding) is not
 * carried over: it no longer holds once the start is cut.
 *
 * A frame may borrow bits from the frames before it (the bit reservoir); the
 * first frame kept can then not be decoded in full and comes out silent,
 * one frame (~26 ms). The studio sets cuts in quiet tape, where that is not
 * heard.
 */

const BITRATES = {
	1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

export class Mp3Error extends Error {}

/**
 * The frame header at `i`, or null: MPEG 1, 2 or 2.5, Layer III, a known
 * bitrate (not free or bad) and sample rate. { version, bitrate, rate,
 * padding, mono, crc, size, samples }.
 */
export function frameAt(b, i) {
	if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
	const vBits = (b[i + 1] >> 3) & 3;
	const layer = (b[i + 1] >> 1) & 3;
	if (vBits === 1 || layer !== 1) return null;
	const version = vBits === 3 ? 1 : vBits === 2 ? 2 : 2.5;
	const bIndex = b[i + 2] >> 4;
	const rIndex = (b[i + 2] >> 2) & 3;
	if (bIndex === 0 || bIndex === 15 || rIndex === 3) return null;
	const bitrate = BITRATES[version === 1 ? 1 : 2][bIndex];
	const rate = RATES[version][rIndex];
	const padding = (b[i + 2] >> 1) & 1;
	const size = Math.floor(((version === 1 ? 144 : 72) * bitrate * 1000) / rate) + padding;
	return { version, bitrate, bIndex, rate, padding, mono: (b[i + 3] >> 6) === 3, crc: (b[i + 1] & 1) === 0, size, samples: version === 1 ? 1152 : 576 };
}

/** Where the side information ends in a frame (the Xing header starts there). */
const sideEnd = (h) => 4 + (h.crc ? 2 : 0) + (h.version === 1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17));

const tag = (b, i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/**
 * The file's parts: `head` (the ID3v2 tag, bytes 0 to `head`), `frames`
 * ([{ offset, size }], sound frames only), `info` (a Xing/Info/VBRI frame,
 * or null), `tail` (the ID3v1 tag, or null), `rate`, `samples` (per frame).
 * Throws Mp3Error when no run of frames is found.
 */
export function scan(b) {
	let i = 0;
	if (tag(b, 0, "ID3") && b.length >= 10) {
		const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
		i = 10 + size + ((b[5] & 0x10) ? 10 : 0);
	}
	const head = Math.min(i, b.length);
	const tail = b.length >= 128 && tag(b, b.length - 128, "TAG") ? b.length - 128 : null;
	const end = tail ?? b.length;
	// A frame counts when the next one follows where it says it ends (two in a row), so stray 0xFF bytes are not taken for frames.
	const confirmed = (at) => {
		const h = frameAt(b, at);
		if (!h || at + h.size > end) return null;
		const next = at + h.size;
		return next === end || frameAt(b, next) ? h : null;
	};
	const frames = [];
	let info = null;
	let first = null;
	while (i < end) {
		const h = confirmed(i);
		if (!h) { i++; continue; }
		if (!first) {
			first = h;
			const x = i + sideEnd(h);
			if (tag(b, x, "Xing") || tag(b, x, "Info") || tag(b, i + 36, "VBRI")) {
				info = { offset: i, size: h.size, header: h, kind: tag(b, i + 36, "VBRI") ? "VBRI" : tag(b, x, "Xing") ? "Xing" : "Info" };
				i += h.size;
				continue;
			}
		}
		// Frames of one song share a version and sample rate; anything else is junk in between.
		if (h.version === first.version && h.rate === first.rate) frames.push({ offset: i, size: h.size, bIndex: h.bIndex });
		i += h.size;
	}
	if (frames.length < 2) throw new Mp3Error("no MP3 (MPEG Layer III) frames found in the file");
	return { head, frames, info, tail, rate: first.rate, samples: first.samples, version: first.version, mono: first.mono };
}

/** The song's length in milliseconds, from its frames. */
export const durationMs = (s, count = s.frames.length) => Math.round((count * s.samples * 1000) / s.rate);

/**
 * A Xing (VBR) or Info (constant bitrate) frame for `frames` of `bytes` in
 * all (the frames and this one), in a frame of the song's version and rate
 * large enough to hold it: frame and byte counts and a 100-entry seek table.
 */
function xingFrame(s, frames, bytes, vbr) {
	const bitrates = BITRATES[s.version === 1 ? 1 : 2];
	const h0 = { version: s.version, mono: s.mono, crc: false };
	const need = sideEnd(h0) + 4 + 4 + 4 + 4 + 100;
	// The smallest bitrate whose frame holds the header (a low-bitrate song's own frames can be too small).
	let bIndex = 1;
	const sizeOf = (k) => Math.floor(((s.version === 1 ? 144 : 72) * bitrates[k] * 1000) / s.rate);
	while (bIndex < 14 && sizeOf(bIndex) < need) bIndex++;
	const size = sizeOf(bIndex);
	const out = new Uint8Array(size);
	const vBits = s.version === 1 ? 3 : s.version === 2 ? 2 : 0;
	const rIndex = RATES[s.version].indexOf(s.rate);
	out[0] = 0xff;
	out[1] = 0xe0 | (vBits << 3) | (1 << 1) | 1; // Layer III, no CRC
	out[2] = (bIndex << 4) | (rIndex << 2);
	out[3] = s.mono ? 0xc0 : 0x00;
	let p = sideEnd(h0);
	const put32 = (v) => { out[p++] = (v >>> 24) & 0xff; out[p++] = (v >>> 16) & 0xff; out[p++] = (v >>> 8) & 0xff; out[p++] = v & 0xff; };
	for (const c of vbr ? "Xing" : "Info") out[p++] = c.charCodeAt(0);
	put32(0x7); // frames, bytes and the seek table follow
	put32(frames.length);
	put32(bytes);
	// Seek table: where (as 1/256 of the bytes) each percent of the song starts.
	const total = frames.reduce((n, f) => n + f.size, 0);
	let acc = 0;
	let k = 0;
	for (let pct = 0; pct < 100; pct++) {
		const at = Math.floor((pct / 100) * frames.length);
		while (k < at) acc += frames[k++].size;
		out[p++] = Math.min(255, Math.floor(((size + acc) / (size + total)) * 256));
	}
	return out;
}

/** The frames kept for a cut from `startMs` to `endMs`: { from, to, kept, vbr, msPer }. */
function choose(s, startMs, endMs) {
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) throw new Mp3Error("the cut needs a start before its end, from 0");
	const msPer = (s.samples * 1000) / s.rate;
	const from = Math.min(s.frames.length - 1, Math.round(startMs / msPer));
	const to = Math.min(s.frames.length, Math.max(from + 1, Math.round(endMs / msPer)));
	const kept = s.frames.slice(from, to);
	return { from, to, kept, vbr: new Set(kept.map((f) => f.bIndex)).size > 1, msPer };
}

/** The Xing/Info frame for `kept` frames of `soundBytes` in all, or none when the original had no such frame and the bitrate is constant. */
function infoFor(s, kept, soundBytes, vbr) {
	if (!s.info && !vbr) return new Uint8Array(0);
	const probe = xingFrame(s, kept, 0, vbr);
	return xingFrame(s, kept, probe.length + soundBytes, vbr);
}

/**
 * The song from `startMs` to `endMs` (of the original), cut at frame edges:
 * { parts, length, bytes, startMs, endMs, durationMs, frames } with the times as cut. The
 * ID3 tags are kept; a Xing/Info frame is written for the frames kept when
 * the original had one (or a VBRI header), Xing when the bitrate varies.
 */
export function cut(b, startMs, endMs) {
	const s = scan(b);
	const { from, to, kept, vbr, msPer } = choose(s, startMs, endMs);
	const sound = b.subarray(kept[0].offset, kept.at(-1).offset + kept.at(-1).size);
	const info = infoFor(s, kept, sound.length, vbr);
	const head = b.subarray(0, s.head);
	const tail = s.tail === null ? new Uint8Array(0) : b.subarray(s.tail);
	// The parts are views into the original: a long recording is not copied whole again
	// (the Worker streams them to R2); `bytes` joins them for whoever needs one array.
	const parts = [head, info, sound, tail];
	const length = parts.reduce((n, p) => n + p.length, 0);
	return {
		parts,
		length,
		get bytes() {
			const out = new Uint8Array(length);
			let at = 0;
			for (const p of parts) { out.set(p, at); at += p.length; }
			return out;
		},
		startMs: Math.round(from * msPer), endMs: Math.round(to * msPer), durationMs: durationMs(s, kept.length), frames: kept.length,
	};
}

/**
 * The same cut as a plan for the Worker, made where the whole file is (the
 * studio in the browser has it for its waveform): the Worker then copies
 * byte ranges of the original in storage without reading it whole.
 * { size, head, from, frames, sound: [start, end), last (the last frame's
 * offset), tail (offset or null), info (the Xing/Info frame's bytes, or
 * null) }. `s` is the file's scan and `size` its length: the scan is all
 * the studio keeps once the file is decoded for its waveform.
 */
export function plan(s, size, startMs, endMs) {
	const { from, kept, vbr } = choose(s, startMs, endMs);
	const first = kept[0];
	const last = kept.at(-1);
	const info = infoFor(s, kept, last.offset + last.size - first.offset, vbr);
	return { size, head: s.head, from, frames: kept.length, sound: [first.offset, last.offset + last.size], last: last.offset, tail: s.tail, info: info.length ? info : null };
}

/** Whether `b` is one whole Xing or Info frame (what `plan` writes). */
export function isInfoFrame(b) {
	const h = frameAt(b, 0);
	if (!h || h.size !== b.length) return false;
	const x = sideEnd(h);
	return tag(b, x, "Xing") || tag(b, x, "Info");
}
