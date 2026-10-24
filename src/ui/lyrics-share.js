/**
 * Shared lyrics in the app (docs/lyrics.md, "Shared lyrics"): the same song
 * on other albums, offered to a song without lyrics, and the recordings a
 * shared text is shown on.
 *
 * Offered by title only, and only songs that have lyrics: many different
 * songs share a title, so a person reads them and decides; nothing is linked
 * by itself.
 */
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { lyricsIndex } from "../core/lyrics-index.js";
import { href } from "../core/router.js";
import { normalize } from "../core/text.js";
import { scriptClass } from "./parts.js";

/** A title as compared: the app's search form, without spaces or punctuation. */
const titleKey = (title) => normalize(title).replace(/[\s\p{P}]+/gu, "");

const byTitle = new WeakMap();
function titles(catalog) {
	let map = byTitle.get(catalog);
	if (!map) {
		map = new Map();
		for (const t of catalog.tracks.values()) {
			const k = titleKey(t.title);
			if (!k) continue;
			if (!map.has(k)) map.set(k, []);
			map.get(k).push(t);
		}
		byTitle.set(catalog, map);
	}
	return map;
}

/**
 * Songs titled like `track` on other albums that have lyrics: the same
 * artist first, then the most played.
 */
export function sameTitle(catalog, track, limit = 6) {
	const artists = new Set(track.artists.map((a) => a.id));
	return (titles(catalog).get(titleKey(track.title)) ?? [])
		.filter((t) => t.id !== track.id && lyricsIndex.has(t.id))
		.map((t) => ({ t, same: t.artists.some((a) => artists.has(a.id)) }))
		.sort((a, b) => b.same - a.same || b.t.plays - a.t.plays)
		.slice(0, limit)
		.map((x) => x.t);
}

/** The offer on a song without lyrics: each candidate with its first line, to read, and to use when signed in. */
export function suggestionsHtml(catalog, track, { canLink, attr }) {
	const list = sameTitle(catalog, track);
	if (!list.length) return "";
	return html`<section class="ly-same" aria-label="The same song on other albums">
		<h2>Same song on another album?</h2>
		<p class="acct-small">These have lyrics and the same title. Many songs share a title: read them first.${canLink ? " Using them shows one text on both: a correction to either is one for both, and each keeps its own timing." : ""}</p>
		<ul>${list.map((t) => html`<li>
			<div class="ly-same-text">
				<b class="${scriptClass(t.title)}">${t.album.title}</b>
				<span>${creditOf(t.artists, 2)}${t.album.year ? ` · ${t.album.year}` : ""}</span>
				${lyricsIndex.firstLine(t.id) ? html`<q class="${scriptClass(lyricsIndex.firstLine(t.id))}">${lyricsIndex.firstLine(t.id)}</q>` : ""}
			</div>
			<span class="ly-same-act">
				<a class="btn ly-small" href="${href(`lyrics/${t.id}`)}">Read</a>
				${canLink ? html`<button class="btn primary ly-small" ${attr}="link" data-to="${t.id}">Use these lyrics</button>` : ""}
			</span>
		</li>`)}</ul>
	</section>`;
}

/** The other recordings a shared text is shown on, linked to their lyrics. */
export function sharedWithHtml(catalog, shared) {
	const others = (shared?.with ?? []).map((id) => catalog.track(id)).filter(Boolean);
	if (!others.length) return "";
	return html`<span class="ly-shared">Also sung on ${others.map((t, i) => html`${i ? ", " : ""}<a class="text-link" href="${href(`lyrics/${t.id}`)}">${t.album.title}</a> (${creditOf(t.artists, 1)})`)}</span>`;
}
