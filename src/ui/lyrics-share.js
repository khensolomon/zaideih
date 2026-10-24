/**
 * Shared lyrics in the app (docs/lyrics.md, "Shared lyrics"): the same song
 * on other albums, offered to a song without lyrics, and the recordings a
 * shared text is shown on.
 *
 * Offered: songs with lyrics whose title is the same or close (a song sung
 * again often has its title written another way: "သားသမီးတိုင်းအတွက်ယေရှု",
 * "သားသမီးတိုင်းရဲ့ယေရှု"). Found: any song with lyrics, by its title, artist,
 * album or a line of its words. Many different songs share a title, so
 * nothing is linked by itself: a person reads them and decides.
 */
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { lyricsIndex } from "../core/lyrics-index.js";
import { href } from "../core/router.js";
import { normalize } from "../core/text.js";
import { CLOSE_TITLES, titleCloseness, titleKey } from "../core/titles.js";
import { scriptClass } from "./parts.js";

/** Songs with lyrics, other than `track` and the songs in `exclude` (those already sharing its text). */
const withLyrics = (catalog, track, exclude = []) => [...lyricsIndex.originals()].filter((id) => id !== track.id && !exclude.includes(id)).map((id) => catalog.track(id)).filter((t) => t && !t.upload);

/**
 * Songs with lyrics titled like `track` (the same, or close): the same
 * title first, then the closest, the same artist before others.
 */
export function sameSong(catalog, track, limit = 6, exclude = []) {
	const key = titleKey(track.title);
	const artists = new Set(track.artists.map((a) => a.id));
	return withLyrics(catalog, track, exclude)
		.map((t) => ({ t, score: titleCloseness(key, titleKey(t.title)), same: t.artists.some((a) => artists.has(a.id)) }))
		.filter((x) => x.score >= CLOSE_TITLES)
		.sort((a, b) => b.score - a.score || b.same - a.same || b.t.plays - a.t.plays)
		.slice(0, limit);
}

/** Songs with lyrics found by `query`: in the title, an artist, the album, or a line of the words. */
export function findSongs(catalog, track, query, limit = 8, exclude = []) {
	const q = normalize(query).trim();
	if (q.replace(/\s/g, "").length < 2) return [];
	const found = new Map();
	for (const t of withLyrics(catalog, track, exclude)) {
		if (found.size >= limit) break;
		if (normalize(t.title).includes(q) || titleKey(t.title).includes(titleKey(query)) || t.artists.some((a) => normalize(a.name).includes(q)) || normalize(t.album.title).includes(q)) found.set(t.id, { t });
	}
	for (const hit of lyricsIndex.search(query, limit)) {
		if (found.size >= limit) break;
		const t = catalog.track(hit.track);
		if (t && t.id !== track.id && !exclude.includes(t.id) && !found.has(t.id) && lyricsIndex.langs(t.id).includes("")) found.set(t.id, { t, line: hit.line });
	}
	return [...found.values()];
}

/**
 * What a found song offers, by who is looking (`act`): "link", the Lyrics
 * right using its lyrics; "propose", a member saying it is the same song;
 * "compare", the Lyrics right comparing two songs that both have lyrics.
 */
const ACTS = {
	link: "Use these lyrics",
	propose: "Same song",
	compare: "Compare",
};

function item({ t, score, line }, { act, attr }) {
	const first = line ?? lyricsIndex.firstLine(t.id);
	const how = score === undefined ? "" : score === 1 ? "Same title" : "Similar title";
	return html`<li>
		<div class="ly-same-text">
			<b class="${scriptClass(t.title)}">${t.title}</b>
			<span>${t.album.title} · ${creditOf(t.artists, 2)}${t.album.year ? ` · ${t.album.year}` : ""}${how ? html` · <i>${how}</i>` : ""}</span>
			${first ? html`<q class="${scriptClass(first)}">${first}</q>` : ""}
		</div>
		<span class="ly-same-act">
			<a class="btn ly-small" href="${href(`lyrics/${t.id}`)}">Read</a>
			${act ? html`<button class="btn primary ly-small" ${attr}="${act}" data-to="${t.id}">${ACTS[act]}</button>` : ""}
		</span>
	</li>`;
}

/** What the find field has, per song, so the page can be drawn again without losing it. */
const typed = new Map();

function resultsHtml(catalog, track, opts) {
	const q = typed.get(track.id) ?? "";
	if (q.replace(/\s/g, "").length < 2) return "";
	const list = findSongs(catalog, track, q, 8, opts.exclude ?? []);
	return list.length ? html`<ul>${list.map((x) => item(x, opts))}</ul>` : html`<p class="acct-small">No song with lyrics matches “${q}”.</p>`;
}

const LEADS = {
	link: "Using one shows one text on both: a correction to either is one for both, and each keeps its own timing.",
	propose: "Know it is the same song? Say so: those who look after lyrics check and link them.",
	compare: "Compare first: the words are checked line by line, and you choose which text stays.",
};

/**
 * The same song on other albums: songs with lyrics with the same or a
 * similar title, each with its first line, to read and to act on (`act`, by
 * who is looking; none: reading only); with `canFind`, a field to find the
 * song another way. `title` and `exclude` (songs already sharing the text)
 * as the page needs.
 */
export function suggestionsHtml(catalog, track, opts) {
	const list = sameSong(catalog, track, 6, opts.exclude ?? []);
	if (!list.length && !opts.canFind) return "";
	return html`<section class="ly-same" aria-label="The same song on other albums">
		<h2>${opts.title ?? "Same song on another album?"}</h2>
		<p class="acct-small">${list.length ? "These have lyrics and the same or a similar title. Many songs share a title: read them first." : "No song with lyrics has the same or a similar title."}${opts.act ? ` ${LEADS[opts.act]}` : ""}</p>
		${list.length ? html`<ul>${list.map((x) => item(x, opts))}</ul>` : ""}
		${opts.canFind ? html`<div class="ly-find">
			<label class="ly-find-field"><span class="sr">Find the song</span><input type="search" class="ly-find-input" data-song="${track.id}" value="${typed.get(track.id) ?? ""}" placeholder="Not here? Find it by title, artist or a line of the words" autocomplete="off" spellcheck="false"></label>
			<div class="ly-find-results" aria-live="polite">${resultsHtml(catalog, track, opts)}</div>
		</div>` : ""}
	</section>`;
}

/**
 * Wires the find field inside `root` (once; the field may be drawn again):
 * results as the person types, without drawing the page again. `opts()`
 * gives what the results offer now, as for suggestionsHtml.
 */
export function wireFind(root, catalog, track, opts) {
	root.addEventListener("input", (e) => {
		const input = e.target.closest?.(".ly-find-input");
		if (!input || Number(input.dataset.song) !== track.id) return;
		typed.set(track.id, input.value);
		const out = input.closest(".ly-find")?.querySelector(".ly-find-results");
		if (out) out.innerHTML = String(resultsHtml(catalog, track, opts()));
	});
}

/** The other recordings a shared text is shown on, linked to their lyrics. */
export function sharedWithHtml(catalog, shared) {
	const others = (shared?.with ?? []).map((id) => catalog.track(id)).filter(Boolean);
	if (!others.length) return "";
	return html`<span class="ly-shared">Also sung on ${others.map((t, i) => html`${i ? ", " : ""}<a class="text-link" href="${href(`lyrics/${t.id}`)}">${t.album.title}</a> (${creditOf(t.artists, 1)})`)}</span>`;
}
