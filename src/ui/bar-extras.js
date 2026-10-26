/**
 * The player bar, given room: what it adds as the window widens (app.css,
 * "the player on wide screens"). Narrow, the bar is the song and its
 * controls; wider, it also offers:
 *
 *   from 1280px  Lyrics (the playing song's page), Sound, Sleep timer
 *   from 1600px  Up next: the next song in the queue, to play now
 *   from 1900px  the line being sung, for songs with timed lyrics
 *   from 2300px  Up next: the next three
 *
 * All drawn always and shown by width in CSS, except the line being sung:
 * its lyrics are read only while the window is wide enough to show it.
 */
import { html } from "../core/html.js";
import { LYRICS_URL, readLyrics } from "../core/lyrics.js";
import { lineAt, parseLyrics } from "../core/lyrics-format.js";
import { lyricsIndex } from "../core/lyrics-index.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { on } from "../core/store.js";
import { creditOf } from "../core/catalog.js";
import { icon } from "./icons.js";
import { cover, scriptClass } from "./parts.js";

/** Songs shown under Up next (CSS shows one, or all from 2300px). */
const NEXT_SHOWN = 3;
/** The width from which the line being sung shows (as in app.css). */
const LINE_FROM = "(min-width: 1900px)";

const $ = (s) => document.querySelector(s);

/** Draws the extras for the playing song; `sleep`: the sleep timer in words, or "". */
export function renderBarExtras(catalog, sleep) {
	const t = player.current();
	const s = player.state;
	const tools = $("#bar-tools");
	if (tools) {
		tools.innerHTML = t ? html`${LYRICS_URL && !t.upload ? html`<a class="icon-btn" href="${href(`lyrics/${t.id}`)}" aria-label="${lyricsIndex.has(t.id) ? "Lyrics" : "Lyrics (none yet)"}" title="${lyricsIndex.has(t.id) ? "Lyrics" : "Lyrics (none yet)"}">${icon("lyrics")}</a>` : ""}
			<button class="icon-btn" data-act="sound" aria-label="Sound: skip silence, clean up, volume, equaliser" title="Sound" aria-haspopup="dialog">${icon("sliders")}</button>
			<button class="icon-btn sleep-btn" data-act="sleep" aria-pressed="${String(Boolean(sleep))}" aria-label="${sleep ? `Sleep timer: stops ${sleep}` : "Sleep timer"}" title="${sleep ? `Sleep timer: stops ${sleep}` : "Sleep timer"}" aria-haspopup="menu">${icon("moon")}</button>`.toString() : "";
	}
	const next = $("#bar-next");
	if (next) {
		const upcoming = t ? s.queue.slice(s.index + 1, s.index + 1 + NEXT_SHOWN).map((id, i) => [catalog.track(id), s.index + 1 + i]).filter(([u]) => u) : [];
		next.hidden = !upcoming.length;
		next.innerHTML = upcoming.length ? html`<span class="bar-next-label">Up next</span>${upcoming.map(([u, i]) => html`<button class="bar-next-item" data-act="bar-next" data-index="${i}" title="Play now: ${u.title}" aria-label="Play now: ${u.title}, ${creditOf(u.artists)}">
			${cover(u.album, { label: false })}<span class="bar-next-text"><b class="${scriptClass(u.title)}">${u.title}</b><small>${creditOf(u.artists)}</small></span>
		</button>`)}`.toString() : "";
	}
}

/* ------------------------------------------------- the line being sung ---- */

/** id -> parsed timed lyrics, or null (none, or not timed). */
const timed = new Map();
let shownFor = null;

function lineText(parsed, n) {
	let k = 0;
	for (const b of parsed.blocks) {
		for (const l of b.lines) {
			if (k++ === n) return l.parts.map((p) => p.text).join("").trim();
		}
	}
	return "";
}

/** Keeps the bar's line (#bar-line) on the line being sung, while the window is wide enough. */
export function startBarLyrics() {
	const line = $("#bar-line");
	if (!line || !LYRICS_URL) return;
	const wide = matchMedia(LINE_FROM);
	let current = -2;
	const show = (text) => {
		line.hidden = !text;
		if (line.textContent !== text) {
			line.textContent = text;
			line.className = `bar-line ${scriptClass(text)}`;
		}
	};
	const load = () => {
		const t = player.current();
		current = -2;
		if (!t || t.upload || !wide.matches || !lyricsIndex.has(t.id)) { shownFor = null; show(""); return; }
		shownFor = t.id;
		if (timed.has(t.id)) return;
		timed.set(t.id, null);
		readLyrics(t.id).then(({ lyrics }) => {
			const parsed = lyrics ? parseLyrics(lyrics.text) : null;
			timed.set(t.id, parsed?.timed ? parsed : null);
		}, () => timed.delete(t.id));
	};
	on("player", () => { if (player.current()?.id !== shownFor) load(); });
	wide.addEventListener("change", load);
	on("time", ({ position }) => {
		const parsed = shownFor === null ? null : timed.get(shownFor);
		if (!parsed) { if (!line.hidden) show(""); return; }
		const n = lineAt(parsed, position);
		if (n === current) return;
		current = n;
		show(n < 0 ? "" : lineText(parsed, n));
	});
	load();
}
