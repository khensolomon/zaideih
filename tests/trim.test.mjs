import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, envelope, LEAD_MS, parseClock, quietest, seconds, soundIn, soundMask, suggestTrim, TAIL_MS, WINDOW_MS } from "../src/core/trim.js";

/*
 * A tape: hiss throughout (seeded noise, about -55 dB), loud music (a 440 Hz
 * tone at -15 dB) between `music`, and a quiet sound (a 220 Hz tone at about
 * -39 dB, quieter than the music but well above the hiss) between `quiet`.
 */
function tape({ seconds: total = 12, music = [3, 9], quiet = [], rate = 8000 } = {}) {
	let seed = 7;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
	const ch = new Float32Array(rate * total);
	const within = (t, r) => r.length === 2 && t >= r[0] && t < r[1];
	for (let i = 0; i < ch.length; i++) {
		const t = i / rate;
		ch[i] = noise() * 0.003
			+ (within(t, music) ? Math.sin(2 * Math.PI * 440 * t) * 0.25 : 0)
			+ (within(t, quiet) ? Math.sin(2 * Math.PI * 220 * t) * 0.015 : 0);
	}
	return { ch, rate };
}
const near = (got, want, what) => assert.ok(Math.abs(got - want) <= 3 * WINDOW_MS, `${what}: ${got}, not about ${want}`);

test("trim: steady tape noise is cut, keeping a second before the music and two after", () => {
	const { ch, rate } = tape();
	const levels = envelope([ch], rate);
	assert.equal(levels.length, 12000 / WINDOW_MS);
	const s = suggestTrim(levels);
	assert.equal(s.verdict, "safe");
	assert.ok(s.floorDb < -45 && s.floorDb > -65, `floor ${s.floorDb}`);
	near(s.musicStartMs, 3000, "music start");
	near(s.startMs, 3000 - LEAD_MS, "cut start");
	near(s.endMs, 9000 + TAIL_MS, "cut end");
	assert.deepEqual(s.quiet, { start: null, end: null });
	// A click in the hiss is not taken for sound.
	ch[1000] = 0.9;
	near(suggestTrim(envelope([ch], rate)).startMs, 3000 - LEAD_MS, "with a click");
});

test("trim: a quiet sound before the music is kept, and the suggestion asks for a check", () => {
	const { ch, rate } = tape({ music: [4, 10], quiet: [2, 3.5] });
	const s = suggestTrim(envelope([ch], rate));
	assert.equal(s.verdict, "check");
	near(s.startMs, 2000 - LEAD_MS, "only the tape before the quiet sound is cut");
	near(s.quiet.start[0], 2000, "quiet sound from");
	near(s.quiet.start[1], 4000, "to the music");
	assert.equal(s.quiet.end, null);
});

test("trim: a long quiet tail after the music is kept and checked; a short one is the note dying away", () => {
	const long = suggestTrim(envelope([tape({ seconds: 16, music: [3, 9], quiet: [9, 13] }).ch], 8000));
	assert.equal(long.verdict, "check");
	near(long.endMs, 13000 + TAIL_MS, "cut after the quiet tail");
	near(long.quiet.end[0], 9000, "tail from the music's end");
	const short = suggestTrim(envelope([tape({ seconds: 16, music: [3, 9], quiet: [9, 10.5] }).ch], 8000));
	assert.equal(short.verdict, "safe");
	near(short.endMs, 10500 + TAIL_MS, "the tail is kept, with its margin");
});

test("trim: the floor is the tape's, even when the tape is a few seconds of a long song", () => {
	const s = suggestTrim(envelope([tape({ seconds: 120, music: [3, 117] }).ch], 8000));
	assert.equal(s.verdict, "safe");
	assert.ok(s.floorDb < -45, `floor ${s.floorDb}`);
	near(s.startMs, 3000 - LEAD_MS, "cut start");
	near(s.endMs, 117000 + TAIL_MS, "cut end");
});

test("trim: what is not steady, as tape noise is, is not cut but kept to be checked", () => {
	// A noise rising for 3 s (a fade-in, wind) before the music.
	const { ch, rate } = tape({ music: [4, 10] });
	for (let i = 0; i < 3 * rate; i++) ch[i] *= 1 + (i / rate) * 4;
	const s = suggestTrim(envelope([ch], rate));
	assert.equal(s.verdict, "check");
	assert.equal(s.startMs, 0);
	assert.ok(s.quiet.start, "the start is marked to be checked");
});

test("trim: nothing to cut when the music fills the recording, or there is no music", () => {
	const full = suggestTrim(envelope([tape({ music: [0.1, 11.9] }).ch], 8000));
	assert.equal(full.verdict, "none");
	assert.deepEqual([full.startMs, full.endMs], [0, 12000]);
	const quiet = suggestTrim(envelope([new Float32Array(8000)], 8000));
	assert.equal(quiet.verdict, "none");
	assert.deepEqual([quiet.startMs, quiet.endMs], [0, 1000]);
});

test("trim: where a cut holds sound", () => {
	const levels = envelope([tape().ch], 8000);
	const s = suggestTrim(levels);
	const mask = soundMask(levels, s.floorDb);
	assert.equal(soundIn(mask, 0, s.startMs), null, "the suggestion cuts only tape");
	const inside = soundIn(mask, 0, 3500);
	near(inside[0], 3000, "a cut moved into the music: the sound starts");
	near(inside[1], 3500, "and runs to the cut");
});

test("trim: the quietest moment near a cut, and times written and read", () => {
	const levels = Float32Array.from([-40, -40, -60, -40, -40, -40]);
	assert.equal(quietest(levels, 70, 50), 50);
	assert.equal(quietest(levels, 110, 10), 110, "nothing quieter within reach: the window itself");
	assert.equal(clock(62400), "1:02.4");
	assert.equal(clock(5000), "0:05.0");
	assert.equal(seconds(3080), "3.1");
	assert.equal(parseClock("1:02.4"), 62400);
	assert.equal(parseClock("62.4"), 62400);
	assert.ok(Number.isNaN(parseClock("abc")));
});
