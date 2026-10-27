// First: keys renamed on this device are moved before any module reads them.
import "./core/moved-keys.js";
import { analytics } from "./core/analytics.js";
import { applyLive, CatalogLoadError, creditOf, loadCatalog } from "./core/catalog.js";
import { startLive } from "./core/live-catalog.js";
import { db, StorageError } from "./core/db.js";
import { createSync } from "./core/sync.js";
import { escape, html } from "./core/html.js";
import { library } from "./core/library.js";
import { offline } from "./core/offline.js";
import { player } from "./core/player.js";
import { startPlayCounting } from "./core/plays.js";
import { applyTotals, startPlayTotals, totalsUrl } from "./core/playcounts.js";
import { startHolds } from "./core/holds.js";
import { AUTH_URL, LIBRARY_URL, WORKSPACE_URL } from "./config.js";
import { LEVELS, readWho } from "./core/access.js";
import { uploads } from "./core/uploads.js";
import { account } from "./core/signin.js";
import { accountView } from "./ui/account-view.js";
import { lyricsView } from "./ui/lyrics-view.js";
import { lyricsStudio } from "./ui/lyrics-studio.js";
import { lyricsIndex } from "./core/lyrics-index.js";
import { npLyrics, npLyricsButton, npLyricsMounted, npLyricsPanel } from "./ui/np-lyrics.js";
import { LYRICS_URL } from "./core/lyrics.js";
import { probeOn, startProbe, toggleProbe } from "./ui/viewport-probe.js";
import { go, href, parse, route } from "./core/router.js";
import { emit, notify, on } from "./core/store.js";
import { formatDuration } from "./core/text.js";
import { clearArtCaches, patternOf } from "./ui/art.js";
import { nowPlayingImage, prepareNowArt } from "./ui/now-art.js";
import { createStage, SceneBuildError, sceneChoice, SCENES, sceneFor, ScenesUnavailableError, setSceneChoice } from "./ui/scenes.js";
import { openSoundPanel } from "./ui/sound-panel.js";
import { initTips } from "./ui/tips.js";
import { icon } from "./ui/icons.js";
import { cover, getList, registerList, resetLists, resetPending, scriptClass, showMore, trackRow } from "./ui/parts.js";
import { logoMark } from "./ui/logo.js";
import { clearRecent, closeSuggestions, forgetSearch, forgetSearches, getScope, includeMine, moveSelection, pickOption, rememberSearch, setIncludeMine, setLangName, setScope, updateSuggestions } from "./ui/suggest.js";
import * as V from "./ui/views.js";
import { focusKey, refocus } from "./ui/focus.js";
import { viz } from "./ui/viz.js";
import { songbookImportView, songbooksView } from "./ui/songbooks-view.js";
import { bookView, hymnView, personView, textView, workView } from "./ui/songbook-pages.js";
import { hymnBooks, readText, refreshHymnIndex } from "./core/songbooks.js";
import { applyChordStyle } from "./ui/chord-style.js";
import { renderBarExtras, startBarLyrics } from "./ui/bar-extras.js";
import { audioStudio, studioWaiting } from "./ui/audio-studio.js";
import { joinPage, pendingInvite, shareContext, sharePage } from "./ui/share-view.js";
import { startEdits } from "./core/audio-edits.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let catalog = null;
let currentRoute = null;

/* =================================================================== routes */
route("", V.home);
route("top", V.top);
route("lang/:id", V.lang);
route("album/:id", V.album);
route("artist/:id", V.artist);
route("genres", V.genres);
route("genre/:id", V.genre);
route("search", V.searchView);
route("library", V.libraryView);
route("library/:tab", V.libraryView);
// Sharing private music with members (ui/share-view.js, docs/library.md).
route("share/:id", sharePage);
route("join/:code", joinPage);
shareContext({
	notify: (...a) => notify(...a),
	redraw: ({ keepFocus } = {}) => render({ keepScroll: true }).then(() => {
		const el = keepFocus && $(keepFocus);
		if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
	}),
});
route("playlist/:id", V.playlist);
route("about", V.about);
route("songbooks", songbooksView);
route("songbooks/import", songbookImportView);
// Songbooks' pages (docs/songbooks.md): a book, a hymn, a text, a person, a work, and a text's words in the studio.
route("songbook/:id", bookView);
route("songbook/:id/:n", (c, p, q) => hymnView(c, p, q, { notify, confirmAction }));
route("songbooks/text/:id", (c, p, q) => textView(c, p, q, { notify, confirmAction }));
route("songbooks/person/:id", personView);
route("songbooks/work/:id", workView);
route("songbooks/text/:id/studio", async (c, { id }, query) => {
	const textId = Number(id);
	let t;
	try {
		t = await readText(textId);
	} catch (err) {
		return { title: "Lyrics studio", body: html`<div class="empty"><h2>This hymn could not be read</h2><p>${err.message}</p></div>` };
	}
	const where = t.books[0] ? `${t.books[0].short} ${t.books[0].number}` : "Songbook";
	return lyricsStudio(c, textId, {
		notify, promptText, confirmAction,
		openMenu: (anchor, items) => setTimeout(() => openMenu(anchor, items)),
		canModerate: () => uploads.canLyrics || uploads.canSongbooks,
		song: { id: textId, title: t.title, album: { title: where, lang: { name: t.lang } }, artists: [], text: true },
		path: `songbooks/text/${textId}`,
	}, query.get("lang") ?? "");
});
route("account", () => accountView({ onChange: syncAccess, notify, desktop: document.documentElement.dataset.platform === "desktop", redrawn: watchLargeTitle }));
route("lyrics/:id", (c, { id }, query) => lyricsView(c, Number(id), {
	notify, promptText, confirmAction, redrawn: watchLargeTitle,
	canModerate: () => uploads.canLyrics,
	// From this song on, in its album, as a tap on the song in the album would.
	playSong: (t) => player.playList(t.album.tracks.map((x) => x.id), t.id, t.album.title),
}, query.get("lang") ?? ""));
route("lyrics/:id/studio", (c, { id }, query) => lyricsStudio(c, Number(id), {
	notify, promptText, confirmAction,
	// After the click that asks for it, which would otherwise close it at once (the page's click handler).
	openMenu: (anchor, items) => setTimeout(() => openMenu(anchor, items)),
	canModerate: () => uploads.canLyrics,
	// From this song on, in its album, as a tap on the song in the album would.
	playSong: (t) => player.playList(t.album.tracks.map((x) => x.id), t.id, t.album.title),
	// From the Workspace's Waiting list or the lyrics page: comparing with another song, to merge (and the proposal it answers).
	merge: Number(query.get("merge")) || null,
	proposal: Number(query.get("proposal")) || null,
}, query.get("lang") ?? ""));
// The audio studio (ui/audio-studio.js); a saved cut is read back at once (core/audio-edits.js).
let editsCtl = null;
route("audio/:id", (c, { id }) => audioStudio(c, Number(id), { notify, confirmAction, canAudio: () => uploads.canAudio, rightsKnown: () => !uploads.available || Boolean(uploads.state.member) || (Boolean(uploads.state.error) && !uploads.state.loading), refreshEdits: () => editsCtl?.refresh({ force: true }) }));
route("terms", V.terms);
route("help", V.help);
// Hidden: decodes a playback diagnostic code. Not linked anywhere.
route("code", V.codeView);
// Hidden: a live readout of the page's sizes, for layout faults seen only on a device (ui/viewport-probe.js). Not linked anywhere.
route("viewport", () => {
	const on = toggleProbe();
	return { title: "Viewport", body: html`<div class="about"><h1 class="page-title">Viewport readout</h1><p>The readout is <b>${on ? "on" : "off"}</b> on this device. Open <code>#/viewport</code> again to turn it ${on ? "off" : "on"}.</p><p><a class="btn" href="#/">Home</a> <a class="btn" href="#/account">Sign in page</a></p></div>` };
});
route("code/:code", V.codeView);
// The Workspace's earlier address: links in older pull requests and bookmarks (#/admin?review=12) still arrive.
route("admin", (_catalog, _params, query) => {
	go("workspace", query.toString() ? query : undefined, { replace: true });
	return { title: "Workspace", body: "" };
});

// The Workspace (src/workspace): its own bundle, loaded only here; linked for those signed in with GitHub.
route("workspace", () => ({
	title: "Workspace",
	body: html`<div class="workspace" id="workspace-root"><p class="muted adm-loading">Loading…</p></div>`,
	mount: async (view) => {
		const root = $("#workspace-root", view);
		if (!WORKSPACE_URL) { root.innerHTML = html`<p>The Workspace works in the web app only.</p>`; return; }
		try {
			const mod = await import(new URL(WORKSPACE_URL, document.baseURI).href);
			mod.mount(root, {
				catalog, notify, promptText, analyticsOn: () => analytics.choice() === "granted" && analytics.available, totalsUrl: totalsUrl(), authUrl: AUTH_URL, libraryUrl: LIBRARY_URL, onWho: syncAccess, desktop: document.documentElement.dataset.platform === "desktop",
				// The app's own player, lyrics index and covers: the Workspace bundle has no copies of its own.
				player, onPlayer: (fn) => on("player", fn),
				lyrics: { has: (id) => lyricsIndex.has(id), get size() { return lyricsIndex.size; } },
				cover: (albumId) => { const al = catalog.album(albumId); return al ? cover(al, { label: false }) : ""; },
			});
		} catch (err) {
			console.error(err);
			root.innerHTML = html`<p class="adm-error">The Workspace could not load: ${err.message}</p>`;
		}
	},
}));

/*
 * In-app navigation depth, stored in history.state so the Back button knows
 * whether stepping back stays inside the app (history.back) or must go Home.
 */
let navDepth = 0;
function trackDepth() {
	const st = history.state;
	if (st && Number.isInteger(st.zDepth)) navDepth = st.zDepth;
	else {
		navDepth += 1;
		history.replaceState({ ...(st ?? {}), zDepth: navDepth }, "");
	}
}

function updateNavbar(path, title) {
	const home = path === "";
	$(".navbar [data-act=back]").hidden = home;
	$("#nav-title").textContent = home ? "" : title;
	watchLargeTitle();
}

/*
 * iOS-style large titles: the page's own heading is the title; the bar shows
 * it only once the heading has scrolled under the bar.
 */
let titleObserver = null;
function watchLargeTitle() {
	const bar = $(".navbar");
	titleObserver?.disconnect();
	const heading = $("#view h1:not(.sr)");
	bar.classList.toggle("titled", !heading);
	if (!heading || typeof IntersectionObserver !== "function") return;
	// Under the bar: above its bottom edge, measured (it sits lower under a notch).
	const edge = Math.round(bar.getBoundingClientRect().bottom) || 72;
	titleObserver = new IntersectionObserver(([entry]) => {
		bar.classList.toggle("titled", !entry.isIntersecting && entry.boundingClientRect.top < edge + 8);
	}, { rootMargin: `-${edge}px 0px 0px 0px` });
	titleObserver.observe(heading);
}

/* =================================================================== logo menu (phones) */
function renderAppMenu() {
	const langs = [...catalog.langs.values()].filter((l) => l.albums.length).sort((a, b) => b.albums.length - a.albums.length);
	$("#app-menu").innerHTML = html`
		<div class="am-group">
			<a href="#/">${icon("home")}Home</a>
			<a href="#/search">${icon("search")}Search</a>
			<a href="#/library">${icon("library")}Library</a>
			<a href="#/workspace" class="am-workspace" hidden>${icon("edit")}<span class="lbl">Workspace</span></a>
			<a href="#/songbooks" class="am-songbooks" hidden>${icon("lyrics")}<span class="lbl">Songbooks</span></a>
			<a href="#/account" class="am-account">${icon("person")}<span class="lbl">Sign in</span></a>
		</div>
		<h2>Languages</h2>
		<div class="am-group">${langs.map((l) => html`<a href="${href(`lang/${l.id}`)}"><span>${V.langLabel(l)}</span><span class="am-count">${l.albums.length.toLocaleString()}</span></a>`)}</div>
		<h2>Browse</h2>
		<div class="am-group"><a href="#/genres">Genres</a><a href="#/top">Most played</a></div>
		<button class="stats-on" data-act="stats-on" hidden>${icon("chart")}Share listening statistics</button>
		<div class="am-foot"><a href="#/about">About</a><a href="#/terms">Terms</a><a href="/privacy">Privacy</a><a href="#/help">Help</a></div>`;
	syncAccess();
}

/*
 * Who is signed in on this device: "Sign in", or their name, opens Your
 * account; with a GitHub sign-in (src/core/access.js) editors and admins
 * also get a link to the Workspace, contributors and guests "Suggest edits".
 */
let accessKey = null;
function syncAccess() {
	const who = WORKSPACE_URL ? readWho(localStorage) : null;
	const acct = AUTH_URL ? account() : null;
	// Someone signed in or out (here or in another tab): their own uploads and their library follow.
	const key = acct?.key ?? "";
	if (key !== accessKey && uploads.catalog) {
		accessKey = key;
		if (acct?.signedIn) uploads.refresh().catch((err) => console.warn("reading My uploads failed", err));
		else uploads.clear();
		syncer?.run().catch((err) => console.warn("syncing the library failed; it is tried again later", err));
	}
	const name = acct?.member?.name ?? who?.login ?? "";
	for (const a of $$(".rail-account, .am-account")) {
		a.hidden = !AUTH_URL;
		a.dataset.hint = name || "Sign in";
		$(".lbl", a).textContent = name || "Sign in";
		a.title = name ? "Account" : "";
	}
	const label = who ? (LEVELS[who.level].canWrite ? "Workspace" : "Suggest edits") : "";
	// Songbooks: for the Songbooks right, and those appointed to a book, until books are public (docs/songbooks.md).
	for (const a of $$(".rail-songbooks, .am-songbooks")) a.hidden = !uploads.canSongbooks && !hymnBooks().length;
	for (const a of $$(".rail-workspace, .am-workspace")) {
		a.hidden = !who;
		a.dataset.hint = label;
		$(".lbl", a).textContent = label;
		a.title = who ? `${who.login}, ${LEVELS[who.level].name}` : "";
	}
}
/*
 * While the logo menu is open the page behind it stays still and blurred.
 * iOS scrolls a page even with overflow hidden, so the page is pinned in
 * place (position fixed at its scroll offset) and put back on close.
 */
let lockedAt = null;
function lockPage() {
	if (lockedAt !== null) return;
	lockedAt = scrollY;
	Object.assign(document.body.style, { position: "fixed", top: `${-lockedAt}px`, left: "0", right: "0" });
	document.documentElement.classList.add("menu-open");
	$("#menu-scrim").hidden = false;
}
/** Lets the page move again; back where it was, unless a page change is about to replace it (restoreScroll false). */
function unlockPage({ restoreScroll = true } = {}) {
	if (lockedAt === null) return;
	Object.assign(document.body.style, { position: "", top: "", left: "", right: "" });
	document.documentElement.classList.remove("menu-open");
	$("#menu-scrim").hidden = true;
	if (restoreScroll) scrollTo(0, lockedAt);
	lockedAt = null;
}

function openAppMenu() {
	const menu = $("#app-menu");
	if (!menu.childElementCount) renderAppMenu();
	lockPage();
	menu.hidden = false;
	syncStatsButtons();
	$(".nav-logo").setAttribute("aria-expanded", "true");
	$("a", menu)?.focus();
}
function closeAppMenu({ restoreFocus = false, restoreScroll = true } = {}) {
	const menu = $("#app-menu");
	if (menu.hidden) return;
	menu.hidden = true;
	unlockPage({ restoreScroll });
	$(".nav-logo").setAttribute("aria-expanded", "false");
	if (restoreFocus) $(".nav-logo").focus();
}

// The search typed but not yet run, and the latest render: an older one finishing late is dropped.
let searchTimer = 0;
let renderSeq = 0;

async function render({ keepScroll = false } = {}) {
	const seq = ++renderSeq;
	if (!keepScroll) clearTimeout(searchTimer);
	// A page change can remove the search box while its suggestions are open.
	closeSuggestions();
	const r = parse();
	const view = $("#view");
	if (!r) { go("", undefined, { replace: true }); return; }
	// The page kind, for layout rules such as the search field in place of the bar on phones.
	document.body.dataset.page = r.path.split("/")[0] || "home";
	// The lyrics studio and the Workspace are pages of their own: the sidebar narrows to icons while one is open (not saved as the listener's choice).
	const studio = /^(lyrics|songbooks\/text)\/\d+\/studio$/.test(r.path) || /^audio\/\d+$/.test(r.path) || r.path === "workspace";
	document.body.toggleAttribute("data-studio", studio);
	if (studio) document.body.dataset.rail = "mini";
	else applyRail();
	const scroll = keepScroll ? scrollY : 0;
	currentRoute = r;
	resetLists();
	resetPending();
	let out;
	try {
		out = await r.handler(catalog, r.params, r.query);
	} catch (err) {
		console.error(err);
		out = { title: "Error", body: html`<div class="empty"><h2>This page couldn't be shown</h2><p>${err.message}</p></div>` };
	}
	if (seq !== renderSeq || parse()?.path !== r.path) return; // navigated away, or rendered again, meanwhile
	view.innerHTML = out.body;
	// A page that is a studio for the person (songbook pages for their editors) says so itself.
	if (out.studio && !studio) document.body.toggleAttribute("data-studio", true);
	document.title = out.title === "Home" ? "Zaideih" : `${out.title} | Zaideih`;
	markNav(r.path);
	updateNavbar(r.path, out.title);
	// The address without its query: search text never leaves the device, and
	// a diagnostic code is reported as the bare "code" page.
	if (!keepScroll && r.path !== "workspace") analytics.pageView(`${location.origin}${location.pathname}#/${r.path.startsWith("code") ? "code" : r.path}`, document.title);
	scrollTo(0, scroll);
	out.mount?.(view);
	// The player's Play, while nothing plays, offers this page's own.
	if (!player.current()) renderBar();
	// A shared song (?song=<id>): its row, in view and lit for a moment.
	const shared = r.query?.get?.("song");
	const row = shared ? view.querySelector(`.track[data-track="${CSS.escape(shared)}"]`) : null;
	if (row && !keepScroll) {
		row.scrollIntoView({ block: "center" });
		row.classList.add("flash");
	}
	if (!keepScroll) {
		const heading = view.querySelector("h1");
		if (heading && !$("#q")) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
	}
	const q = $("#q");
	if (q && !keepScroll) {
		q.focus();
		q.setSelectionRange(q.value.length, q.value.length);
		// Arriving with a query shows its results; suggestions wait for typing.
		if (q.value) closeSuggestions(q);
	}
}

function markNav(path) {
	// A language, the genres or Most played: their own sidebar entry is the current one, not Home.
	const browse = /^lang\/\d+/.exec(path)?.[0] ?? (path.startsWith("genre") ? "genres" : path === "top" ? "top" : null);
	const section = path.startsWith("search") ? "search"
		: path.startsWith("library") || path.startsWith("playlist") ? "library"
		: path.startsWith("songbook") ? "songbooks"
		: path === "about" || path === "terms" || path === "help" || path === "workspace" || path === "account" ? path
		: browse ? null : "home";
	for (const a of $$("[data-nav]")) {
		if (a.dataset.nav === section) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	}
	for (const a of $$(".rail .langs a, #app-menu .am-group a")) {
		if (browse && a.getAttribute("href") === `#/${browse}`) a.setAttribute("aria-current", "page");
		else if (!a.dataset.nav) a.removeAttribute("aria-current");
	}
}

const rerender = () => render({ keepScroll: true });

/*
 * Background data that changes what a page shows (counted plays, album
 * holds, live catalog changes, trimmed songs, the lyrics marks) arrives in
 * bursts, most of all while the app starts: the page is drawn again once
 * after the burst (SOFT_MS of quiet, SOFT_MAX_MS at most), not once for each.
 */
const SOFT_MS = 300;
const SOFT_MAX_MS = 1000;
let softTimer = 0;
let softSince = 0;
function rerenderSoon() {
	const now = performance.now();
	if (!softTimer) softSince = now;
	clearTimeout(softTimer);
	const wait = Math.min(SOFT_MS, Math.max(0, softSince + SOFT_MAX_MS - now));
	softTimer = setTimeout(() => { softTimer = 0; rerender(); }, wait);
}

/* =================================================================== shell */
function renderRail() {
	const langs = [...catalog.langs.values()].sort((a, b) => b.albums.length - a.albums.length);
	$("#rail-langs").innerHTML = html`${langs.map((l) => html`<a href="${href(`lang/${l.id}`)}" data-hint="${V.langLabel(l)}"><span class="ab" data-ab="${V.langLabel(l).slice(0, 2)}" aria-hidden="true"></span><span class="lbl">${V.langLabel(l)}</span><span class="n">${l.albums.length}</span></a>`)}`;
	applyRail();
}

/*
 * The desktop sidebar: collapsed to icons, and its sections folded, as the
 * listener left them (kept on this device).
 */
const RAIL_KEY = "zaideih.rail";
/** Sections folded until opened (the rest are open until folded): `opened` keeps the choice for these. */
const FOLDED_FIRST = ["more"];
function railState() {
	try {
		const v = JSON.parse(localStorage.getItem(RAIL_KEY) ?? "{}");
		const list = (x) => (Array.isArray(x) ? x.filter((id) => typeof id === "string") : []);
		return { mini: v.mini === true, closed: list(v.closed), opened: list(v.opened) };
	} catch {
		return { mini: false, closed: [], opened: [] };
	}
}
const isFolded = ({ closed, opened = [] }, id) => (FOLDED_FIRST.includes(id) ? !opened.includes(id) : closed.includes(id));
function saveRail(state) {
	try { localStorage.setItem(RAIL_KEY, JSON.stringify(state)); } catch { /* lasts this visit only */ }
	applyRail(state);
}
function applyRail(state = railState()) {
	const { mini } = state;
	document.body.dataset.rail = mini ? "mini" : "full";
	const toggle = $(".rail-toggle");
	toggle.setAttribute("aria-expanded", String(!mini));
	toggle.setAttribute("aria-label", mini ? "Expand the sidebar" : "Collapse the sidebar");
	for (const sec of document.querySelectorAll(".rail-sec")) {
		const open = !isFolded(state, sec.dataset.sec);
		sec.dataset.open = String(open);
		sec.querySelector("h2 button").setAttribute("aria-expanded", String(open));
	}
}

/* =================================================================== player bar */
/** What the page's own Play plays (data-page-play), for the player's Play while nothing plays; "" when none. */
const pagePlay = () => $("main [data-page-play]:not([disabled])")?.dataset.pagePlay ?? "";

function renderBar() {
	const t = player.current();
	const s = player.state;
	const bar = $("#bar");
	bar.classList.toggle("idle", !t);
	bar.classList.toggle("page-play", !t && Boolean(pagePlay()));
	$("#bar-now").innerHTML = t
		? html`${cover(t.album, { label: false })}<span class="meta"><span class="title ${scriptClass(t.title)}">${t.title}</span><span class="sub">${s.error ? s.error : creditOf(t.artists)}</span></span>`
		: html`<span class="meta"><span class="title">Nothing playing</span><span class="sub">${pagePlay() ? `Play ${pagePlay()}` : "Pick a song to start"}</span></span>`;
	for (const btn of $$("[data-ctl=toggle]")) {
		btn.innerHTML = icon(s.playing ? "pause" : "play");
		btn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
		btn.classList.toggle("busy", s.loading && !s.error);
	}
	for (const btn of $$("[data-ctl=shuffle]")) btn.setAttribute("aria-pressed", String(s.shuffle));
	for (const btn of $$("[data-ctl=repeat]")) {
		btn.setAttribute("aria-pressed", String(s.repeat !== "off"));
		btn.innerHTML = icon(s.repeat === "one" ? "repeatOne" : "repeat");
		btn.setAttribute("aria-label", { off: "Repeat is off", all: "Repeating the queue", one: "Repeating this song" }[s.repeat]);
	}
	for (const btn of $$("[data-ctl=prev]")) btn.disabled = !t;
	for (const btn of $$("[data-ctl=next]")) btn.disabled = !t || (s.index >= s.queue.length - 1 && s.repeat !== "all");
	const likeBtn = $("#bar-like");
	likeBtn.hidden = !t;
	$("#bar-more").hidden = !t;
	// The playing row's bars move only while the music plays.
	document.body.classList.toggle("is-playing", !!t && s.playing);
	if (t) setLikeState(likeBtn, library.isLiked(t.id));
	viz.setPlaying(s.playing);
	bar.classList.toggle("paused", !!t && !s.playing);
	if (!$("#sheet").hidden) renderSheet();
	renderWatch();
	// What the bar adds as the window widens (ui/bar-extras.js).
	renderBarExtras(catalog, sleepText());
}

function setLikeState(btn, liked, { animate = false } = {}) {
	btn.setAttribute("aria-pressed", String(liked));
	btn.setAttribute("aria-label", liked ? "Remove from liked songs" : "Add to liked songs");
	if (animate && liked) {
		btn.classList.remove("pop");
		void btn.offsetWidth; // restart the animation
		btn.classList.add("pop");
	}
}

function renderVolume() {
	const { volume, muted } = player.audio;
	const name = muted || volume === 0 ? "muted" : volume < 0.5 ? "volumeLow" : "volume";
	for (const btn of $$("[data-ctl=mute]")) {
		btn.innerHTML = icon(name);
		btn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
		btn.setAttribute("aria-pressed", String(muted));
	}
	for (const range of $$("[data-ctl=volume]")) {
		const v = muted ? 0 : volume;
		range.value = String(v);
		range.style.setProperty("--pct", `${v * 100}%`);
	}
}

/** How far the audio has loaded, in percent; downloaded songs are fully loaded. */
function bufferedPct(duration) {
	const b = player.audio.buffered;
	if (!duration || !b?.length) return 0;
	return Math.min(100, (b.end(b.length - 1) / duration) * 100);
}

function renderTime({ position, duration }) {
	const pct = duration ? (position / duration) * 100 : 0;
	const buf = Math.max(pct, bufferedPct(duration));
	$("#bar-progress").style.width = `${pct}%`;
	for (const range of $$("[data-ctl=seek]")) {
		if (range.dataset.dragging) continue;
		range.max = String(duration || 0);
		range.value = String(position);
		range.style.setProperty("--pct", `${pct}%`);
		range.style.setProperty("--buf-pct", `${buf}%`);
	}
	viz.setProgress(duration ? position / duration : 0);
	for (const el of $$("[data-time=pos]")) el.textContent = formatDuration(position);
	for (const el of $$("[data-time=dur]")) el.textContent = formatDuration(duration);
}

function markPlaying() {
	const id = player.current()?.id;
	for (const row of $$(".track[data-track]")) row.classList.toggle("now", trackIdOf(row.dataset.track) === id);
}

/* =================================================================== now playing sheet */
function renderSheet() {
	const t = player.current();
	const s = player.state;
	const sheet = $("#sheet");
	if (!t) { sheet.innerHTML = html`<div class="top"><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("down")}</button></div><div class="empty"><h2>Nothing playing</h2></div>`; return; }
	const queue = s.queue.map((id) => catalog.track(id)).filter(Boolean);
	const upcoming = queue.slice(s.index + 1);
	const key = registerList(s.queue, s.context);
	const focused = focusKey(sheet);
	sheet.classList.toggle("paused", !s.playing);
	sheet.classList.toggle("lyrics-on", npLyrics.on && !t.upload);
	sheet.innerHTML = html`
		<div class="top">
			<button class="icon-btn" data-act="close-sheet" aria-label="Close now playing">${icon("down")}</button>
			<span class="ctx">${s.context ? html`Playing from ${s.context}` : ""}</span>
			<span class="top-end">
				<button class="icon-btn" data-act="sound" aria-label="Sound: skip silence, clean up, volume, equaliser" aria-haspopup="dialog">${icon("sliders")}</button>
				<button class="icon-btn" data-act="scene-menu" aria-label="Background: ${sceneLabel()}" aria-haspopup="menu">${icon("scene")}</button>
				<button class="icon-btn sleep-btn" data-act="sleep" aria-pressed="${String(Boolean(s.sleep))}" aria-label="${s.sleep ? `Sleep timer: stops ${sleepText()}` : "Sleep timer"}" title="${s.sleep ? `Sleep timer: stops ${sleepText()}` : "Sleep timer"}" aria-haspopup="menu">${icon("moon")}</button>
				<button class="icon-btn" data-act="watch" aria-label="Watch the background" hidden>${icon("watch")}</button>
				<a class="icon-btn" href="${href(`album/${t.album.id}`)}" data-act="close-sheet" aria-label="Go to album">${icon("album")}</a>
			</span>
		</div>
		<div class="body">
			<div class="stage">
				${cover(t.album, { current: t.n - 1 })}
				<div class="info">
					<div style="min-width:0">
						<div class="title ${scriptClass(t.title)}">${t.title}</div>
						<div class="sub">${t.upload || !t.artists.length ? creditOf(t.artists, 3) : t.artists.slice(0, 3).map((a, i) => html`${i ? ", " : ""}<a href="${href(`artist/${a.id}`)}" data-act="close-sheet">${a.name}</a>`)}</div>
					</div>
					${t.upload ? "" : npLyricsButton()}
					<button class="icon-btn like" data-act="like" data-id="${t.id}" aria-pressed="${String(library.isLiked(t.id))}" aria-label="${library.isLiked(t.id) ? "Remove from liked songs" : "Add to liked songs"}">${icon("heart")}</button>
				</div>
				<canvas class="viz-large" data-viz="large" aria-hidden="true"></canvas>
				<div class="seek">
					<input type="range" data-ctl="seek" min="0" step="1" aria-label="Seek">
					<span class="seek-tip" hidden></span>
					<div class="times"><span data-time="pos">0:00</span><span data-time="dur">${formatDuration(t.duration)}</span></div>
				</div>
				<div class="ctl">
					<button class="icon-btn" data-ctl="shuffle" aria-label="Shuffle" aria-pressed="${String(s.shuffle)}">${icon("shuffle")}</button>
					<button class="icon-btn" data-ctl="prev" aria-label="Previous">${icon("prev")}</button>
					<button class="play-btn" data-ctl="toggle" aria-label="Play">${icon("play")}</button>
					<button class="icon-btn" data-ctl="next" aria-label="Next">${icon("next")}</button>
					<button class="icon-btn" data-ctl="repeat" aria-label="Repeat">${icon("repeat")}</button>
				</div>
				${s.error ? html`<p class="error" role="alert">${s.error} <a class="text-link" href="#/help" data-act="close-sheet">Help</a>${s.errorCode ? html`<small class="diag">Code <code>${s.errorCode}</code> <button class="link-btn" data-act="copy-code" data-code="${s.errorCode}">Copy</button></small>` : ""}</p>` : ""}
			</div>
			${t.upload ? "" : npLyricsPanel(t)}
			<section class="queue" aria-label="Queue">
				<h2>Up next <span>${upcoming.length ? html`<button class="btn" data-act="clear-queue">Clear</button>` : ""}</span></h2>
				${upcoming.length
					? html`<ol class="tracks">${upcoming.map((u, i) => trackRow(u, key, s.index + 1 + i, { showAlbum: true, number: i + 1, extra: "queue" }))}</ol>`
					: html`<p class="muted">The queue ends after this song.</p>`}
			</section>
		</div>`;
	// Refresh control states inside the sheet without recursing into renderSheet.
	const playing = s.playing;
	for (const btn of $$("[data-ctl=toggle]", sheet)) { btn.innerHTML = icon(playing ? "pause" : "play"); btn.setAttribute("aria-label", playing ? "Pause" : "Play"); }
	for (const btn of $$("[data-ctl=repeat]", sheet)) { btn.setAttribute("aria-pressed", String(s.repeat !== "off")); btn.innerHTML = icon(s.repeat === "one" ? "repeatOne" : "repeat"); }
	renderTime({ position: player.audio.currentTime || 0, duration: player.audio.duration || t.duration });
	viz.refresh();
	updateScene();
	refocus(sheet, focused);
	npLyricsMounted(sheet, t, () => { if (!$("#sheet").hidden) renderSheet(); });
}

/* ---- background scenes ---- */
let stage = null;            // the WebGL stage, created on first use
let scenesError = null;      // ScenesUnavailableError: WebGL cannot be used in this browser
const failedScenes = new Map(); // scene id -> why its shader does not build on this device

function sceneLabel(choice = sceneChoice()) {
	if (scenesError) return "not available in this browser";
	if (choice === "auto") return "Auto";
	if (choice === "off") return "Off";
	return SCENES.find((x) => x.id === choice)?.name ?? "Auto";
}

/** The scene to show for a track: Auto skips scenes this device cannot build. */
function sceneToShow(t) {
	const choice = sceneChoice();
	const id = sceneFor(t, patternOf(t.album), choice);
	if (!id || !failedScenes.has(id)) return id;
	return choice === "auto" ? SCENES.find((x) => !failedScenes.has(x.id))?.id ?? null : null;
}

/** Shows, changes or stops the background scene to match the song and the listener's choice. */
function updateScene() {
	const sheet = $("#sheet");
	const canvas = $("#scene");
	const t = player.current();
	const id = !sheet.hidden && t ? sceneToShow(t) : null;
	if (id && !stage && !scenesError) {
		try {
			stage = createStage(canvas);
		} catch (err) {
			scenesError = err instanceof ScenesUnavailableError ? err : new ScenesUnavailableError(`Backgrounds could not start: ${err.message}`);
			// No notice: the background button explains it when opened.
			console.warn(scenesError.message, scenesError.steps.join("; "), scenesError.detail ? `(browser: ${scenesError.detail})` : "");
			const btn = $("[data-act=scene-menu]", sheet);
			btn?.setAttribute("aria-label", `Background: ${sceneLabel()}`);
		}
	}
	let on = Boolean(id && stage);
	if (on) {
		stage.setPlaying(player.state.playing);
		try {
			stage.show(id, t);
		} catch (err) {
			if (!(err instanceof SceneBuildError)) throw err;
			failedScenes.set(id, err.message);
			// No notice: the picker marks the scene as not supported, and Auto uses another.
			console.warn(err.message);
			if (failedScenes.size === SCENES.length) scenesError = new ScenesUnavailableError("None of the backgrounds can run on this device's graphics. The browser console names the reason for each.");
			updateScene();
			return;
		}
	} else if (stage) {
		stage.show(null);
	}
	canvas.hidden = !on;
	sheet.classList.toggle("has-scene", on);
	$("[data-act=watch]", sheet)?.toggleAttribute("hidden", !on);
	if (!on) exitWatch();
}

function openSceneMenu(anchor) {
	if (scenesError) {
		openMenu(anchor, [
			{ label: "Background" },
			{ label: scenesError.message },
			...scenesError.steps.map((step, i) => ({ label: `${i + 1}. ${step}` })),
			...(scenesError.detail ? [{ label: `The browser says: ${scenesError.detail}` }] : []),
		]);
		return;
	}
	const choice = sceneChoice();
	const pick = (v) => () => { setSceneChoice(v); renderSheet(); };
	const mark = (v, label) => (choice === v ? `✓ ${label}` : label);
	openMenu(anchor, [
		{ label: "Background" },
		{ label: mark("auto", "Auto (matches the album)"), run: pick("auto") },
		"-",
		...SCENES.map((x) => failedScenes.has(x.id)
			? { label: `${x.name}: not supported on this device` }
			: { label: mark(x.id, x.name), run: pick(x.id) }),
		"-",
		{ label: mark("off", "Off"), run: pick("off") },
	]);
}

/*
 * Watch mode: the scene full screen with a light layer of its own: the song
 * (title, artist, album), progress, previous, play and next, the next
 * background, and leaving. The layer fades out after a few seconds while
 * playing and comes back on a tap, a click, pointer movement or a key.
 * "Keep song info" leaves the title and artist on screen, like a TV caption.
 */
const WATCH_INFO_KEY = "zaideih.watch.info";
const WATCH_IDLE_MS = 3500;
let watchTimer = 0;
let wokeAt = 0;

const watching = () => $("#sheet").classList.contains("watching");
function watchInfoKept() {
	try { return localStorage.getItem(WATCH_INFO_KEY) === "keep"; } catch { return false; }
}

function renderWatch() {
	if (!watching()) return;
	const ui = $("#watch-ui");
	const t = player.current();
	if (!t) { exitWatch(); return; }
	const s = player.state;
	const focusedAct = ui.contains(document.activeElement) ? (document.activeElement.dataset.ctl ?? document.activeElement.dataset.act) : null;
	const kept = watchInfoKept();
	const sceneName = SCENES.find((x) => x.id === sceneToShow(t))?.name ?? "";
	ui.classList.toggle("info", kept);
	ui.innerHTML = html`
		<div class="w-top">
			<span class="w-hint">${sceneName ? html`<b>${sceneName}</b> · ` : ""}${fineHover.matches ? "Move or click to show the controls, Esc to leave" : "Tap to show or hide the controls"}</span>
			<span class="w-btns">
				<button class="icon-btn glass" data-act="watch-scene" aria-label="Next background">${icon("scene")}</button>
				<button class="icon-btn glass" data-act="watch-info" aria-pressed="${String(kept)}" aria-label="${kept ? "Hide song info when the controls hide" : "Keep song info on screen"}">${icon("info")}</button>
				<button class="icon-btn glass" data-act="watch-exit" aria-label="Leave watch mode">${icon("exitWatch")}</button>
			</span>
		</div>
		<div class="w-bottom">
			<div class="w-now">
				${cover(t.album, { label: false })}
				<div class="w-meta">
					<div class="w-title ${scriptClass(t.title)}">${t.title}</div>
					<div class="w-sub">${creditOf(t.artists, 3)} · <span class="${scriptClass(t.album.title)}">${t.album.title}</span>${t.album.year ? html` · ${t.album.year}` : ""}</div>
				</div>
			</div>
			<div class="w-seek seek">
				<input type="range" data-ctl="seek" min="0" step="1" aria-label="Seek">
				<span class="seek-tip" hidden></span>
				<div class="times"><span data-time="pos">0:00</span><span data-time="dur">${formatDuration(t.duration)}</span></div>
			</div>
			<div class="w-ctl">
				<button class="icon-btn glass" data-ctl="prev" aria-label="Previous">${icon("prev")}</button>
				<button class="play-btn" data-ctl="toggle" aria-label="${s.playing ? "Pause" : "Play"}">${icon(s.playing ? "pause" : "play")}</button>
				<button class="icon-btn glass" data-ctl="next" aria-label="Next" ${s.index >= s.queue.length - 1 && s.repeat !== "all" ? "disabled" : ""}>${icon("next")}</button>
			</div>
		</div>`;
	renderTime({ position: player.audio.currentTime || 0, duration: player.audio.duration || t.duration });
	if (focusedAct) $(`[data-ctl="${focusedAct}"], [data-act="${focusedAct}"]`, ui)?.focus();
	// Paused: the controls stay, since there is nothing to watch go by.
	if (!s.playing) wakeWatch({ stay: true });
}

/** Shows the watch controls; they hide again after a few seconds while playing. */
function wakeWatch({ stay = false } = {}) {
	if (!watching()) return;
	const ui = $("#watch-ui");
	if (!ui.classList.contains("awake")) wokeAt = performance.now();
	ui.classList.add("awake");
	$("#sheet").classList.add("awake");
	clearTimeout(watchTimer);
	if (stay || !player.state.playing) return;
	watchTimer = setTimeout(sleepWatch, WATCH_IDLE_MS);
}
function sleepWatch() {
	// Keep the controls while one of them is in use (keyboard focus or a seek drag).
	const ui = $("#watch-ui");
	// Keep the controls while one is in use: under the pointer, focused from the keyboard, or a seek drag.
	const inUse = ui.querySelector("button:hover, input:hover, [data-dragging]")
		|| (ui.contains(document.activeElement) && document.activeElement.matches(":focus-visible"));
	if (inUse && player.state.playing) { clearTimeout(watchTimer); watchTimer = setTimeout(sleepWatch, WATCH_IDLE_MS); return; }
	clearTimeout(watchTimer);
	ui.classList.remove("awake");
	$("#sheet").classList.remove("awake");
}

function enterWatch() {
	const sheet = $("#sheet");
	if (!sheet.classList.contains("has-scene")) return;
	sheet.classList.add("watching");
	$("#watch-ui").hidden = false;
	document.documentElement.requestFullscreen?.().catch(() => {});
	renderWatch();
	wakeWatch();
}
function exitWatch() {
	const sheet = $("#sheet");
	if (!sheet.classList.contains("watching")) return;
	clearTimeout(watchTimer);
	sheet.classList.remove("watching", "awake");
	const ui = $("#watch-ui");
	ui.hidden = true;
	ui.classList.remove("awake");
	ui.innerHTML = "";
	if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
	$("[data-act=watch]", sheet)?.focus();
}
function nextWatchScene() {
	const t = player.current();
	if (!t) return;
	const usable = SCENES.filter((x) => !failedScenes.has(x.id));
	if (!usable.length) return;
	const i = usable.findIndex((x) => x.id === sceneToShow(t));
	setSceneChoice(usable[(i + 1) % usable.length].id);
	renderSheet();
	renderWatch();
	wakeWatch();
}
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) exitWatch(); });
document.addEventListener("pointermove", () => { if (watching()) wakeWatch(); }, { passive: true });
document.addEventListener("visibilitychange", () => {
	if (!stage) return;
	if (document.hidden) stage.stop();
	else if (!$("#sheet").hidden) stage.start();
});
// In watch mode a tap or click outside the controls shows or hides them.
document.addEventListener("click", (e) => {
	if (!watching() || e.target.closest("#watch-ui button, #watch-ui input, .menu")) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	// The pointer moving in to click has just shown the controls: that click keeps them.
	const ui = $("#watch-ui");
	if (ui.classList.contains("awake") && performance.now() - wokeAt > 400) { clearTimeout(watchTimer); ui.classList.remove("awake"); $("#sheet").classList.remove("awake"); } else wakeWatch();
}, true);

/** The browser's top colour (Safari's bar, Android's status bar): the page's, or Now playing's while it is open. */
function setThemeColor(color) {
	const meta = document.querySelector('meta[name="theme-color"]');
	if (!meta) return;
	meta.dataset.page ??= meta.content;
	meta.content = color ?? meta.dataset.page;
}

function openSheet() {
	const sheet = $("#sheet");
	sheet.hidden = false;
	document.body.style.overflow = "hidden";
	renderSheet();
	setThemeColor(sheet.classList.contains("has-scene") ? "#262626" : "#4a4a4a");
	$("[data-act=close-sheet]", sheet)?.focus();
}
function closeSheet() {
	const sheet = $("#sheet");
	if (sheet.hidden) return;
	exitWatch();
	sheet.hidden = true;
	updateScene();
	document.body.style.overflow = "";
	setThemeColor(null);
	$("#bar-now").focus();
}

/* =================================================================== menus & dialogs */
let menuReturnFocus = null;

function openMenu(anchor, items) {
	closeMenu();
	const menu = document.createElement("div");
	menu.className = "menu";
	menu.setAttribute("role", "menu");
	menu.innerHTML = items.map((it) => it === "-" ? "<hr>" : it.label && !it.run
		? `<div class="label">${escape(it.label)}</div>`
		: `<button role="menuitem" data-i="${items.indexOf(it)}">${escape(it.label)}</button>`).join("");
	document.body.append(menu);
	const r = anchor.getBoundingClientRect();
	const w = menu.offsetWidth, h = menu.offsetHeight;
	const left = Math.min(Math.max(12, r.right - w), innerWidth - w - 12);
	const top = r.bottom + h + 8 > innerHeight ? Math.max(12, r.top - h - 6) : r.bottom + 6;
	Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });
	menu.addEventListener("click", async (e) => {
		const b = e.target.closest("button[data-i]");
		if (!b) return;
		const item = items[Number(b.dataset.i)];
		closeMenu();
		try { await item.run(); } catch (err) { notify(err.message, { kind: "error" }); }
	});
	menu.addEventListener("keydown", (e) => {
		const buttons = $$("button", menu);
		const i = buttons.indexOf(document.activeElement);
		if (buttons.length && e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
		if (buttons.length && e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
		// Escape closes the menu only, not the Now playing sheet it was opened from.
		if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
	});
	menuReturnFocus = anchor;
	$("button", menu)?.focus();
}

function closeMenu(restoreFocus = false) {
	$(".menu")?.remove();
	if (restoreFocus && menuReturnFocus?.isConnected) menuReturnFocus.focus();
}

function promptText(title, value = "", confirm = "Save") {
	return new Promise((resolve) => {
		const d = $("#dialog");
		d.innerHTML = html`<form method="dialog"><h2>${title}</h2>
			<input type="text" name="value" value="${value}" required maxlength="120" aria-label="${title}">
			<div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${confirm}</button></div></form>`;
		d.onclose = () => resolve(d.returnValue === "ok" ? $("input", d).value.trim() || null : null);
		d.showModal();
	});
}

/** Changes an upload's title, artist, album, year and track number. */
function editUpload(track) {
	const d = $("#dialog");
	d.innerHTML = html`<form method="dialog" class="up-edit"><h2>Edit details</h2>
		<label>Title<input name="title" value="${track.title}" required maxlength="200"></label>
		<label>Artist<input name="artist" value="${track.artists[0]?.name === "Unknown artist" ? "" : track.artists[0]?.name ?? ""}" maxlength="200"></label>
		<label>Album<input name="album" value="${track.album.title === "Singles" ? "" : track.album.title}" maxlength="200"></label>
		<div class="up-edit-row"><label>Year<input name="year" type="number" min="1900" max="2100" value="${track.year ?? ""}"></label>
		<label>Track<input name="track" type="number" min="1" max="999" value="${track.track ?? ""}"></label></div>
		<div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></div></form>`;
	d.onclose = async () => {
		if (d.returnValue !== "ok") return;
		const f = new FormData($("form", d));
		try {
			await uploads.edit(track.uploadId, { title: f.get("title"), artist: f.get("artist"), album: f.get("album"), year: f.get("year") || null, track: f.get("track") || null });
			notify("Saved");
		} catch (err) {
			notify(err.message, { kind: "error" });
		}
	};
	d.showModal();
}

/**
 * The owner's switch (and every reviewer's): on asks and opens the approval
 * form in the Workspace at once; off withdraws a request still waiting.
 */
async function publishToggle(el) {
	const album = catalog.album(el.dataset.album);
	try {
		if (el.checked) {
			const id = album.request?.status === "open" ? album.request.id : (await uploads.askPublish(album.title)).id;
			location.hash = `#/workspace?review=${id}`;
		} else if (album.request?.status === "open") {
			await uploads.withdrawPublish(album.request.id);
			notify("Withdrawn; only you can play it");
		}
	} catch (err) {
		el.checked = !el.checked;
		notify(err.message, { kind: "error" });
	}
}

/** A member asks to publish an album of their uploads: its language, and who may share it. */
function askPublish(album) {
	const other = album.tracks.filter((t) => t.format !== "mp3");
	const langs = [...catalog.langs.values()].filter((l) => l.id);
	const d = $("#dialog");
	d.innerHTML = html`<form method="dialog" class="up-edit"><h2>Ask to publish “${album.title}”</h2>
		<p class="muted">A reviewer listens and, if approved, adds all ${album.tracks.length === 1 ? "of it" : `${album.tracks.length} songs`} to the catalog for everyone. You stay credited, and it stays in your library.</p>
		${other.length ? html`<p class="error">Only MP3 can be published: ${other.length === 1 ? `“${other[0].fileName}” is` : `${other.length} songs are`} ${other[0].format.toUpperCase()}. Upload MP3 copies, delete the others, and ask again.</p>` : ""}
		<label>Language<select name="lang" required><option value="" selected disabled>Choose…</option>${langs.map((l) => html`<option value="${l.id}">${l.name[0].toUpperCase()}${l.name.slice(1)}</option>`)}</select></label>
		<label>For the reviewer<textarea name="note" rows="3" maxlength="200" placeholder="Who made it, and why you may share it (bought, recorded, the artist's permission)"></textarea></label>
		<label class="check"><input type="checkbox" name="rights" required> I may share these recordings with everyone</label>
		<div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok" ${other.length ? "disabled" : ""}>Ask</button></div></form>`;
	d.onclose = async () => {
		if (d.returnValue !== "ok") return;
		const f = new FormData($("form", d));
		try {
			await uploads.askPublish(album.title, { lang: f.get("lang"), note: f.get("note") });
			notify("Asked; a reviewer will listen to it");
		} catch (err) {
			notify(err.message, { kind: "error" });
		}
	};
	d.showModal();
}

function confirmAction(message, confirm = "Continue") {
	return new Promise((resolve) => {
		const d = $("#dialog");
		d.innerHTML = html`<form method="dialog"><h2>${message}</h2>
			<div class="actions"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">${confirm}</button></div></form>`;
		d.onclose = () => resolve(d.returnValue === "ok");
		d.showModal();
	});
}

async function addToPlaylistMenu(anchor, ids) {
	const items = [{ label: "Add to playlist" }, {
		label: "New playlist…",
		run: async () => {
			const name = await promptText("Name the new playlist", "", "Create");
			if (!name) return;
			const p = await library.createPlaylist(name, ids);
			notify(`Added to “${p.name}”`);
		},
	}];
	for (const p of library.playlists) {
		items.push({
			label: p.name,
			run: async () => {
				const n = await library.addToPlaylist(p.id, ids);
				notify(n ? `Added ${n === 1 ? "1 song" : `${n} songs`} to “${p.name}”` : `Already in “${p.name}”`);
			},
		});
	}
	openMenu(anchor, items);
}

/** Shares a page of the app: the device's share sheet where there is one, otherwise the link, copied. */
async function shareLink(path, title, text = "") {
	const url = `${location.origin}${location.pathname}#/${path}`;
	if (navigator.share) {
		try {
			await navigator.share({ title, text, url });
			return;
		} catch (err) {
			if (err.name === "AbortError") return;
			console.warn("the share sheet failed; copying the link instead", err);
		}
	}
	try {
		await navigator.clipboard.writeText(url);
		notify("Link copied");
	} catch {
		await promptText("Copy this link", url, "Done");
	}
}

/** A song's share: its album, opened at the song. */
const shareSong = (t) => shareLink(`album/${t.album.id}?song=${t.id}`, t.title, `${t.title}, ${creditOf(t.artists)}`);

/** When the sleep timer stops playback, in words; "" when it is off. */
function sleepText() {
	const z = player.state.sleep;
	if (!z) return "";
	if (z.end) return "at the end of this song";
	const m = Math.max(1, Math.round((z.at - Date.now()) / 60_000));
	return `in ${m} min`;
}

/** The sleep timer: stop in a while, or at the end of the song playing. */
function sleepMenu(anchor) {
	const on = sleepText();
	openMenu(anchor, [
		{ label: on ? `Sleep timer: stops ${on}` : "Sleep timer" },
		...[15, 30, 45, 60].map((m) => ({ label: m === 60 ? "In 1 hour" : `In ${m} minutes`, run: () => { player.setSleep(m); notify(`Playback stops in ${m === 60 ? "1 hour" : `${m} minutes`}`); } })),
		{ label: "At the end of this song", run: () => { player.setSleep("end"); notify("Playback stops at the end of this song"); } },
		...(on ? ["-", { label: "Turn the timer off", run: () => { player.setSleep(null); notify("Sleep timer off"); } }] : []),
	]);
}

/**
 * The player's "More": where the playing song comes from (its album and
 * artists), its lyrics, Now playing and the queue, and adding it to a playlist.
 */
function barMenu(anchor, track) {
	const items = [
		{ label: "Now playing", run: () => openSheet() },
		...(LYRICS_URL && !track.upload ? [{ label: lyricsIndex.has(track.id) ? "Lyrics" : "Lyrics (none yet)", run: () => { closeSheet(); go(`lyrics/${track.id}`); } }] : []),
		"-",
		{ label: `Go to album: ${track.album.title}`, run: () => { closeSheet(); go(`album/${track.album.id}`); } },
		...(track.upload ? [] : track.artists.filter((a) => a.id > 1).slice(0, 3).map((a) => ({ label: `Go to ${a.name}`, run: () => { closeSheet(); go(`artist/${a.id}`); } }))),
		"-",
		{ label: "Add to playlist…", run: () => addToPlaylistMenu(anchor, [track.id]) },
		{ label: "Show queue", run: () => openSheet() },
		...(track.upload ? [] : [{ label: "Share…", run: () => shareSong(track) }]),
		{ label: sleepText() ? `Sleep timer (${sleepText()})…` : "Sleep timer…", run: () => setTimeout(() => sleepMenu(anchor)) },
	];
	const who = WORKSPACE_URL && !track.upload ? readWho(localStorage) : null;
	if (who) items.push("-", { label: LEVELS[who.level].canWrite ? "Edit song details" : "Suggest a correction", run: () => { closeSheet(); go("workspace", { album: track.album.id, track: track.id }); } });
	openMenu(anchor, items);
}

function trackMenu(anchor, track, extra) {
	const items = [
		{ label: "Play next", run: () => { player.playNext([track.id]); notify(`“${track.title}” plays next`); } },
		{ label: "Add to queue", run: () => { player.addToQueue([track.id]); notify("Added to queue"); } },
		{ label: "Add to playlist…", run: () => addToPlaylistMenu(anchor, [track.id]) },
		...(track.listenOnly ? [] : [offline.has(track.id)
			? { label: "Remove download", run: () => offline.remove([track.id]) }
			: { label: "Download", run: () => startDownload([track]) }]),
		"-",
		{ label: "Go to album", run: () => { closeSheet(); go(`album/${track.album.id}`); } },
		...(LYRICS_URL && !track.upload ? [{ label: "Lyrics", run: () => { closeSheet(); go(`lyrics/${track.id}`); } }] : []),
		...(track.upload ? [] : [{ label: "Share…", run: () => shareSong(track) }]),
		...(track.upload ? [] : track.artists.slice(0, 2).map((a) => ({ label: `Go to ${a.name}`, run: () => { closeSheet(); go(`artist/${a.id}`); } }))),
	];
	if (track.upload) {
		items.push("-",
			{ label: "Edit details…", run: () => editUpload(track) },
			{ label: "Delete from your uploads", run: async () => {
				if (!(await confirmAction(`Delete “${track.title}” from your uploads? The file is removed for good.`, "Delete"))) return;
				await uploads.remove(track.uploadId);
				notify(`“${track.title}” deleted`);
			} });
		openMenu(anchor, items);
		return;
	}
	// Signed in to the Workspace: straight to this song in its album's editor.
	const who = WORKSPACE_URL ? readWho(localStorage) : null;
	if (who) items.push("-", { label: LEVELS[who.level].canWrite ? "Edit song details" : "Suggest a correction", run: () => { closeSheet(); go("workspace", { album: track.album.id, track: track.id }); } });
	// The audio studio (docs/audio-studio.md): trimming the recording's start and end.
	if (uploads.canAudio) items.push(...(who ? [] : ["-"]), { label: "Trim in the audio studio", run: () => { closeSheet(); go(`audio/${track.id}`); } });
	if (extra === "queue") {
		items.push("-", { label: "Remove from queue", run: () => player.removeAt(player.state.queue.indexOf(track.id)) });
	} else if (extra?.startsWith("playlist:")) {
		const pid = Number(extra.split(":")[1]);
		items.push("-", { label: "Remove from this playlist", run: () => library.removeFromPlaylist(pid, track.id) });
	}
	openMenu(anchor, items);
}

async function startDownload(tracks) {
	const n = await offline.enqueue(tracks);
	if (n) notify(n === 1 ? `Downloading “${tracks[0].title}”` : `Downloading ${n} songs`);
	else notify("Already downloaded");
}

/** A track id from markup: catalog ids are numbers, uploads' ids are text ("u12"). */
const trackIdOf = (v) => (/^\d+$/.test(v ?? "") ? Number(v) : v);

/* =================================================================== events */
const listTracks = (key) => (getList(key)?.ids ?? []).map((id) => catalog.track(id)).filter(Boolean);

const actions = {
	async play(el) {
		const { ids, context } = getList(el.dataset.list);
		const id = trackIdOf(el.dataset.id);
		if (el.closest("[data-extra=queue]")) return player.jump(Number(el.closest(".track").dataset.index));
		if (player.current()?.id === id && player.state.queue.join() === ids.join()) return player.toggle();
		await player.playList(ids, id, context);
	},
	async "play-album"(el) {
		const album = catalog.album(el.dataset.album);
		if (!album) throw new Error("That album is no longer in the catalog.");
		if (player.state.shuffle) player.setShuffle(false);
		await player.playList(album.tracks.map((t) => t.id), album.tracks[0].id, album.title);
	},
	async "play-all"(el) {
		const { ids, context } = getList(el.dataset.list);
		if (player.state.shuffle) player.setShuffle(false);
		await player.playList(ids, ids[0], context);
	},
	async "shuffle-all"(el) {
		const { ids, context } = getList(el.dataset.list);
		player.setShuffle(true);
		await player.playList(ids, undefined, context);
	},
	async like(el) {
		const liked = await library.toggleLike(trackIdOf(el.dataset.id));
		setLikeState(el, liked, { animate: true });
	},
	back() {
		if (navDepth > 1) history.back();
		else go("", undefined, { replace: true });
	},
	/** The installed app's title bar: forward again after Back (nothing happens when there is no page ahead). */
	forward() {
		history.forward();
	},
	"more-artists"(el) {
		const rest = el.parentElement.querySelector("[data-more-artists]");
		rest.hidden = false;
		el.remove();
	},
	"copy-code"(el) { copyCode(el.dataset.code, el); },
	// Phones: the round button beside the search field clears it first, then leaves search.
	"search-clear"() {
		const q = $("#q");
		if (!q) return;
		q.value = "";
		$(".search-clear").hidden = true;
		runSearch("");
		q.focus();
		updateSuggestions(catalog, q);
	},
	/*
	 * Leaving search. The bar that comes back puts its buttons where the finger
	 * was: it takes no taps for a moment, so the same tap cannot land on one.
	 */
	"search-back"() {
		const nav = $(".navbar");
		nav.inert = true;
		setTimeout(() => { nav.inert = false; }, 450);
		closeSuggestions($("#q"));
		$("#q")?.blur();
		actions.back();
	},
	"recent-forget"(el) {
		forgetSearch(el.dataset.q);
		runSearch($("#q")?.value ?? "");
	},
	"recent-clear"() {
		forgetSearches();
		runSearch($("#q")?.value ?? "");
	},
	"app-menu"() {
		if ($("#app-menu").hidden) openAppMenu();
		else closeAppMenu({ restoreFocus: true });
	},
	consent(el) {
		analytics.setChoice(el.dataset.value);
		$("#consent")?.remove();
		syncStatsButtons();
		// About shows the current choice; refresh it when changed there.
		if (currentRoute?.path === "about") rerender();
		else if (el.dataset.value === "granted") analytics.pageView(`${location.origin}${location.pathname}#/${currentRoute?.path ?? ""}`, document.title);
	},
	/** Leaves an album shared with the person; one that came with all of its owner's music leaves all of it, after asking. */
	async "leave-share"(el) {
		const album = catalog.album(el.dataset.album);
		const own = uploads.receivedFor(album);
		const one = own.find((x) => x.album !== null);
		const share = one ?? own[0];
		if (!share) return;
		if (!one && !(await confirmAction(`“${album.title}” came with all of ${share.owner.name}'s music. Leave all of it? ${share.owner.name} can share it again.`, "Leave all of it"))) return;
		try {
			await uploads.unshare(share.id);
			notify(one ? `Left “${album.title}”` : `Left ${share.owner.name}'s music`);
			go("library/uploads");
		} catch (err) {
			notify(err.message, { kind: "error" });
		}
	},
	/** "Private" in search: the person's own music, and music shared with them, searched too, or not (kept per device). */
	"search-mine"() {
		setIncludeMine(!includeMine());
		for (const b of $$("[data-act=search-mine]")) b.setAttribute("aria-pressed", String(includeMine()));
		const input = $("#q");
		runSearch(input.value);
		if (document.activeElement === input) updateSuggestions(catalog, input);
	},
	scope(el) {
		setScope(el.dataset.scope);
		const input = $("#q");
		runSearch(input.value);
		// From the suggestions panel the box keeps focus and the list follows the scope.
		if (document.activeElement === input) updateSuggestions(catalog, input);
	},
	"search-for"(el) {
		const input = $("#q");
		input.value = el.dataset.q;
		$(".search-clear").hidden = false;
		rememberSearch(el.dataset.q);
		runSearch(el.dataset.q);
		// On a touch screen the results are what was asked for, not the keyboard.
		if (matchMedia("(pointer: coarse)").matches) { input.blur(); closeSuggestions(input); } else input.focus();
	},
	"artist-lang"(el) {
		const section = el.closest("[data-artist-tabs]");
		for (const b of $$("[data-act=artist-lang]", section)) b.setAttribute("aria-selected", String(b === el));
		for (const panel of $$("[data-lang-panel]", section)) panel.hidden = panel.dataset.langPanel !== el.dataset.lang;
	},
	menu(el) {
		const track = catalog.track(trackIdOf(el.dataset.id));
		trackMenu(el, track, el.closest(".track")?.dataset.extra);
	},
	"list-menu"(el) {
		const { ids } = getList(el.dataset.list);
		openMenu(el, [
			{ label: "Play next", run: () => { player.playNext(ids); notify("These songs play next"); } },
			{ label: "Add to queue", run: () => { player.addToQueue(ids); notify(`Added ${ids.length} songs to queue`); } },
			{ label: "Add to playlist…", run: () => addToPlaylistMenu(el, ids) },
			...(el.dataset.share ? ["-", { label: "Share…", run: () => shareLink(el.dataset.share, el.dataset.shareTitle ?? "") }] : []),
		]);
	},
	share: (el) => shareLink(el.dataset.share, el.dataset.shareTitle ?? ""),
	sleep: (el) => sleepMenu(el),
	// The bar's Up next (wide windows): that song now.
	"bar-next": (el) => player.jump(Number(el.dataset.index)),
	// The bar's quick actions (wide windows), out of its More menu.
	"bar-playlist": (el) => { const t = player.current(); if (t) addToPlaylistMenu(el, [t.id]); },
	"bar-share": () => { const t = player.current(); if (t) shareSong(t); },
	"bar-download": () => {
		const t = player.current();
		if (!t) return;
		if (offline.has(t.id)) offline.remove([t.id]);
		else startDownload([t]);
	},
	"ask-publish": (el) => askPublish(catalog.album(el.dataset.album)),
	async "withdraw-publish"(el) {
		if (!(await confirmAction("Withdraw the request to publish?", "Withdraw"))) return;
		await uploads.withdrawPublish(Number(el.dataset.id));
		notify("Withdrawn; the album is yours alone again");
	},
	download: (el) => startDownload(listTracks(el.dataset.list)),
	async "remove-download"(el) {
		if (el.dataset.confirm && !(await confirmAction(el.dataset.confirm, "Remove"))) return;
		const ids = getList(el.dataset.list).ids.filter((id) => offline.has(id));
		await offline.remove(ids);
		notify(ids.length === 1 ? "Removed 1 download" : `Removed ${ids.length} downloads`);
	},
	more: (el) => showMore(el),
	reshuffle: () => { V.reshuffle(); rerender(); },
	async "new-playlist"() {
		const name = await promptText("Name the new playlist", "", "Create");
		if (!name) return;
		const p = await library.createPlaylist(name);
		go(`playlist/${p.id}`);
	},
	async "rename-playlist"(el) {
		const p = library.playlist(Number(el.dataset.id));
		const name = await promptText("Rename playlist", p.name);
		if (name) await library.renamePlaylist(p.id, name);
	},
	async "delete-playlist"(el) {
		if (!(await confirmAction(el.dataset.confirm, "Delete"))) return;
		await library.deletePlaylist(Number(el.dataset.id));
		go("library/playlists");
	},
	async "clear-history"(el) {
		if (!(await confirmAction(el.dataset.confirm, "Clear"))) return;
		await library.clearHistory();
		rerender();
	},
	"clear-queue": () => player.clearUpcoming(),
	"close-sheet": () => closeSheet(),
	"np-lyrics": () => { npLyrics.toggle(); renderSheet(); },
	"scene-menu": (el) => openSceneMenu(el),
	sound: (el) => { openSoundPanel(el, closeMenu); menuReturnFocus = el; },
	watch: () => enterWatch(),
	"watch-exit": () => exitWatch(),
	"watch-scene": () => nextWatchScene(),
	"watch-info"() {
		try { localStorage.setItem(WATCH_INFO_KEY, watchInfoKept() ? "auto" : "keep"); } catch { /* lasts this visit only */ }
		renderWatch();
		wakeWatch();
	},
	rail() {
		const state = railState();
		saveRail({ ...state, mini: !state.mini });
	},
	"rail-sec"(el) {
		const state = railState();
		const id = el.closest(".rail-sec").dataset.sec;
		const toggle = (list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
		saveRail(FOLDED_FIRST.includes(id) ? { ...state, opened: toggle(state.opened) } : { ...state, closed: toggle(state.closed) });
	},
	"stats-on"() {
		analytics.setChoice("granted");
		$("#consent")?.remove();
		syncStatsButtons();
		analytics.pageView(`${location.origin}${location.pathname}#/${currentRoute?.path ?? ""}`, document.title);
		notify("Thank you. Listening statistics are on; you can turn them off on About.");
		if (currentRoute?.path === "about") rerender();
	},
	"open-sheet": () => openSheet(),
	async export() {
		const data = await library.exportData();
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `zaideih-library-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	},
};

document.addEventListener("click", async (e) => {
	// composedPath: a click that re-rendered part of a menu (the Sound panel) still counts as inside it.
	if (!e.composedPath().some((el) => el.classList?.contains("menu"))) closeMenu();
	// A song's lyrics mark opens its lyrics instead of playing it.
	const lyr = e.target.closest(".track [data-lyrics]");
	if (lyr) {
		e.preventDefault();
		closeSheet();
		go(`lyrics/${lyr.dataset.lyrics}`);
		return;
	}
	const ctl = e.target.closest("[data-ctl]");
	if (ctl && ctl.tagName === "BUTTON") {
		const c = ctl.dataset.ctl;
		// Nothing playing yet: Play plays what the page is about (its own Play), when it has one.
		const page = !player.current() && c === "toggle" ? $("main [data-page-play]") : null;
		if (page) page.click();
		else if (c === "toggle") player.toggle();
		else if (c === "next") player.next();
		else if (c === "prev") player.previous();
		else if (c === "shuffle") player.setShuffle(!player.state.shuffle);
		else if (c === "repeat") player.cycleRepeat();
		else if (c === "mute") player.toggleMute();
		return;
	}
	const el = e.target.closest("[data-act]");
	if (!el || el.tagName === "FORM" || el.tagName === "SELECT" || el.tagName === "INPUT") return;
	const fn = actions[el.dataset.act];
	if (!fn) return;
	if (el.tagName !== "A") e.preventDefault();
	// A button already working ignores more clicks; one still working after a moment shows it (a spinner, disabled).
	if (el.tagName === "BUTTON" && el.getAttribute("aria-busy") === "true") return;
	const running = Promise.resolve().then(() => fn(el));
	const mark = el.tagName === "BUTTON" ? setTimeout(() => markBusy(el, true), BUSY_AFTER_MS) : 0;
	if (el.tagName === "BUTTON") el.setAttribute("aria-busy", "true");
	try { await running; } catch (err) { console.error(err); notify(err.message, { kind: "error" }); }
	finally {
		clearTimeout(mark);
		if (el.tagName === "BUTTON") markBusy(el, false);
	}
});

/** A slow action's button shows a spinner after this long; a quick one never does. */
const BUSY_AFTER_MS = 200;

/** Marks a button as working (a spinner before its label, disabled), or gives it back. */
function markBusy(el, on) {
	if (on) {
		if (!el.isConnected || el.querySelector(".btn-spin")) return;
		el.dataset.wasDisabled = String(el.disabled);
		el.disabled = true;
		el.insertAdjacentHTML("afterbegin", '<span class="btn-spin" aria-hidden="true"></span>');
		return;
	}
	el.removeAttribute("aria-busy");
	if (!el.querySelector(".btn-spin")) return;
	el.querySelector(".btn-spin").remove();
	el.disabled = el.dataset.wasDisabled === "true";
	delete el.dataset.wasDisabled;
}

document.addEventListener("change", async (e) => {
	const el = e.target;
	if (el.dataset.act === "sort") {
		go(currentRoute.path, { sort: el.value });
	} else if (el.dataset.act === "publish-toggle") {
		// Waits for the answer: switched once, not again meanwhile.
		el.disabled = true;
		try { await publishToggle(el); } finally { el.disabled = false; }
	} else if (el.dataset.act === "import" && el.files?.[0]) {
		try {
			const data = JSON.parse(await el.files[0].text());
			await library.importData(data);
			notify("Library restored");
			rerender();
		} catch (err) {
			notify(err instanceof SyntaxError ? "That file is not valid JSON." : err.message, { kind: "error" });
		} finally {
			el.value = "";
		}
	}
});

/** Re-renders the full results below the search box and updates the URL. */
function runSearch(value) {
	if (!$("#results")) return; // search was left before the timer ran
	resetLists();
	resetPending();
	$("#results").innerHTML = V.searchResults(catalog, value, getScope());
	const query = {};
	if (value) query.q = value;
	if (getScope() !== "all") query.in = getScope();
	history.replaceState(history.state, "", href("search", Object.keys(query).length ? query : undefined));
	markPlaying();
}

/** Acts on a chosen suggestion. */
async function chooseSuggestion(opt) {
	const input = $("#q");
	if (!opt || !input) return;
	const typed = input.value;
	closeSuggestions(input);
	if (opt.kind === "hymn") { rememberSearch(typed); location.hash = opt.href; return; }
	if (opt.kind === "artist") { rememberSearch(typed); go(`artist/${opt.item.id}`); return; }
	if (opt.kind === "album") { rememberSearch(typed); go(`album/${opt.item.id}`); return; }
	if (opt.kind === "track") {
		rememberSearch(typed);
		const t = opt.item;
		await player.playList(t.album.tracks.map((x) => x.id), t.id, t.album.title);
		return;
	}
	input.value = opt.query;
	rememberSearch(opt.query);
	runSearch(opt.query);
	input.focus();
}

// The search bar's own buttons: tapping them must not first close the keyboard and move the page under the finger.
document.addEventListener("pointerdown", (e) => {
	if (e.target.closest?.(".search-back, .search-clear")) e.preventDefault();
});

document.addEventListener("input", (e) => {
	const el = e.target;
	if (el.id === "q") {
		const clear = $(".search-clear");
		if (clear) clear.hidden = !el.value;
		updateSuggestions(catalog, el);
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => runSearch(el.value), 140);
	} else if (el.dataset.ctl === "volume") {
		player.setVolume(Number(el.value));
	} else if (el.dataset.ctl === "seek") {
		el.dataset.dragging = "1";
		el.style.setProperty("--pct", `${(el.value / (el.max || 1)) * 100}%`);
	}
});
document.addEventListener("change", (e) => {
	if (e.target.dataset?.ctl === "seek") {
		player.seek(Number(e.target.value));
		delete e.target.dataset.dragging;
	}
}, true);
/* Seek hover preview: the time under the pointer, as a tooltip and a lighter fill. */
const fineHover = matchMedia("(hover: hover) and (pointer: fine)");
function seekPreview(e) {
	const range = e.target.closest?.("[data-ctl=seek]");
	if (!range || !fineHover.matches) return;
	const max = Number(range.max) || 0;
	const tip = range.parentElement.querySelector(".seek-tip");
	if (!max || !tip) return;
	const rect = range.getBoundingClientRect();
	const thumb = 14;
	const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - thumb / 2) / (rect.width - thumb)));
	tip.textContent = formatDuration(frac * max);
	tip.style.left = `${range.offsetLeft + thumb / 2 + frac * (rect.width - thumb)}px`;
	tip.hidden = false;
	range.dataset.hover = "";
	range.style.setProperty("--hover-pct", `${frac * 100}%`);
}
function seekPreviewEnd(e) {
	const range = e.target.closest?.("[data-ctl=seek]");
	if (!range) return;
	delete range.dataset.hover;
	const tip = range.parentElement.querySelector(".seek-tip");
	if (tip) tip.hidden = true;
}
document.addEventListener("pointermove", seekPreview);
document.addEventListener("pointerout", seekPreviewEnd);

document.addEventListener("submit", (e) => {
	if (e.target.dataset.act === "search-form") { e.preventDefault(); $("#q")?.blur(); }
	if (e.target.dataset.act === "code-form") {
		e.preventDefault();
		const value = $("#code-input").value.trim();
		go(value ? `code/${encodeURIComponent(value)}` : "code");
	}
});

document.addEventListener("focusin", (e) => {
	if (e.target.id === "q") updateSuggestions(catalog, e.target);
});
document.addEventListener("focusout", (e) => {
	if (e.target.id !== "q" && !e.target.closest?.("#sg-panel")) return;
	// Let a click on a suggestion land before the list closes; moving focus to
	// the scope buttons (Tab) keeps the panel open.
	setTimeout(() => { if (!document.activeElement?.closest?.("#q, #sg-panel")) closeSuggestions($("#q")); }, 120);
});
document.addEventListener("mousedown", (e) => {
	// Keep focus in the search box while picking from the list.
	if (e.target.closest("#sg-panel")) e.preventDefault();
});
document.addEventListener("click", (e) => {
	if (e.target.closest("[data-sg-clear]")) { clearRecent(catalog, $("#q")); return; }
	const row = e.target.closest("#suggest [data-sg]");
	if (row) chooseSuggestion(pickOption(Number(row.dataset.sg)));
});

document.addEventListener("keydown", (e) => {
	if (e.target.id === "q") {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (moveSelection(e.target, e.key)) e.preventDefault();
			return;
		}
		if (e.key === "Enter") {
			const opt = pickOption();
			if (opt) { e.preventDefault(); chooseSuggestion(opt); return; }
			rememberSearch(e.target.value);
			closeSuggestions(e.target);
			return;
		}
		if (e.key === "Escape" && !$("#suggest").hidden) {
			e.preventDefault();
			closeSuggestions(e.target);
			return;
		}
	}
	if (watching()) {
		if (e.key === "Escape") { e.preventDefault(); exitWatch(); return; }
		wakeWatch(); // other keys show the controls and keep working (Space, arrows)
	}
	if (e.key === "Escape") {
		if (!$("#app-menu").hidden) closeAppMenu({ restoreFocus: true });
		else if ($(".menu")) closeMenu(true);
		else if (!$("#sheet").hidden) closeSheet();
		return;
	}
	const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
	if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
	if (e.key === " " && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); player.toggle(); }
	else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && player.current() && !e.shiftKey) {
		// Seek 5 seconds, unless focus is on a control that uses the arrow keys itself.
		if (document.activeElement?.closest?.("[role=tablist], .menu")) return;
		e.preventDefault();
		player.seek(Math.max(0, (player.audio.currentTime || 0) + (e.key === "ArrowLeft" ? -5 : 5)));
	}
	else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.shiftKey && player.current()) {
		e.preventDefault();
		if (e.key === "ArrowLeft") player.previous(); else player.next();
	}
	else if (e.key === "/") { e.preventDefault(); go("search"); }
});

/* =================================================================== notices */
async function copyCode(code, button) {
	try {
		await navigator.clipboard.writeText(code);
		button.textContent = "Copied";
	} catch {
		// Clipboard refused (permissions, insecure context): select the code instead.
		const range = document.createRange();
		range.selectNodeContents(button.closest(".toast, .error")?.querySelector("code") ?? button);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
		button.textContent = "Selected, copy it";
	}
}

on("notice", ({ message, kind, action, code, help, playback, sticky }) => {
	// A song that cannot play: Now playing already says so, with its code, when it is open.
	if (playback && !$("#sheet").hidden) return;
	const box = $("#toasts");
	const el = document.createElement("div");
	el.className = `toast toast-in ${kind === "error" ? "error" : ""}`;
	// A sticky notice (an update ready) stays until acted on or dismissed: it is offered once.
	if (sticky) el.dataset.sticky = "";
	el.setAttribute("role", kind === "error" ? "alert" : "status");
	// A diagnostic code rides along quietly: small, selectable, with a copy button.
	el.innerHTML = html`<span>${message}${code ? html`<small class="diag">Code <code>${code}</code></small>` : ""}</span>
		<span class="toast-actions">${help ? html`<a href="#/help">Help</a>` : ""}${code ? html`<button data-copy>Copy code</button>` : action ? html`<button>${action.label}</button>` : ""}${sticky ? html`<button data-later>Later</button>` : ""}</span>`;
	if (code) $("[data-copy]", el).addEventListener("click", (e) => copyCode(code, e.currentTarget));
	else if (action) $(".toast-actions button", el).addEventListener("click", () => { action.run(); el.remove(); });
	$("[data-later]", el)?.addEventListener("click", () => el.remove());
	$(".toast-actions a", el)?.addEventListener("click", () => el.remove());
	box.append(el);
	const passing = () => [...box.children].filter((t) => !t.hasAttribute("data-sticky"));
	while (passing().length > 3) passing()[0].remove();
	if (!sticky) setTimeout(() => el.remove(), action || code || help ? 12000 : kind === "error" ? 7000 : 3200);
});

/* =================================================================== live updates */
function refreshDownloadMarks() {
	for (const row of $$(".track[data-track]")) {
		const id = trackIdOf(row.dataset.track);
		const span = $(".saved", row);
		const has = offline.has(id);
		if (span && (span.childElementCount > 0) !== has) span.innerHTML = has ? icon("saved", "Downloaded") : "";
	}
	for (const btn of $$("[data-download-btn]")) {
		const ids = getList(btn.dataset.downloadBtn)?.ids ?? [];
		const saved = ids.filter((id) => offline.has(id)).length;
		const pending = ids.filter((id) => offline.isPending(id)).length;
		if (pending) {
			btn.dataset.act = "download";
			btn.disabled = true;
			btn.innerHTML = html`${icon("download")} Downloading, ${pending} left`;
		} else if (saved === ids.length) {
			btn.disabled = false;
			btn.dataset.act = "remove-download";
			btn.innerHTML = html`${icon("saved")} Downloaded`;
		} else {
			btn.disabled = false;
			btn.dataset.act = "download";
			btn.innerHTML = html`${icon("download")} ${saved ? `Download remaining ${ids.length - saved}` : "Download"}`;
		}
	}
}

let downloadsRerender = 0;
on("downloads", () => {
	refreshDownloadMarks();
	renderBarExtras(catalog, sleepText());
	if (currentRoute?.path === "library/downloads") {
		clearTimeout(downloadsRerender);
		downloadsRerender = setTimeout(rerender, 400);
	}
});
let reportedPlay = null;
on("player", (s) => {
	renderBar();
	markPlaying();
	// One "play_track" per song started; pausing and resuming does not count again.
	const t = player.current();
	// Uploads are private: nothing about them is sent.
	if (s.playing && t && !t.upload && t.id !== reportedPlay) {
		reportedPlay = t.id;
		analytics.event("play_track", { track_id: String(t.id), album_id: t.album.id, language: t.album.lang.name });
	}
});

/* =================================================================== usage statistics consent */
/** The "Share listening statistics" buttons: shown only while statistics are off and no consent card is up. */
function syncStatsButtons() {
	const show = analytics.available && analytics.choice() !== "granted" && !$("#consent");
	for (const b of $$("[data-act=stats-on]")) b.hidden = !show;
}
function showConsent() {
	if (!analytics.available || analytics.choice() || $("#consent")) return;
	const el = document.createElement("section");
	el.id = "consent";
	el.className = "consent";
	el.setAttribute("aria-label", "Usage statistics");
	el.innerHTML = html`<p><strong>Help Zaideih see what is listened to?</strong> With your permission, visits and song plays are counted with Google Analytics. Nothing from your library or searches is sent. <a class="text-link" href="#/terms">Terms</a></p>
		<div class="consent-actions"><button class="btn primary" data-act="consent" data-value="granted">Allow</button><button class="btn" data-act="consent" data-value="denied">No thanks</button></div>`;
	document.body.append(el);
}
on("volume", renderVolume);
on("time", renderTime);
on("library", () => {
	const t = player.current();
	if (t) setLikeState($("#bar-like"), library.isLiked(t.id));
	for (const b of $$("[data-act=like]")) setLikeState(b, library.isLiked(trackIdOf(b.dataset.id)));
	if (/^(library\/(liked|playlists)|library$|playlist\/)/.test(currentRoute?.path ?? "")) rerender();
});

/*
 * The visible height above the on-screen keyboard (--vvh), so the search
 * suggestions end where the keyboard begins instead of running under it.
 */
// Less covered than this is a toolbar or a rounding difference, not a keyboard.
const KEYBOARD_MIN = 120;
function trackVisibleHeight() {
	const vv = window.visualViewport;
	if (!vv) return;
	// --vvt: how far the visible area sits below the top of the layout (the
	// keyboard pushes it); the fixed top controls move by it to stay in view.
	let frame = 0;
	const set = () => {
		frame = 0;
		const root = document.documentElement.style;
		root.setProperty("--vvh", `${Math.round(vv.height)}px`);
		// Only the keyboard moves the controls. Pulling past the bottom of a page
		// (iOS rubber band) also shifts the visible area, by up to the pull, and
		// the controls would slide down with it; there the visible area is as
		// tall as the window, so nothing is covered and the offset is ignored.
		const covered = Math.max(0, innerHeight - vv.height);
		const offset = covered > KEYBOARD_MIN ? Math.min(Math.max(0, vv.offsetTop), covered) : 0;
		root.setProperty("--vvt", `${Math.round(offset)}px`);
		// --kb: how much of the layout the keyboard covers below the visible area (the studio lifts the player above it).
		root.setProperty("--kb", `${covered > KEYBOARD_MIN ? Math.max(0, Math.round(innerHeight - vv.height - Math.max(0, vv.offsetTop))) : 0}px`);
	};
	const soon = () => { frame ||= requestAnimationFrame(set); };
	vv.addEventListener("resize", soon);
	vv.addEventListener("scroll", soon);
	set();
}
trackVisibleHeight();
// How chords look, as chosen on this device (ui/chord-style.js).
applyChordStyle();

/*
 * Typing on a touch screen (a text field has the focus): body[data-typing],
 * so the player steps aside (app.css); above the keyboard there is no room
 * for it. The lyrics studio keeps it, lifted above the keyboard, to play
 * while writing. Dragging the page while the search field has the keyboard
 * closes the keyboard, as native apps do: with it open, iPhone pans the page
 * under the fixed field, which follows only once Safari reports the pan
 * (--vvt), so the field seemed to scroll with the page.
 */
const NOT_TYPED = /^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/;
const DRAG_PX = 10;
function watchTyping() {
	const touch = matchMedia("(pointer: coarse)");
	const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !NOT_TYPED.test(el.type)));
	const set = () => document.body.toggleAttribute("data-typing", touch.matches && typing(document.activeElement));
	document.addEventListener("focusin", set);
	// Focus moving from one field to the next passes through the body: look once it has landed.
	document.addEventListener("focusout", () => setTimeout(set, 0));
	let startY = null;
	document.addEventListener("touchstart", (e) => { startY = e.touches[0]?.clientY ?? null; }, { passive: true });
	document.addEventListener("touchmove", (e) => {
		const q = document.activeElement;
		if (startY === null || q?.id !== "q" || !touch.matches) return;
		// The field itself, its buttons and the suggestions list scroll as they are.
		if (e.target instanceof Element && e.target.closest(".searchbox, .suggest")) return;
		if (Math.abs((e.touches[0]?.clientY ?? startY) - startY) < DRAG_PX) return;
		startY = null;
		q.blur();
	}, { passive: true });
}
watchTyping();

/*
 * Home on phones: once a scroll has come to rest by itself, a section's title
 * within SETTLE_PX of the bar glides the rest of the way to sit just under
 * it. The scroll itself is never touched while it moves (CSS scroll
 * snapping did, and dragged on iPhone), and a rest anywhere else stays.
 */
const SETTLE_PX = 48;
const SETTLE_WAIT_MS = 160;
function settleOnSections() {
	const phone = matchMedia("(max-width: 899px)");
	let touching = false;
	let timer = 0;
	let settling = false;
	const check = () => {
		timer = 0;
		if (touching || settling || !phone.matches || document.body.dataset.page !== "home" || lockedAt !== null) return;
		const edge = $(".navbar").getBoundingClientRect().bottom + 8;
		for (const header of $$("#view .section > header")) {
			const d = header.getBoundingClientRect().top - edge;
			if (Math.abs(d) <= SETTLE_PX && Math.abs(d) >= 2) {
				settling = true;
				scrollBy({ top: d, behavior: "smooth" });
				// Its own glide is not a rest to settle again from.
				setTimeout(() => { settling = false; }, 600);
				return;
			}
		}
	};
	const later = () => {
		clearTimeout(timer);
		timer = setTimeout(check, SETTLE_WAIT_MS);
	};
	addEventListener("scroll", () => { if (!settling) later(); }, { passive: true });
	addEventListener("touchstart", () => { touching = true; clearTimeout(timer); }, { passive: true });
	addEventListener("touchend", () => { touching = false; later(); }, { passive: true });
	addEventListener("touchcancel", () => { touching = false; later(); }, { passive: true });
}
settleOnSections();

function setOnline() {
	document.body.classList.toggle("is-offline", !navigator.onLine);
	for (const el of $$("[data-offline]")) el.hidden = navigator.onLine;
}
addEventListener("online", () => { setOnline(); notify("Back online"); });
addEventListener("offline", () => { setOnline(); notify("You're offline. Downloaded songs still play."); });

/* =================================================================== sync */
/*
 * Liked songs and playlists on every device (core/sync.js, docs/sync.md):
 * sent and fetched while signed in, at start, on signing in, soon after a
 * change, when the connection returns, when the app is shown again, and
 * every SYNC_EVERY_MS while it is open.
 */
const SYNC_EVERY_MS = 5 * 60_000;
let syncer = null;
/*
 * The lyrics index (core/lyrics-index.js): kept on the device for searching
 * by a line of lyrics and for the mark on songs that have lyrics; refreshed
 * at start and when the app comes back into view (at most every 30 minutes).
 * Pages with song lists are drawn again when it changes, for the mark.
 */
function startLyricsIndex() {
	const refresh = () => lyricsIndex.refresh().catch((err) => console.warn("the lyrics index could not be read; searching lyrics uses what is kept", err));
	refresh();
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
	on("lyrics-index", () => {
		if (/^(album|artist|playlist|search|library|top|genre|lang)/.test(currentRoute?.path ?? "") && !document.body.classList.contains("search-open")) rerenderSoon();
	});
}

function startSync() {
	if (!LIBRARY_URL || !AUTH_URL) return;
	syncer = createSync({
		load: async () => (await db.get("kv", "sync.state")) ?? { outbox: [], since: 0, member: null },
		save: (s) => db.put("kv", s, "sync.state"),
		local: () => library.snapshot(),
		apply: (remote, pending) => library.applyRemote(remote, pending),
		send: async (body) => {
			const res = await account().send((token) => fetch(`${LIBRARY_URL}/sync`, {
				method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
			}));
			const answer = await res.json().catch(() => null);
			if (!res.ok) throw new Error(answer?.error ?? `the library answered HTTP ${res.status}`);
			return answer;
		},
		member: async () => {
			const a = account();
			if (!a.signedIn) return null;
			await a.token();
			return a.member?.id ?? null;
		},
		online: () => navigator.onLine,
	});
	library.onChange = (change) => { syncer.note(change).catch((err) => console.warn("a library change could not be kept for syncing", err)); };
	const sync = () => syncer.run().catch((err) => console.warn("syncing the library failed; it is tried again later", err));
	addEventListener("online", sync);
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
	setInterval(() => { if (document.visibilityState === "visible") sync(); }, SYNC_EVERY_MS);
	sync();
}

/* =================================================================== boot */
const START_LIMIT_MS = 20_000;

/** The parts the app starts with, all of them; an error naming those not ready after START_LIMIT_MS. */
function startParts(parts) {
	const pending = new Set(parts.map(([name]) => name));
	const all = Promise.all(parts.map(([name, p]) => p.then((v) => { pending.delete(name); return v; })));
	let timer = 0;
	const late = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new StorageError(`Zaideih did not finish starting: still waiting for ${[...pending].join(" and ")}. Close Zaideih completely and open it again.`)), START_LIMIT_MS);
	});
	return Promise.race([all, late]).finally(() => clearTimeout(timer));
}
function fatal(err) {
	console.error(err);
	const known = err instanceof CatalogLoadError || err instanceof StorageError;
	document.body.innerHTML = html`<div class="fatal" role="alert">
		<h1>Zaideih couldn't start</h1>
		<p>${known ? err.message : `Unexpected error: ${err.message}`}</p>
		<p><button class="btn primary" id="retry">Try again</button></p>
	</div>`;
	$("#retry").addEventListener("click", retryStart);
}

/**
 * "Try again" from the start error. A release that changed the catalog format
 * leaves the old app unable to read it; a reload alone starts the same cached
 * app again, so a waiting new version is let in first.
 */
async function retryStart() {
	const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
	const waiting = reg?.waiting ?? (reg && (await reg.update().then(() => reg.waiting ?? reg.installing, () => null)));
	if (!waiting) { location.reload(); return; }
	navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
	const send = () => waiting.postMessage({ type: "skip-waiting" });
	if (waiting.state === "installed") send();
	else waiting.addEventListener("statechange", () => { if (waiting.state === "installed") send(); });
	// A worker that never takes over still ends in a reload.
	setTimeout(() => location.reload(), 8000);
}

/**
 * Starts the app inside a platform shell.
 *
 * @param {object} platform
 * @param {"web"|"desktop"} platform.name
 * @param {string} platform.catalogBase   URL prefix of meta.json and the catalog file
 * @param {() => void} [platform.onReady] called once the first view has rendered
 */
/**
 * The installed app's own title bar (window-controls-overlay, app.css): where
 * the window's buttons are. On macOS they are on the left, over the sidebar,
 * which then starts below them (body[data-tb-left]).
 */
function watchTitleBar() {
	const wco = navigator.windowControlsOverlay;
	if (!wco) return;
	const place = () => document.body.toggleAttribute("data-tb-left", wco.visible && wco.getTitlebarAreaRect().x > 0);
	wco.addEventListener("geometrychange", place);
	place();
	// Content under the bar casts a shadow below it (app.css), as soon as the page has scrolled.
	let frame = 0;
	const mark = () => { frame = 0; document.body.toggleAttribute("data-scrolled", scrollY > 0); };
	addEventListener("scroll", () => { frame ||= requestAnimationFrame(mark); }, { passive: true });
	addEventListener("hashchange", () => requestAnimationFrame(mark));
	mark();
}

export async function boot(platform) {
	if (!platform?.name || typeof platform.catalogBase !== "string") {
		throw new TypeError("boot() requires a platform with a name and catalogBase");
	}
	document.documentElement.dataset.platform = platform.name;
	for (const el of $$("[data-logo]")) el.innerHTML = logoMark();
	setOnline();
	watchTitleBar();
	if (probeOn()) startProbe();
	// A start that never finishes: the loading screen offers a reload by itself (index.html, .splash-late),
	// and a part still not ready after START_LIMIT_MS is named in the error.
	try {
		const [model] = await startParts([
			["the music catalog", loadCatalog(platform.catalogBase)],
			["the library on this device", library.init()],
			["the downloads on this device", offline.init()],
		]);
		catalog = model;
	} catch (err) {
		fatal(err);
		return;
	}
	startSync();
	startLyricsIndex();
	// The line being sung in the bar, on wide windows.
	startBarLyrics();
	// The public songbooks' hymns (core/songbooks.js): Songbooks shows in the sidebar once there are any.
	refreshHymnIndex().then(() => syncAccess(), (err) => console.warn("songbooks index", err.message));
	// Uploads: read once someone is signed in (syncAccess), shown where they appear.
	uploads.catalog = catalog;
	syncAccess();
	on("uploads", () => {
		// The hymns of the books, for search and for naming them: signed in, the private ones the person sees too
		// (the Songbooks right, or appointed to a book); Songbooks shows in the sidebar once there are any.
		refreshHymnIndex().then(() => {
			for (const a of $$(".rail-songbooks, .am-songbooks")) a.hidden = !uploads.canSongbooks && !hymnBooks().length;
		}, (err) => console.warn("songbooks index", err.message));
		const path = currentRoute?.path ?? "";
		// "My music" in search: offered once the person's own music is known, taken away when there is none (signed out).
		// The search box keeps its focus and text; only the results are drawn again when they would change.
		const mineNow = V.hasMine(catalog);
		let mineChanged = false;
		for (const b of $$("[data-act=search-mine]")) {
			if (b.hidden === mineNow) { b.hidden = !mineNow; mineChanged = true; }
		}
		if (mineChanged && includeMine() && $("#q")?.value) runSearch($("#q").value);
		// Songbook pages show editing to the Songbooks right, known once the member is read.
		if (path === "library" || path === "library/uploads" || path.startsWith("album/u-") || path.startsWith("songbook")) rerender();
		// Sharing: its pages show the person's own music and shares, known once read.
		if (path.startsWith("share/") || path.startsWith("join/")) rerender();
		// An invite opened before signing in opens again once they have.
		const invite = pendingInvite();
		if (invite && uploads.state.member && !path.startsWith("join/")) go(`join/${invite}`);
		// Downloads that may no longer be kept: songs of one's own taken out, and shared songs taken back or made listen only.
		if (uploads.state.member && !uploads.state.loading && !uploads.state.error) {
			const gone = offline.downloadedIds().filter((id) => /^u\d+$/.test(id) && (!catalog.extra.tracks.has(id) || catalog.extra.tracks.get(id).listenOnly));
			if (gone.length) offline.remove(gone).catch((err) => console.warn("removing downloads no longer shared", err));
		}
		// The audio studio, opened before the member's rights were read (a link, a reload): drawn once they are.
		else if (path.startsWith("audio/") && studioWaiting() && !uploads.state.loading) rerender();
	});
	// Counted plays (GET /plays) on top of the catalog's counts: saved ones at once, fresh ones when they arrive.
	startPlayTotals(catalog, {
		onChange: () => {
			clearArtCaches();
			const path = currentRoute?.path ?? "";
			if ((path === "" || /^(top|genres|lang\/|artist\/|album\/|genre\/)/.test(path)) && !document.body.classList.contains("search-open")) rerenderSoon();
		},
	});
	// Albums held back without a release (docs/holds.md): the last known ones at once, fresh ones when they arrive.
	// Songs trimmed in the audio studio (core/audio-edits.js): their versions and lengths; downloads of other versions fetched again.
	// The audio studio keeps its own state (cuts, a listen, what was just saved) and reads the song itself: it is not drawn again.
	const inStudio = () => (currentRoute?.path ?? "").startsWith("audio/");
	const edits = editsCtl = startEdits(catalog, {
		onChange: () => {
			offline.refreshVersions(catalog).catch((err) => console.warn("downloads of trimmed songs", err.message));
			if (!document.body.classList.contains("search-open") && !inStudio()) rerenderSoon();
		},
	});
	// Catalog changes made live, without a release (docs/live-catalog.md): applied on top of the released catalog.
	startLive({
		apply: (changes) => {
			applyLive(catalog, changes);
			if (catalog.totals) applyTotals(catalog, catalog.totals);
			edits.reapply();
		},
		onChange: () => {
			clearArtCaches();
			renderRail();
			if (!document.body.classList.contains("search-open") && !inStudio()) rerenderSoon();
		},
	});
	startHolds(catalog, {
		onChange: () => {
			// The catalog was built again: the trimmed songs' lengths go back on.
			edits.reapply();
			clearArtCaches();
			renderRail();
			if (!document.body.classList.contains("search-open") && !inStudio()) rerenderSoon();
		},
	});
	clearArtCaches();
	renderRail();
	syncAccess();
	// A sign-in or sign-out in another tab.
	addEventListener("storage", (e) => { if (e.key === null || e.key.startsWith("zaideih.workspace.") || e.key === "zaideih.account") syncAccess(); });
	$("#bar-now").addEventListener("click", openSheet);
	$("#bar-more").addEventListener("click", (e) => { e.stopPropagation(); const t = player.current(); if (t) barMenu(e.currentTarget, t); });
	$("#bar-like").addEventListener("click", async (e) => {
		const t = player.current();
		if (t) setLikeState(e.currentTarget, await library.toggleLike(t.id), { animate: true });
	});
	analytics.init();
	viz.init($("#bar"));
	setLangName(V.langLabel);
	// The playing song as a picture (title, artists, album) for the lock screen and car stereos, drawn at once (ui/now-art.js).
	player.setArtwork((t) => nowPlayingImage(t));
	// Fonts that arrive after a picture was drawn with a stand-in: drawn again with them.
	prepareNowArt()?.then(() => player.refreshArtwork());
	renderVolume();
	await player.init(catalog);
	startPlayCounting(player.audio, () => player.current());
	renderBar();
	document.addEventListener("click", (e) => {
		// A tap outside the open logo menu closes it, and so does any link in it,
		// including one to the page already open (which changes nothing else).
		if ($("#app-menu").hidden) return;
		if (!e.target.closest("#app-menu, .nav-logo") || e.target.closest("#app-menu a")) closeAppMenu();
	});
	// A link in the menu: the menu closes onto the new page, without first putting the old one back in place.
	addEventListener("hashchange", () => { trackDepth(); closeMenu(); closeAppMenu({ restoreScroll: false }); if (!$("#sheet").hidden) closeSheet(); render(); });
	trackDepth();
	await render();
	document.body.classList.add("ready");
	// The loading screen (index.html) fades once the first page is drawn.
	const splash = $("#splash");
	if (splash) {
		splash.classList.add("done");
		setTimeout(() => splash.remove(), 400);
	}
	showConsent();
	syncStatsButtons();
	initTips();
	emit("ready");
	platform.onReady?.();
}
