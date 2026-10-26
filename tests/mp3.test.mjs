import assert from "node:assert/strict";
import { test } from "node:test";
import { cut, durationMs, frameAt, Mp3Error, scan } from "../worker/media/mp3.js";

/* MPEG-1 Layer III frames at 44.1 kHz, stereo, as bytes: header then zeros (silence enough for parsing). */
function frame(bIndex = 9, padding = 0) {
	const size = Math.floor((144 * [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bIndex] * 1000) / 44100) + padding;
	const f = new Uint8Array(size);
	f.set([0xff, 0xfb, (bIndex << 4) | (padding << 1), 0x00]);
	return f;
}
function xing(kind = "Info") {
	const f = frame(9);
	for (const [k, c] of [...kind].entries()) f[36 + k] = c.charCodeAt(0);
	return f;
}
const join = (...parts) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) { out.set(p, at); at += p.length; }
	return out;
};
const id3 = () => join(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]), new Uint8Array(20).fill(7));
const id3v1 = () => { const t = new Uint8Array(128); t.set([0x54, 0x41, 0x47]); return t; };

test("mp3: frames are found past the ID3v2 tag, the Info frame apart, ID3v1 at the end", () => {
	const frames = Array.from({ length: 100 }, (_, i) => frame(9, i % 3 === 0 ? 1 : 0));
	const b = join(id3(), xing("Info"), ...frames, id3v1());
	const s = scan(b);
	assert.equal(s.head, 30);
	assert.equal(s.info.kind, "Info");
	assert.equal(s.frames.length, 100);
	assert.equal(s.tail, b.length - 128);
	assert.equal(durationMs(s), Math.round((100 * 1152 * 1000) / 44100));
	assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0xf0, 0]), 0), null, "bitrate index 15 is bad");
	assert.throws(() => scan(new Uint8Array(500)), Mp3Error);
});

test("mp3: a cut keeps the frames between two times, the tags, and a new Info frame for them", () => {
	const frames = Array.from({ length: 200 }, () => frame(9));
	const b = join(id3(), xing("Info"), ...frames, id3v1());
	const ms = (1152 * 1000) / 44100;
	const r = cut(b, 50 * ms, 150 * ms);
	assert.equal(r.frames, 100);
	assert.deepEqual([r.startMs, r.endMs], [Math.round(50 * ms), Math.round(150 * ms)]);
	const s = scan(r.bytes);
	assert.equal(s.frames.length, 100, "the cut reads back as its frames");
	assert.equal(s.info.kind, "Info");
	assert.deepEqual([...r.bytes.subarray(0, 30)], [...id3()], "ID3v2 kept");
	assert.deepEqual([...r.bytes.subarray(-128, -125)], [0x54, 0x41, 0x47], "ID3v1 kept");
	// The new Info frame counts what was kept.
	const x = s.info.offset + 36;
	const u32 = (i) => (r.bytes[i] << 24 | r.bytes[i + 1] << 16 | r.bytes[i + 2] << 8 | r.bytes[i + 3]) >>> 0;
	assert.equal(u32(x + 8), 100);
	assert.equal(u32(x + 12), r.bytes.length - 30 - 128);
	// Varying bitrate without an Info frame: a Xing frame is written.
	const vbr = join(...Array.from({ length: 60 }, (_, i) => frame(i % 2 ? 9 : 11)));
	assert.equal(scan(cut(vbr, 0, 1000).bytes).info.kind, "Xing");
	// Constant bitrate without one: none.
	assert.equal(scan(cut(join(...Array.from({ length: 60 }, () => frame(9))), 0, 1000).bytes).info, null);
	assert.throws(() => cut(b, 500, 100), /start before its end/);
});
