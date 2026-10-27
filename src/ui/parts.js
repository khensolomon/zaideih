/**
 * Shared render helpers: covers, album tiles, track rows and list registry.
 */
import { lyricsIndex } from "../core/lyrics-index.js";
import { creditOf } from "../core/catalog.js";
import { escape, html, raw } from "../core/html.js";
import { library } from "../core/library.js";
import { offline } from "../core/offline.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { formatDuration } from "../core/text.js";
import { artistArt, coverArt } from "./art.js";
import { icon } from "./icons.js";

const MYANMAR = /[က-႟]/;
export const scriptClass = (s) => (MYANMAR.test(s) ? "my" : "");

/*
 * Myanmar is written without spaces, and browsers without a Myanmar line-break
 * dictionary split text mid-syllable (and ignore `word-break: keep-all` for it).
 * Text is therefore split into words with Intl.Segmenter, or into syllables
 * where the segmenter is unavailable, and each piece is wrapped in a nowrap
 * span, so lines can only break between pieces.
 */
const SYLLABLE = /(?<!္)(?:[က-ဪဿ၊-၏]|[၀-၉]+|[^က-၏]+)(?![ှျ]?[့္်])/g;
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("my", { granularity: "word" }) : null;
const breakCache = new Map();

function pieces(s) {
	if (segmenter) return [...segmenter.segment(s)].map((p) => p.segment);
	const starts = [...s.matchAll(SYLLABLE)].map((m) => m.index).filter((i) => i > 0);
	const out = [];
	let prev = 0;
	for (const i of starts) { out.push(s.slice(prev, i)); prev = i; }
	out.push(s.slice(prev));
	return out;
}

export function myanmarBreaks(s) {
	if (!MYANMAR.test(s)) return s;
	let out = breakCache.get(s);
	if (out === undefined) {
		out = raw(pieces(s).map((p) => (p.trim() ? `<span class="w">${escape(p)}</span>` : escape(p))).join(""));
		breakCache.set(s, out);
	}
	return out;
}

/** Artist picture generated from the artist's catalog record (see art.js). */
export const avatar = (artist) => artistArt(artist);

/** Album cover generated from the album's catalog record (see art.js). */
export function cover(album, { label = true, current = -1 } = {}) {
	return coverArt(album, { label, current, titleHtml: myanmarBreaks(album.title), titleClass: scriptClass(album.title) });
}

/**
 * Album tile: cover, title, main artist, then year, song count and a mark
 * when every song is downloaded. The link covers the whole tile; the play
 * button sits above it (a button inside a link would be invalid HTML).
 */
export function albumTile(album) {
	const [main, ...rest] = album.artists;
	const artist = main ? `${main.name}${rest.length ? ` +${rest.length}` : ""}` : "Unknown artist";
	const songs = album.tracks.length === 1 ? "1 song" : `${album.tracks.length} songs`;
	const saved = album.tracks.every((t) => offline.has(t.id));
	return html`<div class="tile" data-album-tile="${album.id}">
		${cover(album)}
		<a class="tile-link" href="${href(`album/${album.id}`)}"><span class="t ${scriptClass(album.title)}">${myanmarBreaks(album.title)}</span></a>
		<span class="s ${scriptClass(artist)}">${artist}</span>
		<span class="m">${album.shared ? html`<span class="mine-mark" title="Shared by ${album.shared.owner.name}">${icon("people", "Shared")}</span><span>${album.shared.owner.name}</span>` : album.upload ? html`<span class="mine-mark" title="Private">${icon("lock", "Private")}</span>` : ""}${album.year ? html`<span>${album.year}</span>` : ""}<span>${songs}</span>${saved ? html`<span class="saved-mark" title="Downloaded">${icon("saved", "Downloaded")}</span>` : ""}</span>
		<button class="tile-play" data-act="play-album" data-album="${album.id}" aria-label="Play ${album.title}">${icon("play")}</button>
	</div>`;
}

export function artistLinks(artists) {
	if (!artists.length) return html`<span>Unknown artist</span>`;
	// Uploads' artists have no artist page.
	return artists.map((a, i) => (a.upload ? html`${i ? ", " : ""}<span>${a.name}</span>` : html`${i ? ", " : ""}<a href="${href(`artist/${a.id}`)}">${a.name}</a>`));
}

/* ---------- list registry: maps a rendered list to its playable ids ---------- */
const lists = new Map();
let listSeq = 0;

export function registerList(ids, context) {
	const key = `l${++listSeq}`;
	lists.set(key, { ids, context });
	return key;
}
export const getList = (key) => lists.get(key);
export function resetLists() { lists.clear(); }

/**
 * Track row. `opts.showAlbum` replaces the position number with an album
 * credit line; `opts.extra` adds menu entries (e.g. remove from playlist);
 * `opts.sub` replaces the second line (a matching line of lyrics). Songs with
 * lyrics carry a small mark after the title (core/lyrics-index.js).
 */
export function trackRow(t, listKey, index, opts = {}) {
	const now = player.current()?.id === t.id;
	const liked = library.isLiked(t.id);
	// An album whose streaming is off (core/holds.js): its songs stay listed, greyed out, and say so.
	const off = Boolean(t.album?.off);
	const sub = off ? "Not available right now" : opts.sub ?? (opts.showAlbum ? html`${creditOf(t.artists)}, ${t.album.title}` : creditOf(t.artists));
	// The lyrics mark opens the lyrics (app.js), so the row's play is not the only thing a tap on it can do.
	const lyric = lyricsIndex.has(t.id) ? html`<span class="has-lyrics" data-lyrics="${t.id}" title="Lyrics">${icon("lyrics", "Lyrics")}</span>` : "";
	// Lists from many albums (search) show each song's cover in place of its number.
	const no = opts.thumb ? html`<span class="thumb">${cover(t.album, { label: false })}</span>` : html`<span>${opts.number ?? index + 1}</span>`;
	return html`<li class="track${now ? " now" : ""}${opts.thumb ? " thumbed" : ""}${off ? " off" : ""}" data-track="${t.id}" data-index="${index}" ${opts.extra ? html`data-extra="${opts.extra}"` : ""}>
		<span class="no">${no}<i class="eq" aria-hidden="true"><i></i><i></i><i></i></i></span>
		<button class="main" data-act="play" data-list="${listKey}" data-id="${t.id}" aria-label="Play ${t.title}">
			<span class="title ${scriptClass(t.title)}">${t.title}${lyric}${t.upload && opts.thumb ? html`<span class="mine-mark" title="My music">${icon("lock", "My music")}</span>` : ""}</span>
			<span class="sub ${scriptClass(String(sub))}">${sub}</span>
		</button>
		<span class="saved" title="${offline.has(t.id) ? "Downloaded" : ""}">${offline.has(t.id) ? icon("saved", "Downloaded") : ""}</span>
		<span class="dur">${formatDuration(t.duration)}</span>
		<span>
			<button class="icon-btn like" data-act="like" data-id="${t.id}" aria-pressed="${String(liked)}" aria-label="${liked ? "Remove from liked songs" : "Add to liked songs"}">${icon("heart")}</button>
			<button class="icon-btn" data-act="menu" data-id="${t.id}" data-list="${listKey}" aria-label="More options for ${t.title}" aria-haspopup="menu">${icon("more")}</button>
		</span>
	</li>`;
}

/* ---------- incremental lists ("Show more") ---------- */
const pending = new Map();

export function chunkedTracks(tracks, context, { step = 100, ...opts } = {}) {
	const key = registerList(tracks.map((t) => t.id), context);
	const first = tracks.slice(0, step);
	const id = `more-${key}`;
	if (tracks.length > step) pending.set(id, { tracks, key, offset: step, step, opts });
	return html`<ol class="tracks" id="${id}-list">${first.map((t, i) => trackRow(t, key, i, opts))}</ol>
		${tracks.length > step ? html`<div class="more"><button class="btn" data-act="more" data-target="${id}">Show ${Math.min(step, tracks.length - step)} more</button></div>` : ""}`;
}

export function chunkedAlbums(albums, { step = 60 } = {}) {
	const id = `more-a${++listSeq}`;
	if (albums.length > step) pending.set(id, { albums, offset: step, step });
	return html`<div class="grid" id="${id}-list">${albums.slice(0, step).map(albumTile)}</div>
		${albums.length > step ? html`<div class="more"><button class="btn" data-act="more" data-target="${id}">Show more albums</button></div>` : ""}`;
}

export function showMore(button) {
	const id = button.dataset.target;
	const p = pending.get(id);
	if (!p) return;
	const listEl = document.getElementById(`${id}-list`);
	const next = p.offset + p.step;
	if (p.tracks) {
		const slice = p.tracks.slice(p.offset, next);
		listEl.insertAdjacentHTML("beforeend", slice.map((t, i) => trackRow(t, p.key, p.offset + i, p.opts)).join(""));
	} else {
		listEl.insertAdjacentHTML("beforeend", p.albums.slice(p.offset, next).map(albumTile).join(""));
	}
	p.offset = next;
	const total = (p.tracks ?? p.albums).length;
	if (p.offset >= total) {
		button.parentElement.remove();
		pending.delete(id);
	} else if (p.tracks) {
		button.textContent = `Show ${Math.min(p.step, total - p.offset)} more`;
	}
}

export function resetPending() { pending.clear(); }
