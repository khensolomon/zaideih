import { APP_VERSION } from "./config.js";
import { CatalogLoadError, creditOf, loadCatalog } from "./core/catalog.js";
import { escape, html } from "./core/html.js";
import { library } from "./core/library.js";
import { offline } from "./core/offline.js";
import { player } from "./core/player.js";
import { go, href, parse, route } from "./core/router.js";
import { emit, notify, on } from "./core/store.js";
import { formatDuration } from "./core/text.js";
import { icon } from "./ui/icons.js";
import { cover, getList, registerList, resetLists, resetPending, scriptClass, showMore, trackRow } from "./ui/parts.js";
import * as V from "./ui/views.js";

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
route("playlist/:id", V.playlist);

async function render({ keepScroll = false } = {}) {
	const r = parse();
	const view = $("#view");
	if (!r) { go("", undefined, { replace: true }); return; }
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
	if (parse()?.path !== r.path && !keepScroll) return; // navigated away while rendering
	view.innerHTML = out.body;
	document.title = out.title === "Home" ? "Zaideih" : `${out.title} | Zaideih`;
	markNav(r.path);
	scrollTo(0, scroll);
	if (!keepScroll) {
		const heading = view.querySelector("h1");
		if (heading && !$("#q")) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
	}
	const q = $("#q");
	if (q && !keepScroll) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

function markNav(path) {
	const section = path.startsWith("search") ? "search" : path.startsWith("library") || path.startsWith("playlist") ? "library" : "home";
	for (const a of $$("[data-nav]")) {
		if (a.dataset.nav === section) a.setAttribute("aria-current", "page");
		else a.removeAttribute("aria-current");
	}
}

const rerender = () => render({ keepScroll: true });

/* =================================================================== shell */
function renderRail() {
	const langs = [...catalog.langs.values()].sort((a, b) => b.albums.length - a.albums.length);
	$("#rail-langs").innerHTML = html`${langs.map((l) => html`<a href="${href(`lang/${l.id}`)}"><span>${V.langLabel(l)}</span><span>${l.albums.length}</span></a>`)}`;
}

/* =================================================================== player bar */
function renderBar() {
	const t = player.current();
	const s = player.state;
	const bar = $("#bar");
	bar.classList.toggle("idle", !t);
	$("#bar-now").innerHTML = t
		? html`${cover(t.album, { label: false })}<span class="meta"><span class="title ${scriptClass(t.title)}">${t.title}</span><span class="sub">${s.error ? s.error : creditOf(t.artists)}</span></span>`
		: html`<span class="meta"><span class="title">Nothing playing</span><span class="sub">Pick a song to start</span></span>`;
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
	if (t) likeBtn.setAttribute("aria-pressed", String(library.isLiked(t.id)));
	if (!$("#sheet").hidden) renderSheet();
}

function renderTime({ position, duration }) {
	const pct = duration ? (position / duration) * 100 : 0;
	$("#bar-progress").style.width = `${pct}%`;
	for (const range of $$("[data-ctl=seek]")) {
		if (range.dataset.dragging) continue;
		range.max = String(duration || 0);
		range.value = String(position);
		range.style.setProperty("--pct", `${pct}%`);
	}
	for (const el of $$("[data-time=pos]")) el.textContent = formatDuration(position);
	for (const el of $$("[data-time=dur]")) el.textContent = formatDuration(duration);
}

function markPlaying() {
	const id = player.current()?.id;
	for (const row of $$(".track[data-track]")) row.classList.toggle("now", Number(row.dataset.track) === id);
}

/* =================================================================== now playing sheet */
function renderSheet() {
	const t = player.current();
	const s = player.state;
	const sheet = $("#sheet");
	if (!t) { sheet.innerHTML = html`<div class="top"><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("down")}</button></div><div class="empty"><h2>Nothing playing</h2></div>`; return; }
	const queue = s.queue.map((id) => catalog.tracks.get(id)).filter(Boolean);
	const upcoming = queue.slice(s.index + 1);
	const key = registerList(s.queue, s.context);
	const focusedCtl = sheet.contains(document.activeElement) ? document.activeElement.dataset.ctl : null;
	sheet.innerHTML = html`
		<div class="top">
			<button class="icon-btn" data-act="close-sheet" aria-label="Close now playing">${icon("down")}</button>
			<span class="ctx">${s.context ? html`Playing from ${s.context}` : ""}</span>
			<a class="icon-btn" href="${href(`album/${t.album.id}`)}" data-act="close-sheet" aria-label="Go to album">${icon("album")}</a>
		</div>
		<div class="body">
			<div class="stage">
				${cover(t.album)}
				<div class="info">
					<div style="min-width:0">
						<div class="title ${scriptClass(t.title)}">${t.title}</div>
						<div class="sub">${creditOf(t.artists, 3)}</div>
					</div>
					<button class="icon-btn" data-act="like" data-id="${t.id}" aria-pressed="${library.isLiked(t.id)}" aria-label="Like">${icon("heart")}</button>
				</div>
				<div class="seek">
					<input type="range" data-ctl="seek" min="0" step="1" aria-label="Seek">
					<div class="times"><span data-time="pos">0:00</span><span data-time="dur">${formatDuration(t.duration)}</span></div>
				</div>
				<div class="ctl">
					<button class="icon-btn" data-ctl="shuffle" aria-label="Shuffle" aria-pressed="${s.shuffle}">${icon("shuffle")}</button>
					<button class="icon-btn" data-ctl="prev" aria-label="Previous">${icon("prev")}</button>
					<button class="play-btn" data-ctl="toggle" aria-label="Play">${icon("play")}</button>
					<button class="icon-btn" data-ctl="next" aria-label="Next">${icon("next")}</button>
					<button class="icon-btn" data-ctl="repeat" aria-label="Repeat">${icon("repeat")}</button>
				</div>
				${s.error ? html`<p class="error" role="alert">${s.error}</p>` : ""}
			</div>
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
	if (focusedCtl) $(`[data-ctl=${focusedCtl}]`, sheet)?.focus();
}

function openSheet() {
	const sheet = $("#sheet");
	sheet.hidden = false;
	document.body.style.overflow = "hidden";
	renderSheet();
	$("[data-act=close-sheet]", sheet)?.focus();
}
function closeSheet() {
	const sheet = $("#sheet");
	if (sheet.hidden) return;
	sheet.hidden = true;
	document.body.style.overflow = "";
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
		if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
		if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
		if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeMenu(true); }
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

function trackMenu(anchor, track, extra) {
	const items = [
		{ label: "Play next", run: () => { player.playNext([track.id]); notify(`“${track.title}” plays next`); } },
		{ label: "Add to queue", run: () => { player.addToQueue([track.id]); notify("Added to queue"); } },
		{ label: "Add to playlist…", run: () => addToPlaylistMenu(anchor, [track.id]) },
		offline.has(track.id)
			? { label: "Remove download", run: () => offline.remove([track.id]) }
			: { label: "Download", run: () => startDownload([track]) },
		"-",
		{ label: "Go to album", run: () => { closeSheet(); go(`album/${track.album.id}`); } },
		...track.artists.slice(0, 2).map((a) => ({ label: `Go to ${a.name}`, run: () => { closeSheet(); go(`artist/${a.id}`); } })),
	];
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

/* =================================================================== events */
const listTracks = (key) => (getList(key)?.ids ?? []).map((id) => catalog.tracks.get(id)).filter(Boolean);

const actions = {
	async play(el) {
		const { ids, context } = getList(el.dataset.list);
		const id = Number(el.dataset.id);
		if (el.closest("[data-extra=queue]")) return player.jump(Number(el.closest(".track").dataset.index));
		if (player.current()?.id === id && player.state.queue.join() === ids.join()) return player.toggle();
		await player.playList(ids, id, context);
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
		const liked = await library.toggleLike(Number(el.dataset.id));
		el.setAttribute("aria-pressed", String(liked));
		el.setAttribute("aria-label", liked ? "Unlike" : "Like");
	},
	menu(el) {
		const track = catalog.tracks.get(Number(el.dataset.id));
		trackMenu(el, track, el.closest(".track")?.dataset.extra);
	},
	"list-menu"(el) {
		const { ids } = getList(el.dataset.list);
		openMenu(el, [
			{ label: "Play next", run: () => { player.playNext(ids); notify("These songs play next"); } },
			{ label: "Add to queue", run: () => { player.addToQueue(ids); notify(`Added ${ids.length} songs to queue`); } },
			{ label: "Add to playlist…", run: () => addToPlaylistMenu(el, ids) },
		]);
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
	if (!e.target.closest(".menu")) closeMenu();
	const ctl = e.target.closest("[data-ctl]");
	if (ctl && ctl.tagName === "BUTTON") {
		const c = ctl.dataset.ctl;
		if (c === "toggle") player.toggle();
		else if (c === "next") player.next();
		else if (c === "prev") player.previous();
		else if (c === "shuffle") player.setShuffle(!player.state.shuffle);
		else if (c === "repeat") player.cycleRepeat();
		return;
	}
	const el = e.target.closest("[data-act]");
	if (!el || el.tagName === "FORM" || el.tagName === "SELECT" || el.tagName === "INPUT") return;
	const fn = actions[el.dataset.act];
	if (!fn) return;
	if (el.tagName !== "A") e.preventDefault();
	try { await fn(el); } catch (err) { console.error(err); notify(err.message, { kind: "error" }); }
});

document.addEventListener("change", async (e) => {
	const el = e.target;
	if (el.dataset.act === "sort") {
		go(currentRoute.path, { sort: el.value });
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

let searchTimer = 0;
document.addEventListener("input", (e) => {
	const el = e.target;
	if (el.id === "q") {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			resetLists();
			resetPending();
			$("#results").innerHTML = V.searchResults(catalog, el.value);
			history.replaceState(null, "", href("search", el.value ? { q: el.value } : undefined));
			markPlaying();
		}, 140);
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
document.addEventListener("submit", (e) => {
	if (e.target.dataset.act === "search-form") { e.preventDefault(); $("#q")?.blur(); }
});

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		if ($(".menu")) closeMenu(true);
		else if (!$("#sheet").hidden) closeSheet();
		return;
	}
	const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
	if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
	if (e.key === " " && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); player.toggle(); }
	else if (e.key === "/") { e.preventDefault(); go("search"); }
});

/* =================================================================== notices */
on("notice", ({ message, kind, action }) => {
	const box = $("#toasts");
	const el = document.createElement("div");
	el.className = `toast toast-in ${kind === "error" ? "error" : ""}`;
	el.setAttribute("role", kind === "error" ? "alert" : "status");
	el.innerHTML = html`<span>${message}</span>${action ? html`<button>${action.label}</button>` : ""}`;
	if (action) $("button", el).addEventListener("click", () => { action.run(); el.remove(); });
	box.append(el);
	while (box.children.length > 3) box.firstChild.remove();
	setTimeout(() => el.remove(), action ? 12000 : kind === "error" ? 7000 : 3200);
});

/* =================================================================== live updates */
function refreshDownloadMarks() {
	for (const row of $$(".track[data-track]")) {
		const id = Number(row.dataset.track);
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
	if (currentRoute?.path === "library/downloads") {
		clearTimeout(downloadsRerender);
		downloadsRerender = setTimeout(rerender, 400);
	}
});
on("player", () => { renderBar(); markPlaying(); });
on("time", renderTime);
on("library", () => {
	const t = player.current();
	if (t) $("#bar-like").setAttribute("aria-pressed", String(library.isLiked(t.id)));
	for (const b of $$("[data-act=like]")) b.setAttribute("aria-pressed", String(library.isLiked(Number(b.dataset.id))));
	if (/^(library\/(liked|playlists)|library$|playlist\/)/.test(currentRoute?.path ?? "")) rerender();
});

function setOnline() {
	document.body.classList.toggle("is-offline", !navigator.onLine);
	$("#offline-pill").hidden = navigator.onLine;
}
addEventListener("online", () => { setOnline(); notify("Back online"); });
addEventListener("offline", () => { setOnline(); notify("You're offline. Downloaded songs still play."); });

/* =================================================================== boot */
function fatal(err) {
	console.error(err);
	const known = err instanceof CatalogLoadError;
	document.body.innerHTML = html`<div class="fatal" role="alert">
		<h1>Zaideih couldn't start</h1>
		<p>${known ? err.message : `Unexpected error: ${err.message}`}</p>
		<p><button class="btn primary" id="retry">Try again</button></p>
	</div>`;
	$("#retry").addEventListener("click", () => location.reload());
}

/**
 * Starts the app inside a platform shell.
 *
 * @param {object} platform
 * @param {"web"|"desktop"} platform.name
 * @param {string} platform.catalogBase   URL prefix of meta.json and the catalog file
 * @param {() => void} [platform.onReady] called once the first view has rendered
 */
export async function boot(platform) {
	if (!platform?.name || typeof platform.catalogBase !== "string") {
		throw new TypeError("boot() requires a platform with a name and catalogBase");
	}
	document.documentElement.dataset.platform = platform.name;
	for (const el of $$("[data-app-version]")) el.textContent = `v${APP_VERSION}`;
	setOnline();
	try {
		const [model] = await Promise.all([loadCatalog(platform.catalogBase), library.init(), offline.init()]);
		catalog = model;
	} catch (err) {
		fatal(err);
		return;
	}
	renderRail();
	$("#bar-now").addEventListener("click", openSheet);
	$("#bar-like").addEventListener("click", async () => {
		const t = player.current();
		if (t) await library.toggleLike(t.id);
	});
	await player.init(catalog);
	renderBar();
	addEventListener("hashchange", () => { closeMenu(); if (!$("#sheet").hidden) closeSheet(); render(); });
	await render();
	document.body.classList.add("ready");
	emit("ready");
	platform.onReady?.();
}
