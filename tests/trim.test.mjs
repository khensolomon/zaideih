import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, envelope, LEAD_MS, parseClock, quietest, suggestTrim, TAIL_MS, WINDOW_MS } from "../src/core/trim.js";

/* Tape: hiss throughout (seeded noise at -50 dB), music (a 440 Hz tone at -12 dB) from 3.0 s to 9.0 s, 12 s in all. */
function tape(rate = 8000) {
	let seed = 7;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
	const ch = new Float32Array(rate * 12);
	for (let i = 0; i < ch.length; i++) {
		const t = i / rate;
		ch[i] = noise() * 0.003 + (t >= 3 && t < 9 ? Math.sin(2 * Math.PI * 440 * t) * 0.25 : 0);
	}
	return { ch, rate };
}

test("trim: the music is found above the tape's own floor, with a lead and a tail", () => {
	const { ch, rate } = tape();
	const levels = envelope([ch], rate);
	assert.equal(levels.length, 12000 / WINDOW_MS);
	const s = suggestTrim(levels);
	assert.ok(s.floorDb < -45 && s.floorDb > -60, `floor ${s.floorDb}`);
	assert.ok(Math.abs(s.startMs - (3000 - LEAD_MS)) <= WINDOW_MS, `start ${s.startMs}`);
	assert.ok(Math.abs(s.endMs - (9000 + TAIL_MS)) <= WINDOW_MS, `end ${s.endMs}`);
	// A click in the hiss is not taken for the music.
	ch[1000] = 0.9;
	assert.ok(Math.abs(suggestTrim(envelope([ch], rate)).startMs - (3000 - LEAD_MS)) <= WINDOW_MS);
	// All quiet: the whole recording.
	const quiet = suggestTrim(envelope([new Float32Array(8000)], 8000));
	assert.deepEqual([quiet.startMs, quiet.endMs], [0, 1000]);
});

test("trim: the quietest moment near a cut, and times written and read", () => {
	const levels = Float32Array.from([-40, -40, -60, -40, -40, -40]);
	assert.equal(quietest(levels, 70, 50), 50);
	assert.equal(quietest(levels, 110, 10), 110, "nothing quieter within reach: the window itself");
	assert.equal(clock(62400), "1:02.4");
	assert.equal(clock(5000), "0:05.0");
	assert.equal(parseClock("1:02.4"), 62400);
	assert.equal(parseClock("62.4"), 62400);
	assert.ok(Number.isNaN(parseClock("abc")));
});
