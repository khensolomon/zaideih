/**
 * Page views. Each view returns { title, body } where body is SafeHtml.
 */
import { APP_VERSION } from "../config.js";
import { analytics } from "../core/analytics.js";
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { answer, describe, parseIntent } from "../core/intent.js";
import { library } from "../core/library.js";
import { offline } from "../core/offline.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { decodeCode, explain } from "../core/diagnostic.js";
import { closest, didYouMean, namedArtist, search } from "../core/search.js";
import { formatBytes, formatTotal } from "../core/text.js";
import { icon } from "./icons.js";
import { logoMark } from "./logo.js";
import { careerOf, shadeOf } from "./art.js";
import { getScope, setScope } from "./suggest.js";
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
			${recent.length ? html`<section class="section first">
				<header><h2>Played recently</h2><a href="#/library/history">History</a></header>
				${chunkedTracks(recent, "Played recently", { step: 6, showAlbum: true })}
			</section>` : ""}

			${topArtistsByLanguage(c, !recent.length)}

			<section class="section">
				<header><h2>Albums to try</h2><button class="btn" data-act="reshuffle">Show others</button></header>
				<div class="row-scroll">${discover.map(albumTile)}</div>
			</section>

			<section class="section">
				<header><h2>Most played</h2><a href="#/top">See top 100</a></header>
				${chunkedTracks(top, "Most played", { showAlbum: true })}
			</section>

			<section class="section">
				<header><h2>Browse by language</h2></header>
				<nav class="board" aria-label="Languages">
					${langs.map((l) => html`<a href="${href(`lang/${l.id}`)}" style="--g:${shadeOf(`lang${l.id}`)}%"><strong>${langLabel(l)}</strong><span>${plural(l.albums.length, "album")}</span></a>`)}
				</nav>
			</section>

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
function topArtistsByLanguage(c, first = false) {
	const langs = [...c.langs.values()].filter((l) => l.topArtists.length).sort((a, b) => b.albums.length - a.albums.length);
	if (!langs.length) return "";
	const playingLang = player.current()?.album.lang;
	const selected = langs.includes(playingLang) ? playingLang : langs[0];
	return html`<section class="section${first ? " first" : ""}" data-artist-tabs>
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
				${cover(a, { current: player.current()?.album === a ? player.current().n - 1 : -1 })}
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
	const career = careerOf(a);
	const best = career.plays.length ? career.from + career.plays.indexOf(Math.max(...career.plays)) : 0;
	const langs = [...new Set(a.albums.map((al) => al.lang))];
	return {
		title: a.name,
		body: html`<div class="hero artist-hero">
				${avatar(a)}
				<div>
					<div class="kind">${a.type === 1 ? "Group or various artists" : "Artist"}${langs.length ? html` in ${langs.map(langLabel).join(", ")}` : ""}</div>
					<h1 class="${scriptClass(a.name)}">${a.name}</h1>
					<div class="facts">
						${a.aka ? html`<span class="${scriptClass(a.aka)}">Also known as ${a.aka}</span>` : ""}
						${career.from ? html`<span>${career.to > career.from ? `${career.from}–${career.to}` : career.from}</span>` : ""}
						<span>${plural(a.tracks.length, "song")} on ${plural(a.albums.length, "album")}</span>
						<span>${compact.format(a.plays)} plays</span>
						${best && career.to > career.from ? html`<span>Most played year ${best}</span>` : ""}
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
const SCOPE_LABELS = [["all", "All"], ["artists", "Artists"], ["albums", "Albums"], ["tracks", "Songs"]];
const SCOPE_LIMITS = {
	all: undefined,
	artists: { artists: 60, albums: 0, tracks: 0 },
	albums: { artists: 0, albums: 60, tracks: 0 },
	tracks: { artists: 0, albums: 0, tracks: 100 },
};

export function searchView(c, _params, query) {
	const q = query.get("q") ?? "";
	setScope(query.get("in") ?? "all");
	const scope = getScope();
	return {
		title: q ? `Search: ${q}` : "Search",
		body: html`<form class="searchbox" role="search" data-act="search-form">
				${icon("search")}
				<label class="sr" for="q">Search songs, albums and artists, or ask, for example “most played Mizo artists”</label>
				<input id="q" name="q" type="search" value="${q}" placeholder="Songs, albums, artists, or ask: most played Mizo artists" autocomplete="off" enterkeyhint="search" autofocus
					role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="suggest">
				<div class="sg-panel" id="sg-panel" hidden>
					${scopeButtons(scope, "scopes")}
					<ul class="suggest" id="suggest" role="listbox" aria-label="Suggestions" hidden></ul>
				</div>
			</form>
			<div id="results">${searchResults(c, q, scope)}</div>`,
	};
}

/** Scope buttons, shared by the suggestions panel and the results page. */
function scopeButtons(scope, cls, counts = null) {
	return html`<div class="${cls}" role="group" aria-label="Search in">${SCOPE_LABELS.map(([k, label]) =>
		html`<button type="button" data-act="scope" data-scope="${k}" aria-pressed="${String(k === scope)}">${label}${counts && k !== "all" ? html`<span>${counts[k].toLocaleString()}</span>` : ""}</button>`)}</div>`;
}

/** Search shows the best artist matches as pictures, the rest as name chips. */
const ARTIST_CARDS = 8;

export function searchResults(c, q, scope = getScope()) {
	const r = search(c, q, SCOPE_LIMITS[scope]);
	if (!r) {
		return html`<div class="empty"><h2>Find something to play</h2><p>Search in any script. Alternative spellings of artist names work too, so “zam nu” finds Zamnu, and small typos still find the closest names.</p>
			<p>You can also ask: <button class="link-btn" data-act="search-for" data-q="most played mizo artists">most played Mizo artists</button>, <button class="link-btn" data-act="search-for" data-q="gospel albums from the 90s">gospel albums from the 90s</button>, <button class="link-btn" data-act="search-for" data-q="newest myanmar songs">newest Myanmar songs</button>.</p></div>`;
	}
	const pick = (key) => (scope === "all" || scope === key ? r[key].items : []);
	const exact = { artists: pick("artists"), albums: pick("albums"), tracks: pick("tracks") };
	const total = exact.artists.length + exact.albums.length + exact.tracks.length;

	// A question: answer it first. A scope other than "all" decides what is listed.
	const intent = parseIntent(c, q);
	if (intent && scope !== "all") intent.kind = scope;
	const ans = intent ? answer(c, intent, intent.kind === "artists" ? 24 : 60) : null;
	const answered = ans && ans.total ? answerSection(intent, ans) : "";

	// In the albums or songs scope, records by a matching artist follow the title matches.
	let byArtist = "";
	if (!answered && (scope === "albums" || scope === "tracks")) {
		const artist = namedArtist(c, q);
		if (artist) byArtist = answerSection({ kind: scope, sort: "plays", by: artist }, answer(c, { kind: scope, sort: "plays", by: artist, text: "" }));
	}

	// Counts describe title matches; for an answered question they would mislead.
	const tabs = scopeButtons(scope, "segmented scope-tabs", answered ? null : { artists: r.artists.total, albums: r.albums.total, tracks: r.tracks.total });
	if (!total && !answered && !byArtist) {
		const near = closest(c, q, scope === "all" ? undefined : { artists: 8, albums: 12, tracks: 20, ...SCOPE_LIMITS[scope] });
		const fix = didYouMean(c, q, near);
		const any = near.artists.length + near.albums.length + near.tracks.length;
		return html`${tabs}<div class="empty"><h2>No exact matches for “${q}”</h2>
				${fix ? html`<p>Did you mean <button class="link-btn" data-act="search-for" data-q="${fix}">${fix}</button>?</p>` : html`<p>Nothing is spelled close to it either. Check the spelling, or try fewer words.</p>`}</div>
			${any ? html`<h2 class="near-title">Close matches</h2>${resultSections(near, q)}` : ""}`;
	}
	// Only a few results: the query may still be a typo of something better known.
	const fix = !answered && total < 3 ? didYouMean(c, q) : null;
	return html`${tabs}${fix ? html`<p class="dym">Did you mean <button class="link-btn" data-act="search-for" data-q="${fix}">${fix}</button>?</p>` : ""}
		${answered}
		${total && answered ? html`<h2 class="near-title">Other matches for “${q}”</h2>` : ""}
		${resultSections(exact, q, r)}
		${byArtist}`;
}

function answerSection(intent, ans) {
	const title = describe(intent, langLabel);
	const head = html`<header><h2>${title}</h2><span class="muted">${ans.total > ans.items.length ? `Top ${ans.items.length} of ${ans.total.toLocaleString()}` : ans.total.toLocaleString()}</span></header>`;
	if (intent.kind === "artists") {
		return html`<section class="section answer">${head}<div class="artist-grid">${ans.items.map((a) => artistCard({ artist: a, plays: ans.plays?.get(a) ?? a.plays }))}</div></section>`;
	}
	if (intent.kind === "albums") return html`<section class="section answer">${head}${chunkedAlbums(ans.items, { step: 24 })}</section>`;
	const key = registerList(ans.items.map((t) => t.id), title);
	return html`<section class="section answer">${head}
		<div class="actions"><button class="btn primary" data-act="play-all" data-list="${key}">${icon("play")} Play all</button></div>
		${chunkedTracks(ans.items, title, { step: 20, showAlbum: true })}</section>`;
}

/** Artists, songs and albums sections; `r` supplies the totals for the counts. */
function resultSections(list, q, r = null) {
	const count = (key) => (r ? r[key].total : list[key].length);
	return html`
		${list.artists.length ? html`<section class="section" style="margin-top:0"><header><h2>Artists</h2><span class="muted">${count("artists")}</span></header>
			<div class="artist-grid">${list.artists.slice(0, ARTIST_CARDS).map((a) => artistCard({ artist: a, plays: a.plays }))}</div>
			${list.artists.length > ARTIST_CARDS ? html`<div class="people" style="margin-top:16px">${list.artists.slice(ARTIST_CARDS).map((a) => html`<a class="${scriptClass(a.name)}" href="${href(`artist/${a.id}`)}">${a.name}</a>`)}</div>` : ""}</section>` : ""}
		${list.tracks.length ? html`<section class="section"><header><h2>Songs</h2><span class="muted">${count("tracks") > list.tracks.length ? `Top ${list.tracks.length} of ${count("tracks").toLocaleString()}` : count("tracks")}</span></header>
			${chunkedTracks(list.tracks, `Search: ${q}`, { step: 20, showAlbum: true })}</section>` : ""}
		${list.albums.length ? html`<section class="section"><header><h2>Albums</h2><span class="muted">${count("albums")}</span></header>
			${chunkedAlbums(list.albums, { step: 24 })}</section>` : ""}`;
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
			<p class="page-foot"><a href="#/about">About Zaideih</a><a href="#/terms">Terms</a><a href="#/help">Help</a></p>`,
	};
}

/* ---------- about and terms ---------- */
const ISSUES = "https://github.com/khensolomon/zaideih/issues";
const listJoin = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join(""));

export function about(c) {
	const artists = [...c.artists.values()].filter((a) => a.id > 1 && a.tracks.length).length;
	const hours = Math.round([...c.albums.values()].reduce((n, a) => n + a.duration, 0) / 3600);
	const langs = [...c.langs.values()].filter((l) => l.albums.length).sort((a, b) => b.albums.length - a.albums.length);
	return {
		title: "About",
		body: html`<div class="about">
				<div class="about-head">
					<span class="logo-tile" aria-hidden="true">${logoMark()}</span>
					<div>
						<h1>Zaideih</h1>
						<p class="slogan">Zaideih Music Station</p>
					</div>
				</div>
				<p class="lead">Zaideih keeps ${listJoin(langs.map(langLabel))} music in one place, so these songs are preserved and stay easy to find and listen to.</p>
				<ul class="promise">
					<li><strong>Free to listen.</strong> Every song plays for free, with no account.</li>
					<li><strong>Nothing for sale.</strong> Zaideih does not sell music and takes no financial benefit from it.</li>
					<li><strong>The music belongs to its artists.</strong> Zaideih only keeps it available.</li>
					<li><strong>Your library stays with you.</strong> Likes, playlists, history and downloads are kept on this device only.${analytics.available ? " Usage statistics are only collected if you allow them." : ""}</li>
				</ul>
				<dl class="stats">
					<div><dt>Albums</dt><dd>${c.albums.size.toLocaleString()}</dd></div>
					<div><dt>Songs</dt><dd>${c.tracks.size.toLocaleString()}</dd></div>
					<div><dt>Artists</dt><dd>${artists.toLocaleString()}</dd></div>
					<div><dt>Hours of music</dt><dd>${hours.toLocaleString()}</dd></div>
				</dl>
				${analytics.available ? html`<div class="panel stats-choice">
					<h3>Usage statistics</h3>
					<p class="muted">${analytics.choice() === "granted" ? "On: visits and song plays on this device are counted with Google Analytics." : "Off: nothing about your use of Zaideih is sent from this device."} Your library and searches are never sent.</p>
					<div class="actions" style="margin:10px 0 0">${analytics.choice() === "granted"
						? html`<button class="btn" data-act="consent" data-value="denied">Turn off</button>`
						: html`<button class="btn" data-act="consent" data-value="granted">Turn on</button>`}</div>
				</div>` : ""}
				<p>Artists and rights holders who want a recording credited differently or removed can <a class="text-link" href="${ISSUES}" target="_blank" rel="noopener">open an issue</a>.</p>
				<p class="about-foot"><span>Version ${APP_VERSION}</span><span>Catalog ${c.version}</span><a class="text-link" href="#/terms">Terms</a></p>
			</div>`,
	};
}

export function terms() {
	return {
		title: "Terms",
		body: html`<div class="about terms">
				<h1 class="page-title">Terms</h1>
				<p class="lead">Using Zaideih means accepting these terms. They are short because the service is simple: free listening, nothing sold.</p>
				<h2>Listening</h2>
				<p>Zaideih is free for personal, non-commercial listening. There is no account, subscription or payment.</p>
				<h2>Ownership</h2>
				<p>The songs, recordings and album titles belong to their artists and rights holders. Zaideih does not claim ownership of them, does not sell them and earns nothing from them.</p>
				<h2>Downloads</h2>
				<p>Downloading saves songs inside the app on your device so they play without a connection. Downloads are for your own listening in Zaideih; copying, sharing, selling or republishing them is not permitted.</p>
				<h2>Your data</h2>
				<p>Likes, playlists, play history and downloads are stored on your device and are not sent anywhere. Library backups are files you keep. Playing a song requests it from the Zaideih audio server, like loading any web page.</p>
				<p>Usage statistics are off unless you allow them. When allowed, Google Analytics counts page visits (the page's address within Zaideih and its title) and song plays (which song, album and language), and sets its own cookies for that; Google processes this data under its own terms. Searches and your library are never sent. The choice is kept per device and can be changed at any time on the <a class="text-link" href="#/about">About</a> page.</p>
				<h2>Availability</h2>
				<p>The service is provided as it is. Songs may be added, corrected or removed, and the service may change or pause without notice.</p>
				<h2>Rights holders</h2>
				<p>To have a recording credited differently or removed, <a class="text-link" href="${ISSUES}" target="_blank" rel="noopener">open an issue</a> naming the album and the song.</p>
				<h2>Changes</h2>
				<p>These terms may be updated with new releases of the app. The current version is shown on the <a class="text-link" href="#/about">About</a> page.</p>
			</div>`,
	};
}

/* ---------- help ---------- */
export function help() {
	return {
		title: "Help",
		body: html`<div class="about terms help">
				<h1 class="page-title">Help</h1>
				<h2 id="song-wont-play">A song won't play</h2>
				<p>The player already tries a failed song a second time, without the browser's saved copy. If it still fails while other songs play, the cause is usually one of these.</p>
				<ol>
					<li><strong>An old copy saved in this browser.</strong> Browsers keep songs they have played. A copy saved from an older version of the Zaideih server can be refused by the current app. Check: play the song in a private window or another browser. If it plays there, clear this browser's cached files (below).</li>
					<li><strong>A damaged download.</strong> If the song is downloaded, remove the download from its menu and download it again.</li>
					<li><strong>The connection.</strong> On a slow or interrupted connection, try again, or download the song while the connection is good.</li>
				</ol>
				<h2 id="clear-cache">Clear the browser's cached files</h2>
				<p>Clear only cached files. Your likes, playlists, history and downloads stay. Clearing all site data or cookies for Zaideih removes them too, so back up the library first (Library, Back up library).</p>
				<ul class="steps">
					<li><strong>Chrome, Edge</strong>: Settings, Privacy and security, Delete browsing data. Tick only “Cached images and files”, then Delete data.</li>
					<li><strong>Firefox</strong>: Settings, Privacy &amp; Security, Cookies and Site Data, Clear Data. Tick only “Temporary cached files and pages”, then Clear.</li>
					<li><strong>Safari on Mac</strong>: Settings, Advanced, tick “Show features for web developers”, then Develop, Empty Caches.</li>
					<li><strong>Safari on iPhone and iPad</strong>: there is no cache-only option. Settings, Apps, Safari, Advanced, Website Data removes everything for the site, so back up the library first.</li>
				</ul>
				<p>Then reload Zaideih and play the song again.</p>
				<h2 id="report">Still not playing</h2>
				<p>An error shows a code under the message, starting with “ZE-”. It tells us which song failed and why, without any personal data. Copy it and <a class="text-link" href="${ISSUES}" target="_blank" rel="noopener">report it</a> with the song's name.</p>
				<h2 id="offline">Listening offline</h2>
				<p>Songs play offline once downloaded: use Download on an album, or the menu of a song. The browser may remove downloads when the device runs low on space; installing Zaideih to the home screen makes that less likely. Downloads are kept per browser and device.</p>
			</div>`,
	};
}

/* ---------- diagnostic codes (hidden: #/code/<code>) ---------- */
const KIND_TEXT = {
	unknown: "Playback failed", aborted: "Playback stopped", network: "Network error during playback",
	decode: "Could not decode", unsupported: "Could not load or play", "download-missing": "Downloaded file missing",
	offline: "Offline, not downloaded", "play-rejected": "The browser refused to play",
};

export function codeView(c, { code = "" }) {
	const form = html`<form class="searchbox code-form" data-act="code-form">
			<label class="sr" for="code-input">Diagnostic code</label>
			<input id="code-input" name="code" value="${code}" placeholder="ZE-…" autocomplete="off" spellcheck="false">
		</form>`;
	if (!code) return { title: "Diagnostic code", body: html`<h1 class="page-title">Diagnostic code</h1>${form}<p class="muted">Paste a code from a playback error.</p>` };
	let d;
	try {
		d = decodeCode(code);
	} catch (err) {
		return { title: "Diagnostic code", body: html`<h1 class="page-title">Diagnostic code</h1>${form}<div class="empty"><h2>Not a valid code</h2><p>${err.message}</p></div>` };
	}
	const t = c.tracks.get(d.trackId);
	const { cause, steps } = explain(d);
	const rows = [
		["Song", t ? html`<a class="text-link" href="${href(`album/${t.album.id}`)}">${t.title}</a> (${creditOf(t.artists)}, ${t.album.title})` : "Not in this catalog"],
		["Track id", String(d.trackId)],
		["What failed", KIND_TEXT[d.kind] ?? d.kind],
		["Played from", d.download ? "Downloaded copy" : "Stream"],
		["Server answer", d.download ? "Not asked" : !d.probed ? "Not probed" : d.unreachable ? "No answer" : String(d.status)],
		["Worker lookup", d.noTrack ? "No D1 row" : d.noObject ? "D1 row, no R2 object" : { memory: "From its memory cache", edge: "From its edge cache", d1: "From D1", "not-reported": "Not reported (Worker without diagnostic headers)" }[d.lookup]],
		["File starts as", d.signature],
		["File size", d.sizeKiB ? `${d.sizeKiB.toLocaleString()} KiB` : "Unknown"],
		["App", `${d.version || "unknown version"}, ${d.desktop ? "desktop" : "web"}${d.online ? "" : ", offline"}`],
		["When", d.at.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
	];
	return {
		title: "Diagnostic code",
		body: html`<h1 class="page-title">Diagnostic code</h1>${form}
			<div class="panel diag-panel">
				<h3>${cause}</h3>
				${steps.length ? html`<ul>${steps.map((s) => html`<li>${s}</li>`)}</ul>` : ""}
			</div>
			<dl class="diag-table">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
			<p class="muted">The R2 key and code points: <code>node tools/diagnose.mjs ${code}</code></p>`,
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
