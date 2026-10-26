import assert from "node:assert/strict";
import { test } from "node:test";

test("chord style: kept on the device, unknown values fall back, wrong ones refused", async () => {
	const store = new Map();
	globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
	const { CHORD_DEFAULT, chordStyle, setChordStyle } = await import("../src/ui/chord-style.js");
	assert.deepEqual(chordStyle(), { ...CHORD_DEFAULT });
	assert.deepEqual(setChordStyle({ tone: "dim" }), { size: "small", tone: "dim" });
	assert.deepEqual(JSON.parse(store.get("zaideih.lyrics.chordStyle")), { size: "small", tone: "dim" });
	store.set("zaideih.lyrics.chordStyle", JSON.stringify({ size: "huge", tone: "bright" }));
	assert.deepEqual(chordStyle(), { size: "small", tone: "bright" });
	store.set("zaideih.lyrics.chordStyle", "not json");
	assert.deepEqual(chordStyle(), { ...CHORD_DEFAULT });
	assert.throws(() => setChordStyle({ size: "huge" }), /chord style must be/);
	delete globalThis.localStorage;
});
