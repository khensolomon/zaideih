/**
 * Page views. Each view returns { title, body } where body is SafeHtml.
 */
import { APP_VERSION } from "../config.js";
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { library } from "../core/library.js";
import { offline } from "../core/offline.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { correction, search } from "../core/search.js";
import { formatBytes, formatTotal } from "../core/text.js";
import { icon } from "./icons.js";
import { albumTile, artistLinks, avatar, chunkedAlbums, chunkedTracks, cover, myanmarBreaks, registerList, scriptClass } from "./parts.js";

const LANG_LABEL = { zola: "Zola", myanmar: "Myanmar", mizo: "Mizo", falam: "Falam" };
export const langLabel = (lang) => LANG_LABEL[lang.name] ?? lang.name[0].toUpperCase() + lang.name.slice(1);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const notFound = (what) => ({
	title: "Not found",
	body: html`<div class="empty"><h2>This ${what} isn't in the catalog</h2><p>It may have been removed in a catalog update.</p><p><a class="btn" href="#/">Go to Home</a></p></div>`,
});

function pickRandom(list, n) {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy.slice(0, n);
}

/* ---------- home ---------- */
let discover = null;

export async function home(c) {
	discover ??= pickRandom([...c.albums.values()], 12);
	const recentIds = await library.recent(12);
	const recent = recentIds.map((id) => c.tracks.get(id)).filter(Boolean);
	const langs = [...c.langs.values()].sort((a, b) => b.albums.length - a.albums.length);
	const top = c.topTracks.slice(0, 10);

	return {
		title: "Home",
		body: html`
			<h1 class="sr">Zaideih</h1>
			<nav class="board" aria-label="Languages">
				${langs.map((l) => html`<a class="l-${l.name}" href="${href(`lang/${l.id}`)}"><strong>${langLabel(l)}</strong><span>${plural(l.albums.length, "album")}</span></a>`)}
			</nav>

			${recent.length ? html`<section class="section">
				<header><h2>Played recently</h2><a href="#/library/history">History</a></header>
				${chunkedTracks(recent, "Played recently", { step: 6, showAlbum: true })}
			</section>` : ""}

			<section class="section">
				<header><h2>Most played</h2><a href="#/top">See top 100</a></header>
				${chunkedTracks(top, "Most played", { showAlbum: true })}
			</section>

			<section class="section">
				<header><h2>Albums to try</h2><button class="btn" data-act="reshuffle">Show others</button></header>
				<div class="row-scroll">${discover.map(albumTile)}</div>
			</section>

			${topArtistsByLanguage(c)}

			<section class="section">
				<header><h2>Genres</h2><a href="#/genres">All genres</a></header>
				<div class="genres">${[...c.genres.values()].sort((a, b) => b.albums.length - a.albums.length).slice(0, 10)
					.map((g) => html`<a href="${href(`genre/${g.id}`)}">${g.name}<span>${g.albums.length}</span></a>`)}</div>
			</section>`,
	};
}
export function reshuffle() { discover = null; }

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function artistCard({ artist, plays }) {
	return html`<a class="artist-card" href="${href(`artist/${artist.id}`)}">
		${avatar(artist)}
		<span class="name ${scriptClass(artist.name)}">${artist.name}</span>
		<span class="plays">${compact.format(plays)} plays</span>
	</a>`;
}

/** Home: the most played artists, one tab per language. */
function topArtistsByLanguage(c) {
	const langs = [...c.langs.values()].filter((l) => l.topArtists.length).sort((a, b) => b.albums.length - a.albums.length);
	if (!langs.length) return "";
	const playingLang = player.current()?.album.lang;
	const selected = langs.includes(playingLang) ? playingLang : langs[0];
	return html`<section class="section" data-artist-tabs>
		<header><h2>Most played artists</h2></header>
		<div class="lang-tabs" role="tablist" aria-label="Language">
			${langs.map((l) => html`<button role="tab" data-act="artist-lang" data-lang="${l.id}" aria-selected="${String(l === selected)}">${langLabel(l)}</button>`)}
		</div>
		${langs.map((l) => html`<div class="artist-grid" role="tabpanel" data-lang-panel="${l.id}" ${l === selected ? "" : html`hidden`}>${l.topArtists.map(artistCard)}</div>`)}
	</section>`;
}

export function top(c) {
	return {
		title: "Most played",
		body: html`<h1 class="page-title">Most played</h1>
			<p class="lede">The 100 tracks with the most plays across every language.</p>
			<div class="actions"><button class="btn primary" data-act="play-all" data-list="${registerList(c.topTracks.map((t) => t.id), "Most played")}">${icon("play")} Play all</button></div>
			${chunkedTracks(c.topTracks, "Most played", { showAlbum: true })}`,
	};
}

/* ---------- language ---------- */
const SORTS = {
	plays: { label: "Most played", fn: (a, b) => b.plays - a.plays },
	year: { label: "Newest first", fn: (a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title) },
	oldest: { label: "Oldest first", fn: (a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title) },
	title: { label: "A to Z", fn: (a, b) => a.title.localeCompare(b.title) },
};

function sortSelect(current) {
	return html`<label><span class="sr">Sort albums</span><select class="select" data-act="sort">
		${Object.entries(SORTS).map(([k, s]) => html`<option value="${k}" ${k === current ? "selected" : ""}>${s.label}</option>`)}
	</select></label>`;
}

export function lang(c, { id }, query) {
	const l = c.langs.get(Number(id));
	if (!l) return notFound("language");
	const sort = SORTS[query.get("sort")] ? query.get("sort") : "plays";
	const albums = [...l.albums].sort(SORTS[sort].fn);
	const tracks = albums.reduce((n, a) => n + a.tracks.length, 0);
	return {
		title: langLabel(l),
		body: html`<h1 class="page-title">${langLabel(l)}</h1>
			<div class="toolbar"><span class="muted">${plural(albums.length, "album")}, ${plural(tracks, "track")}</span>${sortSelect(sort)}</div>
			${chunkedAlbums(albums)}`,
	};
}

/* ---------- album ---------- */
export function album(c, { id }) {
	const a = c.albums.get(id);
	if (!a) return notFound("album");
	const ids = a.tracks.map((t) => t.id);
	const key = registerList(ids, a.title);
	const saved = ids.filter((tid) => offline.has(tid)).length;
	const allSaved = saved === ids.length;
	return {
		title: a.title,
		body: html`<div class="hero">
				${cover(a)}
				<div>
					<div class="kind">${a.tracks.length === 1 ? "Single" : "Album"} in ${langLabel(a.lang)}</div>
					<h1 class="${scriptClass(a.title)}">${myanmarBreaks(a.title)}</h1>
					<p class="byline">
						${artistLinks(a.artists.slice(0, 3))}${a.artists.length > 3 ? html`<span data-more-artists hidden>, ${artistLinks(a.artists.slice(3))}</span>
							<button class="link-btn" data-act="more-artists" aria-expanded="false">and ${a.artists.length - 3} more</button>` : ""}
					</p>
					<div class="facts">
						${a.year ? html`<span>${a.year}</span>` : ""}
						${a.genres.map((g) => html`<a class="chip" href="${href(`genre/${g.id}`)}">${g.name}</a>`)}
						<span>${plural(a.tracks.length, "song")}, ${formatTotal(a.duration)}</span>
						<span>${compact.format(a.plays)} plays</span>
						${saved ? html`<span class="saved-note">${icon("saved")} ${allSaved ? "Downloaded" : `${saved} of ${ids.length} downloaded`}</span>` : ""}
					</div>
				</div>
			</div>
			<div class="actions">
				<button class="btn primary" data-act="play-all" data-list="${key}">${icon("play")} Play</button>
				<button class="btn" data-act="shuffle-all" data-list="${key}">${icon("shuffle")} Shuffle</button>
				<button class="btn" data-act="${allSaved ? "remove-download" : "download"}" data-list="${key}" data-download-btn="${key}">
					${allSaved ? html`${icon("saved")} Downloaded` : html`${icon("download")} ${saved ? `Download remaining ${ids.length - saved}` : "Download"}`}
				</button>
				<button class="icon-btn" data-act="list-menu" data-list="${key}" aria-label="More options for this album" aria-haspopup="menu">${icon("more")}</button>
			</div>
			${chunkedTracks(a.tracks, a.title)}`,
	};
}

/* ---------- artist ---------- */
export function artist(c, { id }) {
	const a = c.artists.get(Number(id));
	if (!a) return notFound("artist");
	const popular = [...a.tracks].sort((x, y) => y.plays - x.plays);
	const key = registerList(popular.map((t) => t.id), a.name);
	return {
		title: a.name,
		body: html`<div class="hero" style="grid-template-columns:1fr">
				<div>
					<div class="kind">${a.type === 1 ? "Group or various artists" : "Artist"}</div>
					<h1 class="${scriptClass(a.name)}">${a.name}</h1>
					<div class="facts">
						${a.aka ? html`<span class="${scriptClass(a.aka)}">Also known as ${a.aka}</span>` : ""}
						<span>${plural(a.tracks.length, "track")} on ${plural(a.albums.length, "album")}</span>
					</div>
				</div>
			</div>
			<div class="actions">
				<button class="btn primary" data-act="play-all" data-list="${key}">${icon("play")} Play popular</button>
				<button class="btn" data-act="shuffle-all" data-list="${key}">${icon("shuffle")} Shuffle all</button>
			</div>
			<section class="section" style="margin-top:12px">
				<header><h2>Popular</h2></header>
				${chunkedTracks(popular, a.name, { step: 10, showAlbum: true })}
			</section>
			<section class="section">
				<header><h2>Albums</h2></header>
				${chunkedAlbums(a.albums, { step: 30 })}
			</section>`,
	};
}

/* ---------- genres ---------- */
export function genres(c) {
	const list = [...c.genres.values()].sort((a, b) => a.name.localeCompare(b.name));
	return {
		title: "Genres",
		body: html`<h1 class="page-title">Genres</h1>
			<div class="genres">${list.map((g) => html`<a href="${href(`genre/${g.id}`)}">${g.name}<span>${g.albums.length}</span></a>`)}</div>`,
	};
}

export function genre(c, { id }, query) {
	const g = c.genres.get(Number(id));
	if (!g) return notFound("genre");
	const sort = SORTS[query.get("sort")] ? query.get("sort") : "plays";
	const albums = [...g.albums].sort(SORTS[sort].fn);
	return {
		title: g.name,
		body: html`<h1 class="page-title">${g.name}</h1>
			<div class="toolbar"><span class="muted">${plural(albums.length, "album")}</span>${sortSelect(sort)}</div>
			${chunkedAlbums(albums)}`,
	};
}

/* ---------- search ---------- */
export function searchView(c, _params, query) {
	const q = query.get("q") ?? "";
	return {
		title: q ? `Search: ${q}` : "Search",
		body: html`<form class="searchbox" role="search" data-act="search-form">
				${icon("search")}
				<label class="sr" for="q">Search songs, albums and artists</label>
				<input id="q" name="q" type="search" value="${q}" placeholder="Songs, albums, artists" autocomplete="off" enterkeyhint="search" autofocus
					role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="suggest">
				<ul class="suggest" id="suggest" role="listbox" aria-label="Suggestions" hidden></ul>
			</form>
			<div id="results">${searchResults(c, q)}</div>`,
	};
}

export function searchResults(c, q) {
	const r = search(c, q);
	if (!r) {
		return html`<div class="empty"><h2>Find something to play</h2><p>Search in any script. Alternative spellings of artist names work too, so “zam nu” finds Zamnu.</p></div>`;
	}
	if (!r.tracks.total && !r.albums.total && !r.artists.total) {
		const fix = correction(c, q);
		return html`<div class="empty"><h2>No matches for “${q}”</h2>
			${fix ? html`<p>Did you mean <button class="link-btn" data-act="search-for" data-q="${fix}">${fix}</button>?</p>` : html`<p>Check the spelling, or try fewer words.</p>`}</div>`;
	}
	return html`
		${r.artists.total ? html`<section class="section" style="margin-top:0"><header><h2>Artists</h2><span class="muted">${r.artists.total}</span></header>
			<div class="people">${r.artists.items.map((a) => html`<a class="${scriptClass(a.name)}" href="${href(`artist/${a.id}`)}">${a.name}</a>`)}</div></section>` : ""}
		${r.tracks.total ? html`<section class="section"><header><h2>Songs</h2><span class="muted">${r.tracks.total > r.tracks.items.length ? `Top ${r.tracks.items.length} of ${r.tracks.total.toLocaleString()}` : r.tracks.total}</span></header>
			${chunkedTracks(r.tracks.items, `Search: ${q}`, { step: 20, showAlbum: true })}</section>` : ""}
		${r.albums.total ? html`<section class="section"><header><h2>Albums</h2><span class="muted">${r.albums.total}</span></header>
			<div class="grid">${r.albums.items.map(albumTile)}</div></section>` : ""}`;
}

/* ---------- library ---------- */
const LIB_TABS = [["liked", "Liked"], ["playlists", "Playlists"], ["downloads", "Downloads"], ["history", "History"]];

function libTabs(active) {
	return html`<nav class="segmented" aria-label="Library sections">${LIB_TABS.map(([k, label]) =>
		html`<a href="#/library/${k}" ${k === active ? html`aria-current="page"` : ""}>${label}</a>`)}</nav>`;
}

export async function libraryView(c, { tab = "liked" }) {
	if (!LIB_TABS.some(([k]) => k === tab)) return notFound("page");
	let body;
	if (tab === "liked") {
		const tracks = (await library.likedIds()).map((id) => c.tracks.get(id)).filter(Boolean);
		const key = registerList(tracks.map((t) => t.id), "Liked songs");
		body = tracks.length
			? html`<div class="actions">
					<button class="btn primary" data-act="play-all" data-list="${key}">${icon("play")} Play</button>
					<button class="btn" data-act="shuffle-all" data-list="${key}">${icon("shuffle")} Shuffle</button>
					<button class="btn" data-act="download" data-list="${key}">${icon("download")} Download all</button>
				</div>${chunkedTracks(tracks, "Liked songs", { showAlbum: true })}`
			: html`<div class="empty"><h2>No liked songs yet</h2><p>Tap the heart on any song to keep it here.</p></div>`;
	} else if (tab === "playlists") {
		body = html`<div class="actions"><button class="btn primary" data-act="new-playlist">${icon("plus")} New playlist</button></div>
			${library.playlists.length
				? html`<div class="playlists">${library.playlists.map((p) => html`<a href="${href(`playlist/${p.id}`)}">${p.name}<span>${plural(p.tracks.length, "song")}</span></a>`)}</div>`
				: html`<div class="empty"><h2>No playlists yet</h2><p>Create one here, or use “Add to playlist” from any song's menu.</p></div>`}`;
	} else if (tab === "downloads") {
		const ids = [...offline.state.downloaded];
		const tracks = ids.map((id) => c.tracks.get(id)).filter(Boolean)
			.sort((a, b) => a.album.title.localeCompare(b.album.title) || a.n - b.n);
		const usage = await offline.usage();
		const key = registerList(tracks.map((t) => t.id), "Downloads");
		const pct = usage.quota ? Math.min(100, (usage.used / usage.quota) * 100) : 0;
		body = html`<div class="panel">
				<h3>Storage on this device</h3>
				<div class="muted">${plural(usage.count, "song")} downloaded, ${formatBytes(usage.bytes)}${usage.quota ? `, ${formatBytes(usage.quota - usage.used)} free for this app` : ""}</div>
				${usage.quota ? html`<div class="meter" role="img" aria-label="${Math.round(pct)}% of available storage used"><span style="width:${pct.toFixed(1)}%"></span></div>` : ""}
				${offline.state.persisted ? "" : html`<p class="muted">The browser may clear downloads when the device is low on space. Installing the app to the home screen makes this less likely.</p>`}
			</div>
			${tracks.length ? html`<div class="actions" style="margin-top:18px">
					<button class="btn primary" data-act="play-all" data-list="${key}">${icon("play")} Play</button>
					<button class="btn" data-act="shuffle-all" data-list="${key}">${icon("shuffle")} Shuffle</button>
					<button class="btn danger" data-act="remove-download" data-list="${key}" data-confirm="Remove all ${tracks.length} downloaded songs from this device?">${icon("trash")} Remove all</button>
				</div>${chunkedTracks(tracks, "Downloads", { showAlbum: true })}`
				: html`<div class="empty"><h2>Nothing downloaded</h2><p>Download albums or songs to play them without a connection.</p></div>`}`;
	} else {
		const tracks = (await library.recent(200)).map((id) => c.tracks.get(id)).filter(Boolean);
		body = tracks.length
			? html`<div class="actions"><button class="btn danger" data-act="clear-history" data-confirm="Clear your play history on this device?">${icon("trash")} Clear history</button></div>
				${chunkedTracks(tracks, "History", { showAlbum: true, step: 50 })}`
			: html`<div class="empty"><h2>Nothing played yet</h2><p>Songs appear here after they start playing.</p></div>`;
	}
	return {
		title: "Library",
		body: html`<h1 class="page-title">Library</h1>
			<div class="toolbar">${libTabs(tab)}
				<span><button class="btn" data-act="export">Back up library</button>
				<label class="btn" style="cursor:pointer">Restore<input type="file" accept="application/json" data-act="import" class="sr"></label></span>
			</div>
			${body}
			<p class="app-version">Zaideih v${APP_VERSION}</p>`,
	};
}

/* ---------- playlist ---------- */
export function playlist(c, { id }) {
	const p = library.playlist(Number(id));
	if (!p) return notFound("playlist");
	const tracks = p.tracks.map((tid) => c.tracks.get(tid)).filter(Boolean);
	const missing = p.tracks.length - tracks.length;
	const key = registerList(tracks.map((t) => t.id), p.name);
	return {
		title: p.name,
		body: html`<div class="hero" style="grid-template-columns:1fr"><div>
				<div class="kind">Playlist</div>
				<h1 class="${scriptClass(p.name)}">${p.name}</h1>
				<div class="facts"><span>${plural(tracks.length, "song")}, ${formatTotal(tracks.reduce((s, t) => s + t.duration, 0))}</span></div>
			</div></div>
			${missing ? html`<p class="muted">${plural(missing, "song")} in this playlist ${missing === 1 ? "is" : "are"} no longer in the catalog.</p>` : ""}
			<div class="actions">
				<button class="btn primary" data-act="play-all" data-list="${key}" ${tracks.length ? "" : "disabled"}>${icon("play")} Play</button>
				<button class="btn" data-act="shuffle-all" data-list="${key}" ${tracks.length ? "" : "disabled"}>${icon("shuffle")} Shuffle</button>
				<button class="btn" data-act="download" data-list="${key}" ${tracks.length ? "" : "disabled"}>${icon("download")} Download</button>
				<button class="btn" data-act="rename-playlist" data-id="${p.id}">Rename</button>
				<button class="btn danger" data-act="delete-playlist" data-id="${p.id}" data-confirm="Delete the playlist “${p.name}”? The songs stay in the catalog.">Delete</button>
			</div>
			${tracks.length
				? chunkedTracks(tracks, p.name, { showAlbum: true, extra: `playlist:${p.id}` })
				: html`<div class="empty"><h2>This playlist is empty</h2><p>Use “Add to playlist” from any song's menu.</p></div>`}`,
	};
}

export { creditOf };
