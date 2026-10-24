import assert from "node:assert/strict";
import { test } from "node:test";
import { clearTimes, hasSheetSyllables, isChord, joinSyllables, lineAt, looksZawgyi, lrcTime, parseLyrics, prefersFlats, sectionOf, setLineTimes, transposeChord } from "../src/core/lyrics-format.js";

const words = (line) => line.parts.map((p) => p.text).join("");
const shape = (parsed) => parsed.blocks.map((b) => [b.kind, b.label, b.lines.map(words)]);

test("section names: what they are, and what is only a line of words", () => {
	assert.deepEqual(sectionOf("Verse 2"), { kind: "verse", label: "Verse 2", repeat: null });
	assert.deepEqual(sectionOf("Chorus x2"), { kind: "chorus", label: "Chorus", repeat: 2 });
	assert.deepEqual(sectionOf("Chorus (2x)"), { kind: "chorus", label: "Chorus", repeat: 2 });
	assert.equal(sectionOf("Pre-Chorus").kind, "prechorus");
	assert.equal(sectionOf("Refrain:").kind, "chorus");
	assert.equal(sectionOf("V2").kind, "verse");
	assert.equal(sectionOf("Chorus - Lal Pa").kind, "chorus");
	assert.equal(sectionOf("သံပြိုင်").kind, "chorus");
	for (const words of ["Verse of my life", "Versailles", "Change my heart", "Chorus of angels sing", "End of the road"]) assert.equal(sectionOf(words), null, words);
});

test("chords: names, and transposing", () => {
	for (const c of ["G", "Am", "C#m7", "Bb", "Dsus4", "Cmaj7", "D/F#", "G7(b9)", "Eb/Bb", "N.C.", "Fadd9", "Bdim", "A7sus4"]) assert.ok(isChord(c), c);
	for (const w of ["Ama", "Dim", "Ka", "I", "Be", "Hello", "Amen"]) assert.ok(!isChord(w), w);
	assert.equal(transposeChord("G", 2), "A");
	assert.equal(transposeChord("D/F#", 2), "E/G#");
	assert.equal(transposeChord("Bb", 2, true), "C");
	assert.equal(transposeChord("A", 1, true), "Bb");
	assert.equal(transposeChord("C#m7", -1), "Cm7");
	assert.equal(transposeChord("N.C.", 3), "N.C.");
});

test("plain lyrics: verses, and a block that comes back is the chorus", () => {
	const p = parseLyrics("Line one\nLine two\n\nSing it loud\nSing it proud\n\nLine three\nLine four\n\nSing it loud\nSing it proud");
	assert.deepEqual(p.blocks.map((b) => [b.kind, b.auto, b.recall]), [["verse", false, false], ["chorus", true, false], ["verse", false, false], ["chorus", true, true]]);
	assert.equal(p.chords, false);
	assert.deepEqual(p.formats, []);
});

test("Genius-style sections, a bare [Chorus] repeats the last chorus", () => {
	const p = parseLyrics("[Intro]\nOoh\n\n[Verse 1]\nFirst words\n\n[Chorus]\nHallelujah\nPraise\n\n[Verse 2]\nSecond words\n\n[Chorus]\n\n[Bridge x2]\nHigher");
	assert.deepEqual(shape(p), [
		["intro", "Intro", ["Ooh"]], ["verse", "Verse 1", ["First words"]], ["chorus", "Chorus", ["Hallelujah", "Praise"]],
		["verse", "Verse 2", ["Second words"]], ["chorus", "Chorus", ["Hallelujah", "Praise"]], ["bridge", "Bridge", ["Higher"]],
	]);
	assert.equal(p.blocks[4].recall, true);
	assert.equal(p.blocks[5].repeat, 2);
	assert.deepEqual(p.formats, ["sections"]);
});

test("a section name above a blank line keeps the lines after it", () => {
	const p = parseLyrics("[Chorus]\n\nGlory\nGlory");
	assert.deepEqual(shape(p), [["chorus", "Chorus", ["Glory", "Glory"]]]);
});

test("hymnbook style: numbered stanzas and Chorus: lines", () => {
	const p = parseLyrics("1. Amazing grace how sweet\nThat saved a wretch\n\nChorus:\nMy chains are gone\n\n2. Twas grace that taught\nMy heart to fear\n\nRefrain: I once was lost");
	assert.deepEqual(shape(p), [
		["verse", "1", ["Amazing grace how sweet", "That saved a wretch"]], ["chorus", "Chorus", ["My chains are gone"]],
		["verse", "2", ["Twas grace that taught", "My heart to fear"]], ["chorus", "Refrain", ["I once was lost"]],
	]);
	assert.deepEqual(p.formats, ["hymnbook"]);
});

test("ChordPro: details, sections, inline chords and comments", () => {
	const p = parseLyrics("{title: Amazing Grace}\n{key: G}\n{capo: 2}\n{tempo: 72}\n\n{start_of_verse: Verse 1}\nA[G]mazing [G7]grace how [C]sweet the [G]sound\n{c: softly}\n{end_of_verse}\n\n{soc}\n[D]My chains are gone\n\nI've been set free\n{eoc}\n\n{chorus}");
	assert.deepEqual(p.meta, { title: "Amazing Grace", key: "G", capo: "2", tempo: "72" });
	assert.equal(p.chords, true);
	assert.deepEqual(p.blocks[0].lines[0].parts, [{ chord: "", text: "A" }, { chord: "G", text: "mazing " }, { chord: "G7", text: "grace how " }, { chord: "C", text: "sweet the " }, { chord: "G", text: "sound" }]);
	assert.deepEqual(p.blocks[0].lines[1], { kind: "note", parts: [{ chord: "", text: "softly" }], time: null, times: [] });
	assert.deepEqual(shape(p).slice(1), [["chorus", "Chorus", ["My chains are gone", "I've been set free"]], ["chorus", "Chorus", ["My chains are gone", "I've been set free"]]]);
	assert.equal(p.blocks[2].recall, true);
	assert.ok(p.formats.includes("chordpro"));
});

test("chord sheets: a line of chords sits over the words below it", () => {
	const p = parseLyrics("Key: D\n\n[Verse]\nD       G         D\nAmazing grace how sweet\nA7\n\n[Chorus]\nG   A   D");
	assert.equal(p.meta.key, "D");
	assert.deepEqual(p.blocks[0].lines[0].parts, [{ chord: "D", text: "Amazing " }, { chord: "G", text: "grace how " }, { chord: "D", text: "sweet" }]);
	assert.deepEqual(p.blocks[0].lines[1].parts, [{ chord: "A7", text: " " }]);
	assert.deepEqual(p.blocks[1].lines[0].parts.map((x) => x.chord), ["G", "A", "D"]);
	assert.equal(prefersFlats(p), false);
});

test("words that look like a chord line stay words", () => {
	const p = parseLyrics("Ka Pa Ama\nA new day\nAm I alone");
	assert.equal(p.chords, false);
	assert.deepEqual(p.blocks[0].lines.map(words), ["Ka Pa Ama", "A new day", "Am I alone"]);
});

test("LRC: details, times (several on one line), and the line being sung", () => {
	const p = parseLyrics("[ti:Song]\n[ar:Singer]\n[offset:+500]\n[00:05.00]First\n[00:10.50][00:30.00]Again\n[00:20.00]Middle");
	assert.equal(p.timed, true);
	assert.deepEqual(p.meta, { title: "Song", artist: "Singer", offset: 0.5 });
	assert.deepEqual(p.blocks.flatMap((b) => b.lines.map((l) => [l.time, words(l)])), [[5, "First"], [10.5, "Again"], [20, "Middle"], [30, "Again"]]);
	assert.equal(lineAt(p, 0), -1);
	assert.equal(lineAt(p, 10.1), 1, "with the offset, 10.1 s is 10.6 s");
	assert.equal(lineAt(p, 25), 2);
});

test("notes in brackets, unknown sections, and nothing refused", () => {
	const p = parseLyrics("[Lasak]\nWords here\n(spoken)\n\n{new_page}\n{define: G 3 2 0 0 0 3}\n[Not a [chord]]");
	assert.equal(p.blocks[0].kind, "other");
	assert.equal(p.blocks[0].label, "Lasak");
	assert.equal(p.blocks[0].lines[1].kind, "note");
	assert.equal(parseLyrics("").blocks.length, 0);
	assert.doesNotThrow(() => parseLyrics("[[[\n{{{\n}}}\n[00:\n1.\nChorus:"));
});

test("Zolai hymnbook: Tang and Sakkik, the chorus sung after every verse", () => {
	assert.equal(sectionOf("Sakkik:").kind, "chorus");
	assert.equal(sectionOf("Tang 2").kind, "verse");
	for (const words of ["Tang ding hi", "Sakkik ka lawm"]) assert.equal(sectionOf(words), null, words);
	// Hymn 167, as typed from the book: the Sakkik once, after verse 1.
	const p = parseLyrics(`1. Topa ngak ta un, Kam hong ciam khin zo hi;
Topa ngak ta un, van pan hong tuak ding hi;

Sakkik:
Vang-liat-na! vang-liat-na! (Pen-te-kos vang-liat-na!)
Mawh-na tung gual-zawh-na le lung-sim sian-tho-na;

2. Topa ngak ta un, Jesu tung ki-ap-in;
Topa ngak ta un, mawh-na a sian' dong-in;

3. Topa ngak ta un, a sang-zaw kah na'ng-in;
Topa ngak ta un, deih-na lian-pi nei-in;`);
	assert.deepEqual(p.blocks.map((b) => [b.kind, b.label, b.recall]), [
		["verse", "1", false], ["chorus", "Sakkik", false], ["verse", "2", false], ["chorus", "Sakkik", true], ["verse", "3", false], ["chorus", "Sakkik", true],
	]);
	assert.equal(p.blocks[3].lines.length, 2);
	// [Tang 1] and [Sakkik] in brackets work the same; a chorus written out each time is left alone.
	const q = parseLyrics("[Tang 1]\nA\n\n[Sakkik]\nB\nC\n\n[Tang 2]\nD\n\n[Sakkik]");
	assert.deepEqual(q.blocks.map((b) => [b.kind, b.label, b.recall]), [["verse", "Tang 1", false], ["chorus", "Sakkik", false], ["verse", "Tang 2", false], ["chorus", "Sakkik", true]]);
});

test("credits at the top: hymn number, original title, words, music, scripture", () => {
	const p = parseLyrics("Hymn: 167\nOriginal title: Waiting on the Lord\nWords: C. F. Weigle\nMusic by: Charles F. Weigle\nScripture: Luk. 24:49\nKey: Eb\n\n1. Topa ngak ta un");
	assert.deepEqual(p.meta, { hymn: "167", original: "Waiting on the Lord", words: "C. F. Weigle", music: "Charles F. Weigle", scripture: "Luk. 24:49", key: "Eb" });
	assert.equal(parseLyrics("{composer: A}\n{lyricist: B}\nx").meta.music, "A");
});

test("Zawgyi is told from Unicode", () => {
	assert.equal(looksZawgyi("နေကောင်းလား"), false, "Unicode");
	assert.equal(looksZawgyi("ဖေဖေ နဲ့ မေမေ"), false, "Unicode, E after its consonant");
	assert.equal(looksZawgyi("ေနေကာင္းလား"), true, "Zawgyi: E first, virama as asat");
	assert.equal(looksZawgyi("Topa ngak ta un"), false);
	assert.equal(looksZawgyi("မင်္ဂလာ"), false, "a real stacked consonant");
});

test("sheet-music syllables are found and joined; real hyphens stay", () => {
	const sheet = "To - pa ngak ta un, Je - su tung ki - ap - in;\nVang-liat - na! vang-liat -";
	assert.equal(hasSheetSyllables(sheet), true);
	assert.equal(joinSyllables(sheet), "Topa ngak ta un, Jesu tung kiapin;\nVang-liatna! vang-liat");
	assert.equal(hasSheetSyllables("Vang-liat-na! Pen-te-kos"), false);
});

test("times for a chorus sung after every verse; writing times back into the text", () => {
	const text = "1. [00:05.00]Verse one\n\nSakkik:\n[00:10.00][00:30.00][00:50.00]Chorus line\n\n2. [00:20.00]Verse two\n\n3. [00:40.00]Verse three";
	const p = parseLyrics(text);
	assert.deepEqual(p.blocks.map((b) => [b.label, b.lines.map((l) => l.time)]), [["1", [5]], ["Sakkik", [10]], ["2", [20]], ["Sakkik", [30]], ["3", [40]], ["Sakkik", [50]]]);
	assert.equal(lineAt(p, 31), 3);
	// A repeated line written once with no place to repeat: lines in the order sung.
	const flat = parseLyrics("[00:10.00][00:30.00]Again\n[00:20.00]Middle");
	assert.deepEqual(flat.blocks.flatMap((b) => b.lines.map((l) => l.time)), [10, 20, 30]);
	// Where each line's words start, and times written there.
	const q = parseLyrics("1. Verse one\nSecond line\n\nSakkik: Chorus here");
	const [l1, l2] = q.blocks[0].lines;
	assert.deepEqual([l1.src, l1.col, l2.src, l2.col], [0, 3, 1, 0]);
	let t = setLineTimes("1. Verse one\nSecond line\n\nSakkik: Chorus here", l1.src, l1.col, [5.25]);
	t = setLineTimes(t, q.blocks[1].lines[0].src, q.blocks[1].lines[0].col, [12, 61.5]);
	assert.equal(t, "1. [00:05.25]Verse one\nSecond line\n\nSakkik: [00:12.00][01:01.50]Chorus here");
	assert.equal(setLineTimes(t, 0, 3, [6]), "1. [00:06.00]Verse one\nSecond line\n\nSakkik: [00:12.00][01:01.50]Chorus here");
	assert.equal(clearTimes(`[offset:+100]\n${t}`), "1. Verse one\nSecond line\n\nSakkik: Chorus here");
	assert.equal(lrcTime(83.4), "01:23.40");
});

test("parts know the lines of the text they span", () => {
	const p = parseLyrics("Key: Eb\n\n1. One\nTwo\n\nSakkik:\nC1\nC2\n\n2. Three");
	assert.deepEqual(p.blocks.map((b) => [b.label, b.src, b.last, b.recall]), [["1", 2, 3, false], ["Sakkik", 5, 7, false], ["2", 9, 9, false], ["Sakkik", null, null, true]]);
});

test("setDetail writes the details at the top, replacing, adding and taking away", async () => {
	const { setDetail } = await import("../src/core/lyrics-format.js");
	assert.equal(setDetail("1. One", "key", "Eb"), "Key: Eb\n\n1. One");
	assert.equal(setDetail("Key: Eb\n\n1. One", "time", "4/4"), "Key: Eb\nTime: 4/4\n\n1. One");
	assert.equal(setDetail("Key: Eb\nTime: 4/4\n\n1. One", "key", "F"), "Key: F\nTime: 4/4\n\n1. One");
	assert.equal(setDetail("Key: Eb\nWords by: X\n\n1. One", "words", "Y"), "Key: Eb\nWords: Y\n\n1. One");
	assert.equal(setDetail("Key: Eb\nTime: 4/4\n\n1. One", "key", ""), "Time: 4/4\n\n1. One");
	assert.equal(setDetail("{key: G}\n{title: X}\n\nWords", "key", "A"), "{key: A}\n{title: X}\n\nWords");
	assert.equal(setDetail("", "hymn", "167"), "Hymn: 167");
	assert.equal(parseLyrics(setDetail("1. One", "original", "Waiting on the Lord")).meta.original, "Waiting on the Lord");
	assert.throws(() => setDetail("x", "nope", "1"), /no such detail/);
});

test("splitDetails: the details at the top, and the words after them", async () => {
	const { splitDetails } = await import("../src/core/lyrics-format.js");
	assert.deepEqual(splitDetails("Key: Eb\nTime: 4/4\n\n1. One\nTwo"), { head: "Key: Eb\nTime: 4/4\n\n", body: "1. One\nTwo", offset: 3 });
	assert.deepEqual(splitDetails("1. One"), { head: "", body: "1. One", offset: 0 });
	assert.deepEqual(splitDetails("Key: Eb"), { head: "Key: Eb\n", body: "", offset: 1 });
	const t = "{key: G}\n\nKey: G\n\nWords";
	const s = splitDetails(t);
	assert.equal(s.head + s.body, t);
	assert.equal(s.body, "Words");
});

test("Words and music: one credit for both", () => {
	const p = parseLyrics("Words & Music: Charles F. Weigle\nKey: Eb\n\nOne");
	assert.deepEqual([p.meta.words, p.meta.music, p.meta.key], ["Charles F. Weigle", "Charles F. Weigle", "Eb"]);
	assert.equal(parseLyrics("Words and music by: A\n\nx").meta.music, "A");
});

test("extractTimes and applyTimes move one recording's timing in and out of a text", async () => {
	const { extractTimes, applyTimes, clearTimes } = await import("../src/core/lyrics-format.js");
	const hymn = "1. [00:05.00]Topa ngak ta un\n[00:08.50]Vang liat na\n\nSakkik:\n[00:12.00]Hallelujah\n\n2. [00:30.00]Second verse\n[00:33.00]and more";
	const times = extractTimes(hymn);
	assert.deepEqual(times, [[5], [8.5], [12], [30], [33]]);
	assert.equal(applyTimes(clearTimes(hymn), times), hymn, "after the verse number, as Timing writes them");
	assert.deepEqual(extractTimes(clearTimes(hymn)), [], "an untimed text has none");
	assert.equal(applyTimes(hymn, []), clearTimes(hymn), "none takes them away");
	// Lines added later keep the times of the lines before them; the rest follow by order.
	assert.match(applyTimes("1. One\nTwo\nThree", [[1], [2]]), /^1\. \[00:01\.00\]One\n\[00:02\.00\]Two\nThree$/);
});
