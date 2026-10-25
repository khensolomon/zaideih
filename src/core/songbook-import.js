/**
 * Pages of a songbook, as text (from a phone's text recognition, or a file),
 * split into hymns at their numbers (docs/songbooks.md, "Scanning"). Pure:
 * used by the app's import page and by tools/songbook.mjs.
 *
 * A hymn starts at a line holding its number alone ("145", "145.") with its
 * title on the next line, or at its number and title on one line written in
 * capitals ("145 LUNGMUANNA KA NEI"). A number alone with no title after it
 * (a page number) is not a hymn, nor are verse numbers ("1. Lungmuanna ka
 * nei"); a heading is only taken when its number is larger than the hymn
 * before it.
 * The result is a draft: the import page shows it to be checked and corrected
 * before anything is saved.
 */

const MAX_NUMBER = 99_999;
const ALONE = /^(\d{1,5})[.)]?$/;
const WITH_TITLE = /^(\d{1,5})[.)]?\s+(.+)$/;
const VERSE = /^\d{1,2}[.)]\s*/;

/** "LUNGMUANNA KA NEI" → "Lungmuanna Ka Nei"; a title with small letters stays as it is. */
export function titleCase(title) {
	if (/\p{Ll}/u.test(title)) return title;
	return title.toLowerCase().replace(/(^|[\s(“"'-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
}

const hasCapitalsOnly = (s) => /\p{L}/u.test(s) && !/\p{Ll}/u.test(s);

/**
 * Splits `text` into hymns. `from`: the number the first hymn must have (any,
 * when not given). Answers { entries: [{ number, title, firstLine, text }],
 * notes: [string] }, where notes say what to check: lines before the first
 * hymn, numbers skipped, hymns with no words.
 */
export function splitHymns(text, { from = null } = {}) {
	if (typeof text !== "string") throw new TypeError("the pages must be text");
	if (from !== null && (!Number.isSafeInteger(from) || from < 1 || from > MAX_NUMBER)) throw new RangeError(`the first number must be 1 to ${MAX_NUMBER}`);
	const lines = text.normalize("NFC").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/u, ""));
	const entries = [];
	const notes = [];
	let before = 0;
	let current = null;
	// The first number: any, or `from`; after it, a larger one.
	const accepts = (n) => (current === null ? from === null || n === from : n > current.number);
	// The title under a number alone: the next line with words, not a verse or another number.
	const titleAfter = (i) => {
		let j = i + 1;
		while (j < lines.length && !lines[j].trim()) j++;
		const next = lines[j]?.trim() ?? "";
		return next && /\p{L}/u.test(next) && !VERSE.test(next) && !ALONE.test(next) ? j : -1;
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		let number = null;
		let title = null;
		const alone = ALONE.exec(line);
		const withTitle = alone ? null : WITH_TITLE.exec(line);
		let titleLine = -1;
		if (alone && (titleLine = titleAfter(i)) >= 0) {
			number = Number(alone[1]);
			title = lines[titleLine].trim();
		} else if (withTitle && hasCapitalsOnly(withTitle[2])) {
			number = Number(withTitle[1]);
			title = withTitle[2].trim();
		}
		if (number !== null && number >= 1 && number <= MAX_NUMBER && accepts(number)) {
			if (current) entries.push(current);
			if (titleLine >= 0) i = titleLine;
			current = { number, title, body: [] };
			continue;
		}
		if (current) current.body.push(lines[i]);
		else if (line) before += 1;
	}
	if (current) entries.push(current);

	if (before) notes.push(`${before} line${before === 1 ? "" : "s"} before the first hymn number ${before === 1 ? "was" : "were"} left out.`);
	const out = entries.map((e) => {
		const body = e.body.join("\n").replace(/^\n+|\n+$/g, "").replace(/\n{3,}/g, "\n\n");
		const firstLine = (body.split("\n").find((l) => /\p{L}/u.test(l)) ?? "").trim().replace(VERSE, "");
		return { number: e.number, title: titleCase(e.title || firstLine), firstLine, text: body };
	});
	for (let k = 1; k < out.length; k++) {
		const gap = out[k].number - out[k - 1].number - 1;
		if (gap > 0) notes.push(`${gap === 1 ? `Hymn ${out[k - 1].number + 1} is` : `Hymns ${out[k - 1].number + 1} to ${out[k].number - 1} are`} not in these pages.`);
	}
	for (const e of out) if (!e.text.trim()) notes.push(`Hymn ${e.number} has no words.`);
	return { entries: out, notes };
}
