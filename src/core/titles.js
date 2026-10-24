/**
 * Comparing song titles (docs/lyrics.md, "Shared lyrics"): the same song
 * sung again often has its title written another way, with other spacing,
 * punctuation or a word changed ("သားသမီးတိုင်းအတွက်ယေရှု",
 * "သားသမီးတိုင်းရဲ့ယေရှု"). Pure: tested in Node (tests/titles.test.mjs).
 */
import { normalize } from "./text.js";

/** A title as compared: the app's search form, without spaces or punctuation. */
export const titleKey = (title) => normalize(title).replace(/[\s\p{P}\p{S}]+/gu, "");

/** Edit distance between two strings, by code point; stops early past `max`. */
function distance(a, b, max) {
	const x = [...a];
	const y = [...b];
	if (Math.abs(x.length - y.length) > max) return max + 1;
	let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
	for (let i = 1; i <= x.length; i++) {
		const row = [i];
		let least = i;
		for (let j = 1; j <= y.length; j++) {
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
			least = Math.min(least, row[j]);
		}
		if (least > max) return max + 1;
		prev = row;
	}
	return prev[y.length];
}

/**
 * How close two title keys are, 0 to 1: 1 the same; near 1 a few letters
 * apart; one inside the other (a subtitle added) counts as close.
 */
export function titleCloseness(a, b) {
	if (!a || !b) return 0;
	if (a === b) return 1;
	const long = Math.max([...a].length, [...b].length);
	const short = Math.min([...a].length, [...b].length);
	if (short >= 5 && (a.includes(b) || b.includes(a))) return 0.8;
	const max = Math.floor(long * 0.35);
	const d = distance(a, b, max);
	return d > max ? 0 : 1 - d / long;
}

/** How close titles must be to be offered as the same song: a word changed, not another song. */
export const CLOSE_TITLES = 0.75;
