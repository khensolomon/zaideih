import assert from "node:assert/strict";
import { test } from "node:test";
import { audioStart, lengthAt, LengthError } from "../src/workspace/lengths.js";

const RATE = 44100;
function frame(bIndex = 9) {
	const size = Math.floor((144 * [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][bIndex] * 1000) / RATE);
	const f = new Uint8Array(size);
	f.set([0xff, 0xfb, bIndex << 4, 0x00]);
	return f;
}
const join = (...parts) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) { out.set(p, at); at += p.length; }
	return out;
};
const put32 = (b, i, v) => { b[i] = v >>> 24; b[i + 1] = (v >>> 16) & 255; b[i + 2] = (v >>> 8) & 255; b[i + 3] = v & 255; };
const id3 = (n) => join(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]), new Uint8Array(n).fill(7));

test("lengths: a Xing header gives the frame count", () => {
	const x = frame(9);
	x.set([..."Xing"].map((c) => c.charCodeAt(0)), 36);
	put32(x, 40, 1);
	put32(x, 44, 9000);
	const b = join(id3(300), x, frame(9), frame(9));
	assert.equal(audioStart(b), 310);
	const r = lengthAt(b.subarray(310), 310, 5_000_000);
	assert.equal(r.how, "Xing");
	assert.equal(Math.round(r.seconds), Math.round((9000 * 1152) / RATE));
});

test("lengths: a VBRI header gives the frame count", () => {
	const v = frame(9);
	v.set([..."VBRI"].map((c) => c.charCodeAt(0)), 36);
	put32(v, 36 + 14, 4500);
	const r = lengthAt(join(v, frame(9)), 0, 1);
	assert.equal(r.how, "VBRI");
	assert.equal(Math.round(r.seconds), Math.round((4500 * 1152) / RATE));
});

test("lengths: without a header, constant bitrate from the file's size", () => {
	const b = join(new Uint8Array(5).fill(0xff), frame(9), frame(9));
	// 128 kbps: 16 000 bytes a second; 3 minutes of sound after 5 stray bytes.
	const r = lengthAt(b, 1000, 1000 + 5 + 16000 * 180);
	assert.equal(r.how, "size");
	assert.equal(Math.round(r.seconds), 180);
	assert.throws(() => lengthAt(b, 0, NaN), /size is not known/);
	assert.throws(() => lengthAt(new Uint8Array(2000), 0, 9), LengthError);
});
