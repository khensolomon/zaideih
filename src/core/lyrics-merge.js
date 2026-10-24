/**
 * Merging two copies of the same song's lyrics (docs/lyrics.md, "Shared
 * lyrics"): whether they are the same words, what differs, and which copy
 * to keep. Pure: tested in Node (tests/lyrics-merge.test.mjs).
 *
 * The same words: compared as sung, line by line, each once. Chords, times,
 * details, part names, spacing, punctuation and a repeat mark ("x2", "(×3)")
 * are not differences, nor is a part written out again instead of marked.
 */
import { parseLyrics } from "./lyrics-format.js";
import { normalize } from "./text.js";

/** A repeat mark at the end of a line: "x2", "(x2)", "×3", "[x 2]". */
const REPEAT = /\s*[([]?\s*[x×]\s*\d{1,2}\s*[)\]]?\s*$/iu;

/** A line as compared: its words only. */
export const lineKey = (line) => normalize(line.replace(REPEAT, "")).replace(/[\s\p{P}\p{S}]+/gu, "");

/** The sung lines of a text, each once, in order: [{ key, text }]. */
export function sungLines(text) {
	const seen = new Set();
	const out = [];
	for (const b of parseLyrics(text).blocks) {
		if (b.recall) continue;
		for (const l of b.lines) {
			if (l.kind !== "words" || l.of) continue;
			const t = l.parts.map((x) => x.text).join("").replace(/\s+/g, " ").trim().replace(REPEAT, "");
			const key = lineKey(t);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			out.push({ key, text: t });
		}
	}
	return out;
}

/**
 * Two texts compared by their sung words: { same, onlyA, onlyB } with the
 * lines (as written) found in one only.
 */
export function compareWords(a, b) {
	const A = sungLines(a);
	const B = sungLines(b);
	const inA = new Set(A.map((l) => l.key));
	const inB = new Set(B.map((l) => l.key));
	const onlyA = A.filter((l) => !inB.has(l.key)).map((l) => l.text);
	const onlyB = B.filter((l) => !inA.has(l.key)).map((l) => l.text);
	return { same: A.length > 0 && !onlyA.length && !onlyB.length, onlyA, onlyB, lines: [A.length, B.length] };
}

/**
 * How much a copy has been worked on, with the reasons in words. `copy`:
 * { text, versions, people, updated (unix seconds), langs (count), reports }.
 */
export function copyWorth(copy, nowSeconds) {
	const p = parseLyrics(copy.text);
	const lines = sungLines(copy.text).length;
	const days = (nowSeconds - (copy.updated ?? 0)) / 86_400;
	const reasons = [];
	let score = 0;
	const add = (n, why) => { score += n; if (why) reasons.push(why); };
	add(Math.min(copy.versions ?? 1, 20) * 2, copy.versions > 1 ? `${copy.versions} versions` : "");
	add(Math.min(copy.people ?? 1, 10) * 3, copy.people > 1 ? `by ${copy.people} people` : "");
	add(lines * 0.5, `${lines} lines`);
	if (p.timed) add(4, "timed");
	if (p.chords) add(3, "chords");
	if ((copy.langs ?? 1) > 1) add((copy.langs - 1) * 4, `${copy.langs - 1} translation${copy.langs > 2 ? "s" : ""}`);
	if (days <= 30) add(3, "edited lately");
	else if (days <= 365) add(1, "");
	if (copy.reports) add(-5 * copy.reports, `${copy.reports} open report${copy.reports === 1 ? "" : "s"}`);
	return { score, reasons };
}

/**
 * Which copy to keep when merging: the one worked on most; on a tie, `b`
 * (the song chosen to keep). Answers { keep: "a" | "b", a, b } with each
 * copy's worth.
 */
export function suggestKeep(a, b, nowSeconds) {
	const wa = copyWorth(a, nowSeconds);
	const wb = copyWorth(b, nowSeconds);
	return { keep: wa.score > wb.score ? "a" : "b", a: wa, b: wb };
}
