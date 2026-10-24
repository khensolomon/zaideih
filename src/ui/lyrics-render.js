/**
 * Lyrics as shown (docs/lyrics.md, "How lyrics are shown"): the structure
 * core/lyrics-format.js found, drawn with each section labelled, the chorus
 * marked, details as chips, notes set apart, chords over the words (when
 * shown) and timed lines ready to follow the song.
 */
import { html } from "../core/html.js";
import { transposeChord } from "../core/lyrics-format.js";
import { scriptClass } from "./parts.js";

const CHORDS_KEY = "zaideih.lyrics.chords";

/** Whether this device shows chords (off until turned on; kept on the device). */
export function chordsShown() {
	try { return localStorage.getItem(CHORDS_KEY) === "on"; } catch { return false; }
}
export function showChords(on) {
	try { localStorage.setItem(CHORDS_KEY, on ? "on" : "off"); } catch { /* this visit only */ }
}

/** The details at the top: key (as transposed), capo, tempo, time. */
export function detailChips(parsed, { transpose = 0, flats = false } = {}) {
	const m = parsed.meta;
	const chips = [];
	if (m.key) chips.push(["Key", transpose ? `${transposeChord(m.key, transpose, flats)} (from ${m.key})` : m.key]);
	if (m.capo && m.capo !== "0") chips.push(["Capo", m.capo]);
	if (m.tempo) chips.push(["Tempo", /^\d+$/.test(m.tempo) ? `${m.tempo} bpm` : m.tempo]);
	if (m.time) chips.push(["Time", m.time]);
	if (!chips.length) return "";
	return html`<ul class="ly-chips" aria-label="Song details">${chips.map(([k, v]) => html`<li><span>${k}</span> ${v}</li>`)}</ul>`;
}

function lineHtml(line, n, { chords, transpose, flats }) {
	const text = line.parts.map((p) => p.text).join("");
	if (line.kind === "note") return html`<p class="ly-note">${text}</p>`;
	if (line.kind === "tab") return html`<pre class="ly-tab">${text}</pre>`;
	const time = line.time ?? "";
	if (!(chords && line.parts.some((p) => p.chord))) {
		return html`<p class="ly-line ${scriptClass(text)}" data-n="${n}" data-time="${time}">${text.trim() ? text : "\u00a0"}</p>`;
	}
	return html`<p class="ly-line ly-chorded ${scriptClass(text)}" data-n="${n}" data-time="${time}">${line.parts.map((p) => html`<span class="ly-seg"><b class="ly-chord">${p.chord ? transposeChord(p.chord, transpose, flats) : "\u00a0"}</b><span class="ly-w">${p.text || "\u00a0"}</span></span>`)}</p>`;
}

/**
 * The lyrics: one <section> per part. Lines are numbered in order
 * (data-n) for following timed lyrics; repeated choruses are marked.
 */
export function lyricsHtml(parsed, opts = {}) {
	const o = { chords: false, transpose: 0, flats: false, ...opts };
	let n = 0;
	return html`<div class="ly-body${parsed.timed ? " ly-timed" : ""}">${parsed.blocks.map((b) => html`<section class="ly-block ly-${b.kind}${b.recall ? " ly-recall" : ""}">
		${b.label ? html`<h3 class="ly-part">${b.label}${b.repeat ? html` <span class="ly-repeat">×${b.repeat}</span>` : ""}</h3>` : ""}
		${b.lines.map((l) => lineHtml(l, n++, o))}
	</section>`)}</div>`;
}

/** What the editor shows under the text: what was recognised in it. */
export function formatHint(parsed) {
	const names = { sections: "sections", hymnbook: "hymnbook sections", chordpro: "ChordPro", chords: "chord lines", lrc: "timed lines (LRC)" };
	const found = parsed.formats.map((f) => names[f]).filter(Boolean);
	if (parsed.blocks.some((b) => b.auto)) found.push("a repeated chorus");
	return found.length ? `Recognised: ${found.join(", ")}.` : "Plain lyrics: a blank line between verses.";
}
