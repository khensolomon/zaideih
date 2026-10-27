/**
 * Song lengths read from the files, for the Workspace's "Songs with no length"
 * check. Only the start of each MP3 is read (an HTTP Range request): the
 * first frame says the sample rate and bitrate, and many files carry a
 * Xing/Info or VBRI header there with the number of frames, which gives the
 * length exactly. A file without one is taken as constant bitrate and its
 * length worked out from its size. Nothing is decoded.
 *
 * lengthAt is pure (tests/lengths.test.mjs); readLength fetches.
 */
import { frameAt } from "../../worker/media/mp3.js";

export class LengthError extends Error {}

/** The bytes read first; enough for the tag and first frame of most files. */
export const FIRST_BYTES = 64 * 1024;
/** Read after the tag when a large one (cover pictures) fills the first read. */
const MORE_BYTES = 16 * 1024;
const MAX_TAG = 16 * 1024 * 1024;

const tag = (b, i, s) => i >= 0 && i + s.length <= b.length && [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

/** Where the sound starts: after the ID3v2 tag at the start, if any. */
export function audioStart(b) {
	if (!tag(b, 0, "ID3") || b.length < 10) return 0;
	const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
	return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/**
 * The length in seconds from bytes of the file that begin at `offset` (at
 * or before the first frame), and the file's size in all (`total`).
 * { seconds, how: "Xing" | "Info" | "VBRI" | "size" }. Throws LengthError.
 */
export function lengthAt(b, offset, total) {
	// The first frame: one whose next frame follows where it says it ends, so stray 0xFF bytes are not taken for one.
	let at = -1;
	let h = null;
	for (let i = 0; i + 4 <= b.length; i++) {
		const f = frameAt(b, i);
		if (!f) continue;
		const next = frameAt(b, i + f.size);
		if (next && next.version === f.version && next.rate === f.rate) { at = i; h = f; break; }
	}
	if (!h) throw new LengthError("no MP3 frames at the start of the file");
	const side = 4 + (h.crc ? 2 : 0) + (h.version === 1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17));
	const x = at + side;
	const seconds = (frames) => (frames * h.samples) / h.rate;
	if (tag(b, x, "Xing") || tag(b, x, "Info")) {
		const flags = u32(b, x + 4);
		if (flags & 1) {
			const frames = u32(b, x + 8);
			if (frames > 0) return { seconds: seconds(frames), how: tag(b, x, "Xing") ? "Xing" : "Info" };
		}
	}
	if (tag(b, at + 36, "VBRI")) {
		const frames = u32(b, at + 36 + 14);
		if (frames > 0) return { seconds: seconds(frames), how: "VBRI" };
	}
	if (!Number.isFinite(total) || total <= offset + at) throw new LengthError("the file's size is not known");
	// Constant bitrate: the sound's bytes over the bytes per second (an ID3v1 tag at the end is 128 bytes: within a second's rounding).
	return { seconds: ((total - offset - at) * 8) / (h.bitrate * 1000), how: "size" };
}

/** Bytes `from` to `from + n - 1` of `url` and the file's size; a server that ignores Range is read only that far. */
async function readRange(url, from, n, signal) {
	const res = await fetch(url, { headers: { Range: `bytes=${from}-${from + n - 1}` }, credentials: "omit", signal });
	if (res.status !== 206 && res.status !== 200) throw new LengthError(`HTTP ${res.status}`);
	let total = NaN;
	if (res.status === 206) {
		const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
		if (m) total = Number(m[1]);
		return { bytes: new Uint8Array(await res.arrayBuffer()), total, start: from };
	}
	// 200: the whole file is coming; take the start and stop.
	total = Number(res.headers.get("content-length"));
	const reader = res.body.getReader();
	const parts = [];
	let got = 0;
	while (got < from + n) {
		const { value, done } = await reader.read();
		if (done) break;
		parts.push(value);
		got += value.length;
	}
	reader.cancel().catch(() => {});
	const all = new Uint8Array(got);
	let p = 0;
	for (const part of parts) { all.set(part, p); p += part.length; }
	return { bytes: all.subarray(from, from + n), total: Number.isFinite(total) && total > 0 ? total : NaN, start: from };
}

/** A song's length in whole seconds, read from the start of its file at `url`. */
export async function readLength(url, { signal } = {}) {
	const first = await readRange(url, 0, FIRST_BYTES, signal);
	const start = audioStart(first.bytes);
	if (start > MAX_TAG) throw new LengthError("the file's tag is too large to be an MP3 tag");
	let part = first;
	// The tag (often with a cover picture) runs past the first read: read where the sound starts.
	if (start + 1024 > first.bytes.length) part = await readRange(url, start, MORE_BYTES, signal);
	const total = Number.isFinite(first.total) ? first.total : part.total;
	const { seconds, how } = lengthAt(part.bytes.subarray(part === first ? start : 0), part === first ? start : part.start, total);
	const whole = Math.round(seconds);
	if (whole < 1) throw new LengthError("the file is shorter than a second");
	return { seconds: whole, how };
}
