import assert from "node:assert/strict";
import { test } from "node:test";
import { createBalance, createLeveler, createSilenceSkipper, DEFAULTS, EQ_BANDS, headroomDb, PRESETS, readSettings, rumbleCut, TARGET_DB } from "../src/core/sound.js";
import { DenoiseChannel } from "../src/core/sound-worklet.js";

/** Plays a song through the skipper: `parts` are [level, seconds of the song]. */
function run(parts, { duration = 60, start = 0, seekTo = null } = {}) {
	const s = createSilenceSkipper();
	s.start(start);
	let pos = start, rate = 1;
	const actions = [];
	for (const [level, until] of parts) {
		if (seekTo && seekTo.at === until && seekTo.done !== true) { pos = seekTo.to; seekTo.done = true; continue; }
		while (pos < until && s.state !== "off") {
			const step = 0.05 * rate;
			pos += step;
			const a = s.update(level, pos, duration, step);
			if (!a) continue;
			actions.push({ ...a, at: Number(pos.toFixed(2)) });
			if (a.fast) rate = 8;
			if (a.play) { rate = 1; if (a.seek !== null) pos = a.seek; }
		}
	}
	return { s, actions, pos };
}

test("silent tape at the start is passed quickly, and play resumes just before the music", () => {
	const { actions } = run([[-48, 8], [-16, 20]]);
	assert.ok(actions[0].fast, "starts passing quickly");
	const play = actions.find((a) => a.play);
	assert.ok(play.seek > 6 && play.seek < 8, `resumes at ${play.seek}`);
});

test("a song with music from the first moment is left alone", () => {
	const { actions, s } = run([[-14, 5]]);
	assert.deepEqual(actions, []);
	assert.equal(s.state, "play");
});

test("a short click or thump on the tape does not count as the music starting", () => {
	// One loud reading (50 ms at 8x = 0.4 s of tape) inside the silence.
	const s = createSilenceSkipper();
	s.start(0);
	let pos = 0;
	for (; pos < 0.6; pos += 0.05) s.update(-48, pos, 60, 0.05);
	assert.equal(s.state, "fast");
	assert.equal(s.update(-20, 3, 60, 0.4), null);
	assert.equal(s.update(-48, 3.4, 60, 0.4), null);
	assert.equal(s.state, "fast");
});

test("no music within two minutes: plays on as it is", () => {
	const { actions } = run([[-48, 130]], { duration: 200 });
	assert.deepEqual(actions.map((a) => a.play ? "play" : a.fast ? "fast" : "?"), ["fast", "play"]);
	assert.equal(actions[1].seek, null);
});

test("silence at the end moves on; a quiet passage mid-song does not", () => {
	const end = run([[-16, 50], [-48, 60]], { duration: 60 });
	const finish = end.actions.find((a) => a.finish);
	assert.ok(finish && finish.at > 52 && finish.at < 53.5, `finishes at ${finish?.at}`);
	const middle = run([[-16, 40], [-48, 50], [-16, 120]], { duration: 200 });
	assert.equal(middle.actions.some((a) => a.finish), false);
});

test("resumed part way, the start is not skipped; a listener's seek stops the start skip", () => {
	assert.deepEqual(run([[-48, 20]], { start: 12 }).actions, []);
	const s = createSilenceSkipper();
	s.start(0);
	for (let p = 0; p < 0.6; p += 0.05) s.update(-48, p, 60, 0.05);
	assert.equal(s.state, "fast");
	s.seeked();
	assert.equal(s.state, "play");
});

test("even volume: quiet songs up, loud down, carefully at first", () => {
	const l = createLeveler();
	l.reset();
	for (let i = 0; i < 40; i++) l.update(-34, 0.05);
	assert.equal(l.gainDb(), 3, "at most +3 dB until the loudness is known");
	for (let i = 0; i < 400; i++) l.update(-34, 0.05);
	assert.equal(Math.round(l.gainDb()), Math.min(10, TARGET_DB + 34));
	l.reset();
	for (let i = 0; i < 400; i++) l.update(-8, 0.05);
	assert.equal(Math.round(l.gainDb()), -6);
	l.reset();
	for (let i = 0; i < 400; i++) l.update(-50, 0.05);
	assert.equal(l.gainDb(), 0, "tape noise is not music");
	l.reset(-30);
	assert.equal(l.gainDb(), 10, "a remembered loudness applies at once");
});

test("one-sided recordings are found after 3 s of music in one channel", () => {
	const b = createBalance();
	for (let i = 0; i < 50; i++) b.update(-20, -60, 0.05);
	assert.equal(b.side, "both");
	for (let i = 0; i < 20; i++) b.update(-20, -60, 0.05);
	assert.equal(b.side, "left");
	for (let i = 0; i < 70; i++) b.update(-70, -20, 0.05);
	assert.equal(b.side, "right");
	for (let i = 0; i < 3; i++) b.update(-20, -22, 0.05);
	assert.equal(b.side, "both");
});

test("settings: defaults, limits and unknown values", () => {
	const store = (v) => ({ getItem: () => (v === undefined ? null : JSON.stringify(v)) });
	assert.deepEqual(readSettings(store()), DEFAULTS);
	assert.deepEqual(readSettings(store({ clean: "nuclear", skip: 0, eq: [40, -40, 0.3, 0, 0, 0, 0, 0, 0, 0] })), { ...DEFAULTS, skip: false, eq: [12, -12, 0.5, 0, 0, 0, 0, 0, 0, 0] });
	assert.deepEqual(readSettings(store({ preset: "nope" })).preset, "custom");
	assert.deepEqual(readSettings({ getItem: () => "{broken" }), DEFAULTS);
});

test("denoise passes sound unchanged at 0 and lowers hiss without touching a tone", () => {
	const SR = 44100, HOP = 256;
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
	const len = SR * 6;
	const mix = new Float32Array(len);
	for (let i = 0; i < len; i++) mix[i] = 0.02 * rnd() + (i > 3 * SR ? 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0);
	const runDenoise = (amount) => {
		const ch = new DenoiseChannel();
		const out = new Float32Array(len);
		for (let i = 0; i + HOP <= len; i += HOP) { ch.frame(mix.subarray(i, i + HOP), amount); out.set(ch.queue, i); }
		return out;
	};
	const db = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return 10 * Math.log10(s / (to - from)); };
	const same = runDenoise(0);
	let err = 0;
	for (let i = SR; i < 2 * SR; i++) err = Math.max(err, Math.abs(same[i + 768] - mix[i]));
	assert.ok(err < 1e-5, `identity error ${err}`);
	const strong = runDenoise(1);
	assert.ok(db(strong, SR, 3 * SR) < db(mix, SR, 3 * SR) - 6, "hiss at least 6 dB lower");
	assert.ok(Math.abs(db(strong, 4 * SR, 6 * SR) - db(mix, 4 * SR, 6 * SR)) < 0.5, "the tone keeps its level");
});

test("equaliser: ten bands, presets in range, old three-band settings carried over", () => {
	assert.equal(EQ_BANDS.length, 10);
	for (const p of PRESETS) {
		assert.equal(p.gains.length, 10, p.id);
		assert.ok(p.gains.every((g) => Math.abs(g) <= 12), p.id);
	}
	const old = readSettings({ getItem: () => JSON.stringify({ bass: 6, voice: 2, treble: -4 }) });
	assert.equal(old.preset, "custom");
	assert.deepEqual(old.eq, [6, 6, 6, 3, 1, 2, 2, -1, -4, -4]);
	assert.equal("bass" in old, false);
});

test("boosts get headroom; a bass boost moves the rumble cut down", () => {
	assert.equal(headroomDb([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0);
	assert.ok(Math.abs(headroomDb([10, 0, -6, 0, 0, 0, 0, 0, 0, 0]) - 7) < 1e-9);
	const flat = Array(10).fill(0);
	assert.equal(rumbleCut({ clean: "light", eq: flat }), 75);
	assert.equal(rumbleCut({ clean: "light", eq: [6, 7, ...Array(8).fill(0)] }), 45);
	assert.equal(rumbleCut({ clean: "off", eq: [6, 7, ...Array(8).fill(0)] }), 10);
});
