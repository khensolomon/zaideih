/**
 * Reading the structure of lyrics as people write them (docs/lyrics.md,
 * "Formats"). Lyrics are kept exactly as typed; this finds, when shown:
 *
 *   sections   [Verse 1], [Chorus], [Bridge x2] ...      (Genius style)
 *              Chorus: / Refrain: on a line of its own   (hymnbooks)
 *              "1." starting a stanza                    (hymnbooks)
 *              {start_of_chorus} ... {end_of_chorus}     (ChordPro)
 *   recalls    a bare [Chorus] or {chorus} repeats the last chorus
 *   chords     [G]Amazing [C]grace                       (ChordPro, inline)
 *              a line of chords above the words          (chord sheets)
 *   details    {key: G} {capo: 2} {tempo: 72} {title: …} (ChordPro)
 *              Key: G / Capo: 2 / Tempo: 72 at the top   (plain)
 *   notes      {comment: softly}, (spoken), (repeat x2)
 *   timing     [01:23.40] a line                         (LRC), [offset:…]
 *
 * Without any of these, a block of two or more lines that comes back the
 * same is taken for the chorus. Nothing is ever refused: what is not
 * understood is shown as written.
 *
 * Pure: tested in Node (tests/lyrics-format.test.mjs).
 */

/*
 * Section names, as written in lyrics and hymnbooks, to the kind of section.
 * Matched on the start of the label, case-insensitive; the rest of the label
 * (a number, a singer, "x2") is kept for showing. More names, for the
 * languages of the catalog, belong here.
 */
export const SECTION_WORDS = [
	["pre-chorus", "prechorus"], ["pre chorus", "prechorus"], ["prechorus", "prechorus"], ["lift", "prechorus"],
	["chorus", "chorus"], ["refrain", "chorus"], ["hook", "chorus"], ["ref", "chorus"], ["ch", "chorus"],
	["post-chorus", "postchorus"], ["post chorus", "postchorus"],
	["verse", "verse"], ["stanza", "verse"], ["v", "verse"],
	["bridge", "bridge"],
	["intro", "intro"],
	["outro", "outro"], ["coda", "outro"], ["ending", "outro"], ["tag", "outro"], ["end", "outro"],
	["interlude", "interlude"], ["instrumental", "interlude"], ["solo", "interlude"], ["break", "interlude"],
	["spoken", "spoken"], ["rap", "verse"],
	// Myanmar: သံပြိုင် (chorus), အပိုဒ် (verse, stanza).
	["သံပြိုင်", "chorus"], ["အပိုဒ်", "verse"],
	// Zolai (Tedim): Sakkik (chorus), Tang (verse), as in the hymnbook.
	["sakkik", "chorus"], ["tang", "verse"],
];

/** The section kinds, as labelled when a section has no label of its own. */
export const SECTION_LABELS = { verse: "Verse", chorus: "Chorus", prechorus: "Pre-chorus", postchorus: "Post-chorus", bridge: "Bridge", intro: "Intro", outro: "Outro", interlude: "Interlude", spoken: "Spoken", other: "" };

const CHORD = /^(?:N\.?C\.?|[A-G](?:#|b|♯|♭)?(?:maj|min|mi|m|M|dim|aug|sus|add|°|ø|\+|-)?\d{0,2}(?:(?:maj|min|sus|add|b|#|♭|♯|\+|-|\/)?\d{1,2})*(?:\([^)\s]{1,10}\))?(?:\/[A-G](?:#|b|♯|♭)?)?)$/;
export const isChord = (s) => CHORD.test(s);

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;
const LRC_TAG = /^\[(ar|ti|al|au|by|offset|length|re|ve|#)\s*:(.*)\]$/i;
const DIRECTIVE = /^\{\s*([A-Za-z_-]+)\s*(?::\s*([^}]*?))?\s*\}$/;
const PLAIN_DETAIL = /^(key|capo|tempo|bpm|time signature|time|hymn|original title|original|english title|english|words (?:and|&) music(?: by)?|words by|words|lyrics by|lyricist|music by|music|composer|tune|scripture)\s*[:=]\s*(.{1,80})$/i;
/** Detail names, as written at the top, to the name kept in `meta`. */
const DETAIL_NAMES = { bpm: "tempo", "time signature": "time", "original title": "original", "english title": "original", english: "original", "words by": "words", "lyrics by": "words", lyricist: "words", "music by": "music", composer: "music", tune: "music" };
const SECTION_REST = /^\s*(?:\d{1,2}[a-z]?|[ivx]{1,4}\b)?\.?\s*(?:[x×]\s?\d{1,2}|\d{1,2}\s?[x×]|\(\s*(?:[x×]\s?\d{1,2}|\d{1,2}\s?[x×])\s*\))?\s*(?:[:\-–—]\s*.{0,30})?$/;
const REPEAT = /(?:^|\s|\()(?:[x×]\s?(\d{1,2})|(\d{1,2})\s?[x×])\)?\s*$/i;

/** "Verse 2", "Chorus x2", "Chorus: Lal Pa" -> { kind, label, repeat }, or null when not a section name. */
export function sectionOf(raw) {
	const text = raw.trim().replace(/:$/, "").trim();
	if (!text || text.length > 40) return null;
	const lower = text.toLowerCase();
	for (const [word, kind] of SECTION_WORDS) {
		if (!lower.startsWith(word)) continue;
		// Only a number, a repeat and a singer may follow: "Verse 2", "V2", "Chorus x2",
		// "Chorus (2x)", "Chorus - Lal Pa"; never "Verse of my life" or "Versailles".
		if (!SECTION_REST.test(lower.slice(word.length))) continue;
		const rep = REPEAT.exec(text);
		return { kind, label: text.replace(REPEAT, "").trim() || SECTION_LABELS[kind], repeat: rep ? Number(rep[1] ?? rep[2]) : null };
	}
	return null;
}

/** A line of only chords (a chord sheet's line above the words): their columns, or null. */
function chordLine(line) {
	if (!line.trim()) return null;
	const out = [];
	const re = /\S+/g;
	let m;
	while ((m = re.exec(line))) {
		const token = m[0].replace(/^\(|\)$/g, "");
		if (token === "|" || token === "-" || /^[x×]\d$/i.test(token)) continue;
		if (!isChord(token)) return null;
		out.push({ at: m.index, chord: token });
	}
	return out.length ? out : null;
}

/** The words of a line with inline chords: [{ chord, text }]; chord is "" before the first. */
function inlineChords(line) {
	const parts = [];
	let chord = "";
	let text = "";
	let found = false;
	const re = /\[([^\]\s]{1,16})\]/g;
	let last = 0;
	let m;
	while ((m = re.exec(line))) {
		if (!isChord(m[1])) continue;
		text += line.slice(last, m.index);
		if (text || chord) parts.push({ chord, text });
		chord = m[1];
		text = "";
		last = re.lastIndex;
		found = true;
	}
	if (!found) return null;
	text += line.slice(last);
	parts.push({ chord, text });
	return parts;
}

/** Puts a chord line over the words below it, by column. */
function overWords(chords, words) {
	const parts = [];
	const first = chords[0].at;
	if (first > 0) parts.push({ chord: "", text: words.slice(0, first) });
	chords.forEach((c, i) => {
		const end = i + 1 < chords.length ? chords[i + 1].at : Infinity;
		parts.push({ chord: c.chord, text: words.slice(c.at, end) });
	});
	return parts;
}

const seconds = (m) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);

/** Leading LRC time tags: { times: [seconds], rest }, or null. */
function timesOf(line) {
	TIME.lastIndex = 0;
	const times = [];
	let m;
	let at = 0;
	while ((TIME.lastIndex = at, m = TIME.exec(line))) {
		times.push(seconds(m));
		at = TIME.lastIndex;
	}
	return times.length ? { times, rest: line.slice(at).trim() } : null;
}

const DIRECTIVE_META = { title: "title", t: "title", subtitle: "subtitle", st: "subtitle", artist: "artist", composer: "music", lyricist: "words", key: "key", capo: "capo", tempo: "tempo", time: "time", album: "album", year: "year", copyright: "copyright" };
const START = { start_of_chorus: "chorus", soc: "chorus", start_of_verse: "verse", sov: "verse", start_of_bridge: "bridge", sob: "bridge", start_of_tab: "tab", sot: "tab", start_of_grid: "tab", sog: "tab" };
const END = new Set(["end_of_chorus", "eoc", "end_of_verse", "eov", "end_of_bridge", "eob", "end_of_tab", "eot", "end_of_grid", "eog"]);
const COMMENT = new Set(["comment", "c", "comment_italic", "ci", "comment_box", "cb", "highlight"]);

/**
 * The structure of `text`:
 * {
 *   meta: { title, artist, key, capo, tempo, time, offset, ... },
 *   blocks: [{ kind, label, repeat, recall, auto, lines: [{ kind: "words"|"note"|"tab", parts: [{chord, text}], time }] }],
 *   chords: true when any line has chords,
 *   timed: true when lines carry times (LRC),
 *   formats: what was recognised, for the editor ("sections", "hymnbook", "chordpro", "chords", "lrc"),
 * }
 * Every line of a block has `parts`; without chords, one part with chord "".
 */
export function parseLyrics(text) {
	const meta = {};
	const formats = new Set();
	const blocks = [];
	let block = null;
	let inside = null; // a ChordPro section being read: its kind
	let started = false; // past the details at the top
	const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");

	let cur = 0; // the line being read
	// Blocks keep the lines of the text they span (src to last), for the studio's margin.
	const open = (kind, label, extra = {}) => {
		block = { kind, label, repeat: null, recall: false, auto: false, lines: [], src: cur, last: cur, ...extra };
		blocks.push(block);
		return block;
	};
	// Where in the text a line of words is, for writing times back (timing in the studio).
	const at = (line, src, col) => Object.assign(line, { src, col });
	const add = (line) => {
		if (!block) open("plain", "");
		block.lines.push(line);
		block.last = Math.max(block.last, line.src ?? cur);
		started = true;
	};
	const close = () => { block = null; };

	for (let i = 0; i < lines.length; i++) {
		cur = i;
		const raw = lines[i];
		const line = raw.trimEnd();
		const trimmed = line.trim();

		if (!trimmed) {
			// A section's name stays with the lines after it, even across a blank line.
			if (!inside && block?.lines.length) close();
			continue;
		}

		// ChordPro: {directive} or {directive: value}.
		const d = DIRECTIVE.exec(trimmed);
		if (d) {
			const name = d[1].toLowerCase();
			const value = (d[2] ?? "").trim();
			formats.add("chordpro");
			if (DIRECTIVE_META[name]) { if (value) meta[DIRECTIVE_META[name]] = value; continue; }
			if (START[name]) {
				inside = START[name];
				const kind = inside === "tab" ? "tab" : inside;
				open(kind, value || (kind === "tab" ? "" : SECTION_LABELS[kind]));
				continue;
			}
			if (END.has(name)) { if (block) block.last = i; inside = null; close(); continue; }
			if (name === "chorus") { recall(blocks, value, null, i); close(); continue; }
			if (COMMENT.has(name)) { add({ kind: "note", parts: [{ chord: "", text: value }], time: null, times: [] }); continue; }
			continue; // other directives (new_page, columns, define ...) change nothing on a screen
		}

		// LRC details: [ar: …] [offset: +250].
		const tag = LRC_TAG.exec(trimmed);
		if (tag) {
			formats.add("lrc");
			const name = tag[1].toLowerCase();
			const value = tag[2].trim();
			if (name === "offset") meta.offset = Number(value) / 1000 || 0;
			else if (name === "ti") meta.title = value;
			else if (name === "ar") meta.artist = value;
			else if (name === "al") meta.album = value;
			continue;
		}

		// Plain details at the very top: "Key: G", "Capo 2".
		const detail = !started && !block ? PLAIN_DETAIL.exec(trimmed) : null;
		if (detail) {
			const name = detail[1].toLowerCase();
			// "Words and music: X" credits both.
			if (/^words (and|&) music/.test(name)) meta.words = meta.music = detail[2].trim();
			else meta[DETAIL_NAMES[name] ?? name] = detail[2].trim();
			continue;
		}

		if (inside === "tab") { add({ kind: "tab", parts: [{ chord: "", text: line }], time: null, times: [] }); continue; }

		// A section of its own line: [Chorus], [Verse 2], Chorus:, Refrain:
		const bracket = /^\[([^\]]+)\]$/.exec(trimmed);
		const header = bracket && !isChord(bracket[1].trim()) && !/^\d{1,3}:\d/.test(bracket[1])
			? bracket[1]
			: !/:\s*\S/.test(trimmed) && sectionOf(trimmed) ? trimmed : null;
		if (header !== null) {
			const sec = sectionOf(header);
			formats.add(bracket ? "sections" : "hymnbook");
			// A bare chorus with nothing under it repeats the last one.
			const next = lines.slice(i + 1).find((l) => l.trim()) ?? "";
			const nextIsHeader = !next.trim() || /^\[[^\]]+\]$/.test(next.trim()) && !isChord(next.trim().slice(1, -1));
			const blankAfter = (lines[i + 1] ?? "").trim() === "" && blocks.some((b) => b.kind === "chorus" && b.lines.length);
			if (sec?.kind === "chorus" && (blankAfter || nextIsHeader) && blocks.some((b) => b.kind === "chorus" && b.lines.length)) {
				recall(blocks, sec.label, sec.repeat, i);
				close();
				continue;
			}
			open(sec?.kind ?? "other", sec?.label ?? header.trim(), { repeat: sec?.repeat ?? null });
			continue;
		}

		// Hymnbook: "Chorus: first words" on one line.
		const inlineHeader = /^([^:]{1,24}):\s+(\S.*)$/.exec(trimmed);
		const inlineSec = inlineHeader && !block?.lines.length ? sectionOf(inlineHeader[1]) : null;
		if (inlineSec) {
			formats.add("hymnbook");
			open(inlineSec.kind, inlineSec.label, { repeat: inlineSec.repeat });
			add(at(wordsLine(inlineHeader[2], formats), i, line.indexOf(inlineHeader[2])));
			continue;
		}

		// Hymnbook: a numbered stanza, "1. Words" opening a block.
		const numbered = !block ? /^(\d{1,2})[.)]\s+(\S.*)$/.exec(trimmed) : null;
		if (numbered) {
			formats.add("hymnbook");
			// Labelled by its number alone, as hymnbooks print it, whatever the language of the rest.
			open("verse", numbered[1]);
			add(at(wordsLine(numbered[2], formats), i, line.indexOf(numbered[2])));
			continue;
		}

		// A note: (spoken), (repeat chorus), *softly*.
		if (/^\(.*\)$/.test(trimmed) && !chordLine(trimmed)) {
			add({ kind: "note", parts: [{ chord: "", text: trimmed.slice(1, -1).trim() }], time: null, times: [] });
			continue;
		}

		// A line of chords: over the words below it, or on its own.
		const chords = chordLine(line);
		if (chords) {
			formats.add("chords");
			const below = lines[i + 1];
			if (below !== undefined && below.trim() && !chordLine(below) && !DIRECTIVE.test(below.trim()) && !/^\[[^\]]+\]$/.test(below.trim())) {
				add(at({ kind: "words", parts: overWords(chords, below.trimEnd()), time: null, times: [] }, i + 1, 0));
				i++;
			} else {
				add({ kind: "words", parts: chords.map((c) => ({ chord: c.chord, text: " " })), time: null, times: [] });
			}
			continue;
		}

		const words = at(wordsLine(trimmed, formats), i, line.length - line.trimStart().length);
		if (words.parts.some((p) => p.chord)) formats.add("chordpro");
		add(words);
	}

	if (!blocks.some((b) => b.kind !== "plain" && b.kind !== "tab")) findChorus(blocks);
	if (formats.has("hymnbook")) chorusAfterEachVerse(blocks);
	const timed = blocks.some((b) => b.lines.some((l) => l.times?.length));
	if (timed) placeTimes(blocks);
	for (const b of blocks) if (b.kind === "plain") b.kind = "verse";
	return {
		meta,
		blocks: blocks.filter((b) => b.lines.length || b.recall || b.label),
		chords: blocks.some((b) => b.lines.some((l) => l.parts.some((p) => p.chord))),
		timed,
		formats: [...formats],
	};
}

/** A line of words: its chords, and its LRC times when it starts with them ("[00:12.50]words"). */
function wordsLine(line, formats) {
	const t = timesOf(line);
	if (t) formats?.add("lrc");
	const words = t ? t.rest : line;
	return { kind: "words", parts: inlineChords(words) ?? [{ chord: "", text: words }], time: t?.times[0] ?? null, times: t?.times ?? [] };
}

/** A line shown again (a repeated chorus): the same words, timed by the line's later times. */
const again = (l) => ({ ...l, of: l.of ?? l, time: null, times: [] });

/** A recall of the last chorus (labelled as asked): its lines again, marked. */
function recall(blocks, label, repeat = null, src = null) {
	const last = [...blocks].reverse().find((b) => b.kind === "chorus" && !b.recall && b.lines.length);
	blocks.push({ kind: "chorus", label: label || last?.label || SECTION_LABELS.chorus, repeat, recall: true, auto: false, lines: last ? last.lines.map(again) : [], src, last: src });
}

/**
 * A line with several times ("[00:33.80][01:40.10]Vang-liat-na!") is sung
 * more than once: its first time is its own, the next go to the places it
 * is shown again (a repeated chorus), in order. Times left over with no
 * place to go (an LRC file that writes a repeated line once) put every line
 * in the order it is sung instead, as plain timed lines.
 */
function placeTimes(blocks) {
	const used = new Map();
	for (const b of blocks) {
		for (const l of b.lines) {
			if (!l.of) continue;
			const k = (used.get(l.of) ?? 0) + 1;
			used.set(l.of, k);
			l.time = l.of.times[k] ?? null;
		}
	}
	const all = blocks.flatMap((b) => b.lines);
	if (!all.some((l) => !l.of && l.times.length > 1 + (used.get(l) ?? 0))) return;
	const sung = all.filter((l) => !l.of).flatMap((l) => (l.times.length ? l.times.map((t) => ({ ...l, time: t })) : [l]));
	sung.sort((a, b) => (a.time ?? -1) - (b.time ?? -1));
	blocks.splice(0, blocks.length, { kind: "plain", label: "", repeat: null, recall: false, auto: false, lines: sung });
}

/**
 * Hymnbooks print the chorus once, after the first verse, and it is sung
 * after every verse. When the lyrics have one chorus, written right after a
 * verse and never repeated, it is shown again after each later verse (as a
 * repeat). A chorus written out more than once, or recalled, is left as it is.
 */
function chorusAfterEachVerse(blocks) {
	const choruses = blocks.filter((b) => b.kind === "chorus");
	if (choruses.length !== 1 || !choruses[0].lines.length) return;
	const at = blocks.indexOf(choruses[0]);
	if (blocks[at - 1]?.kind !== "verse") return;
	for (let i = blocks.length - 1; i > at; i--) {
		if (blocks[i].kind !== "verse" || blocks[i + 1]?.kind === "chorus") continue;
		const c = choruses[0];
		blocks.splice(i + 1, 0, { kind: "chorus", label: c.label, repeat: null, recall: true, auto: true, lines: c.lines.map(again), src: null, last: null });
	}
}

/** Lyrics without sections: a block of two or more lines that comes back the same is the chorus. */
function findChorus(blocks) {
	const key = (b) => b.lines.map((l) => l.parts.map((p) => p.text).join("").trim().toLowerCase()).join("\n");
	const seen = new Map();
	for (const b of blocks) {
		if (b.lines.length < 2 || b.kind === "tab") continue;
		const k = key(b);
		seen.set(k, (seen.get(k) ?? 0) + 1);
	}
	let first = true;
	for (const b of blocks) {
		if (b.lines.length >= 2 && (seen.get(key(b)) ?? 0) >= 2) {
			Object.assign(b, { kind: "chorus", label: SECTION_LABELS.chorus, auto: true, recall: !first });
			first = false;
		}
	}
}

/* ------------------------------------------------------------ chords ---- */

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE = /^([A-G])(#|b|♯|♭)?/;

function step(note, by, flats) {
	const m = NOTE.exec(note);
	if (!m) return note;
	const base = SHARPS.indexOf(m[1]);
	const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
	const n = (((base + acc + by) % 12) + 12) % 12;
	return (flats ? FLATS : SHARPS)[n] + note.slice(m[0].length);
}

/** A chord moved by `by` semitones ("G" +2 -> "A", "D/F#" -> "E/G#"); flats when the song is written with flats. */
export function transposeChord(chord, by, flats = false) {
	if (!by || !isChord(chord) || /^N\.?C/.test(chord)) return chord;
	const [root, bass] = chord.split("/");
	return bass && NOTE.test(bass) ? `${step(root, by, flats)}/${step(bass, by, flats)}` : step(chord, by, flats);
}

/** True when the song's chords lean on flats (Bb, Eb ...), so transposing keeps to flats. */
export function prefersFlats(parsed) {
	let flats = 0;
	let sharps = 0;
	const count = (c) => { if (/^[A-G]b|\/[A-G]b/.test(c)) flats++; if (/^[A-G]#|\/[A-G]#/.test(c)) sharps++; };
	if (parsed.meta.key) count(parsed.meta.key);
	for (const b of parsed.blocks) for (const l of b.lines) for (const p of l.parts) if (p.chord) count(p.chord);
	return flats > sharps || (flats === sharps && /^(F|Bb|Eb|Ab|Db|Gb|Dm|Gm|Cm|Fm)/.test(parsed.meta.key ?? ""));
}

/** The index of the line being sung at `position` seconds, over all lines in order; -1 before the first. */
export function lineAt(parsed, position) {
	const at = position + (parsed.meta.offset ?? 0);
	let found = -1;
	let n = 0;
	for (const b of parsed.blocks) {
		for (const l of b.lines) {
			if (l.time !== null && l.time <= at) found = n;
			n++;
		}
	}
	return found;
}

/* ------------------------------------------------- checks and fixes ---- */

/**
 * True when Myanmar text is in the Zawgyi font encoding rather than Unicode
 * (docs/lyrics.md): Zaideih keeps Unicode only, and Zawgyi shows as broken
 * letters everywhere else. Two signs that cannot occur in Unicode Burmese:
 * the vowel sign E (U+1031) at the start of a word (Zawgyi stores it before
 * its consonant), and the virama (U+1039) not followed by a consonant
 * (Zawgyi uses it as the visible asat). Two such signs are needed, so one
 * stray character in otherwise good text is not taken for Zawgyi.
 */
export function looksZawgyi(text) {
	const s = String(text ?? "");
	if (!/[က-႟]/.test(s)) return false;
	const eFirst = (s.match(/(?:^|[^က-႟])ေ/gm) ?? []).length;
	const looseVirama = (s.match(/္(?![က-အ])/g) ?? []).length;
	return eFirst + looseVirama >= 2;
}

const SYLLABLE = /(\S) +[-–] +(?=\S)/g;
/** True when the text looks copied from sheet music, words split into syllables: "To - pa ngak". */
export const hasSheetSyllables = (text) => (String(text ?? "").match(SYLLABLE) ?? []).length >= 3;
/** Joins sheet-music syllables ("To - pa" -> "Topa") and drops a hyphen left at a line's end; other hyphens stay. */
export const joinSyllables = (text) => String(text ?? "").replace(SYLLABLE, "$1").replace(/ +[-–]$/gm, "");

/** Seconds as LRC writes them: "01:23.40". */
export function lrcTime(seconds) {
	const cs = Math.max(0, Math.round(seconds * 100));
	const m = Math.floor(cs / 6000);
	const s = Math.floor((cs % 6000) / 100);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/**
 * The text with line `src` given these times (seconds), written where its
 * words start (`col`, after "1. " or "Sakkik: "); its old times are replaced.
 * No times takes them away.
 */
export function setLineTimes(text, src, col, times) {
	const lines = String(text).split("\n");
	const line = lines[src] ?? "";
	const head = line.slice(0, col);
	const rest = line.slice(col).replace(/^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/, "");
	lines[src] = head + times.map((t) => `[${lrcTime(t)}]`).join("") + rest;
	return lines.join("\n");
}

/** Takes every LRC time out of the text (the lines and the [offset] line stay as they were otherwise). */
export function clearTimes(text) {
	return String(text).split("\n").filter((l) => !/^\[offset\s*:/i.test(l.trim())).map((l) => l.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, "")).join("\n");
}

/** The detail a line at the top gives ("Key: Eb", "{key: G}"), as its `meta` name, or null. */
function isDetail(line) {
	const t = line.trim();
	const plain = PLAIN_DETAIL.exec(t);
	if (plain) return /^words (and|&) music/i.test(plain[1]) ? "words" : DETAIL_NAMES[plain[1].toLowerCase()] ?? plain[1].toLowerCase();
	const d = DIRECTIVE.exec(t);
	if (d && DIRECTIVE_META[d[1].toLowerCase()]) return DIRECTIVE_META[d[1].toLowerCase()];
	return null;
}

/** How many lines at the top are details (blank lines between them, and after them, included). */
function detailLines(lines) {
	let end = 0;
	while (end < lines.length) {
		if (isDetail(lines[end])) { end++; continue; }
		if (!lines[end].trim() && end > 0) {
			const next = lines.slice(end).findIndex((l) => l.trim());
			if (next < 0) { end = lines.length; break; }
			if (isDetail(lines[end + next])) { end += next; continue; }
			end += next;
		}
		break;
	}
	return end;
}

/**
 * The details at the top and the words after them: { head, body, offset }.
 * The studio edits the body and shows the details as chips; `offset` is the
 * line in the text where the body starts. head + body is the text again.
 */
export function splitDetails(text) {
	const lines = String(text ?? "").split("\n");
	const offset = detailLines(lines);
	return { head: lines.slice(0, offset).map((l) => `${l}\n`).join(""), body: lines.slice(offset).join("\n"), offset };
}

/** The details the studio offers, in order, as written at the top of the lyrics. */
export const DETAILS = [
	["key", "Key"], ["time", "Time"], ["tempo", "Tempo"], ["capo", "Capo"],
	["hymn", "Hymn"], ["original", "Original title"], ["words", "Words"], ["music", "Music"], ["scripture", "Scripture"],
];

/**
 * The text with detail `name` (a `meta` name: "key", "words" ...) set to
 * `value`, written at the top as "Key: Eb", replacing the line that gives it
 * now (plain or ChordPro); an empty value takes it away. Other details keep
 * their place; a blank line keeps the details apart from the words.
 */
export function setDetail(text, name, value) {
	const label = DETAILS.find(([n]) => n === name)?.[1];
	if (!label) throw new Error(`no such detail: ${name}`);
	const v = String(value ?? "").replace(/\s+/g, " ").trim();
	const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
	const end = detailLines(lines);
	const head = lines.slice(0, end).filter((l) => l.trim());
	const body = lines.slice(end);
	const at = head.findIndex((l) => isDetail(l) === name);
	const written = v ? (DIRECTIVE.test(head[at]?.trim() ?? "") ? `{${name === "words" ? "lyricist" : name === "music" ? "composer" : name}: ${v}}` : `${label}: ${v}`) : null;
	if (at >= 0) {
		if (written) head[at] = written;
		else head.splice(at, 1);
	} else if (written) {
		head.push(written);
	}
	while (body.length && !body[0].trim()) body.shift();
	if (!head.length) return body.join("\n");
	return body.length ? `${head.join("\n")}\n\n${body.join("\n")}` : head.join("\n");
}

/**
 * What is sung, for searching (worker/media/lyrics.js keeps it with the
 * lyrics): each line of words once, without times, chords, details or notes,
 * and the original title first when there is one.
 */
export function lyricsWords(text) {
	const p = parseLyrics(text);
	const lines = p.meta.original ? [p.meta.original] : [];
	for (const b of p.blocks) {
		if (b.recall) continue;
		for (const l of b.lines) {
			if (l.kind !== "words" || l.of) continue;
			const t = l.parts.map((x) => x.text).join("").replace(/\s+/g, " ").trim();
			if (t) lines.push(t);
		}
	}
	return [...new Set(lines)].join("\n");
}
