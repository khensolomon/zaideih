/**
 * Search suggestions (ARIA combobox on #q).
 *
 * Typing shows quick picks (up to 3 artists, 3 albums and 5 songs, or more
 * of one kind when a scope chip is on). A question ("most played mizo
 * artists") is answered first, with its top results. A plainly named artist
 * gets shortcuts to their albums and songs. When little matches, the
 * closest spellings follow under "Close matches", led by a "Did you mean"
 * row when nothing matches exactly. A "Show all results" row ends the list. Focusing the
 * empty box shows recent searches. Arrow keys move, Enter picks, Escape
 * closes. Recent searches are a per-device convenience kept in localStorage.
 */
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { answer, describe, parseIntent } from "../core/intent.js";
import { didYouMean, namedArtist, SCOPES, suggestions } from "../core/search.js";
import { avatar, cover, scriptClass } from "./parts.js";

const RECENT_KEY = "zaideih.recent-searches";
const RECENT_MAX = 8;

function readRecent() {
	try {
		const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
		return Array.isArray(list) ? list.filter((s) => typeof s === "string" && s.trim()) : [];
	} catch {
		return [];
	}
}

function writeRecent(list) {
	try {
		if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list));
		else localStorage.removeItem(RECENT_KEY);
	} catch { /* not remembered on this device */ }
}

/** The searches kept on this device, newest first. */
export const recentSearches = () => readRecent();

/** Forgets every kept search. */
export function forgetSearches() { writeRecent([]); }

/** Forgets one kept search. */
export function forgetSearch(query) {
	writeRecent(readRecent().filter((s) => s !== query));
}

export function rememberSearch(query) {
	const q = query.trim();
	if (q.length < 2) return;
	const lower = q.toLowerCase();
	writeRecent([q, ...readRecent().filter((s) => s.toLowerCase() !== lower)].slice(0, RECENT_MAX));
}

let options = [];
let active = -1;
let scope = "all";
let langName = (l) => l.name;

/** The scope chips' current choice: "all", "artists", "albums", "tracks" or "lyrics". */
export const getScope = () => scope;
export function setScope(value) { scope = SCOPES.includes(value) ? value : "all"; }
/** Labels languages in answer titles ("Mizo" rather than "mizo"). */
export function setLangName(fn) { langName = fn; }

function listEl() { return document.getElementById("suggest"); }

function optionRow(opt, i) {
	const id = `sg-${i}`;
	const sel = i === active;
	const base = html`role="option" id="${id}" data-sg="${i}" aria-selected="${String(sel)}"`;
	if (opt.kind === "heading") return html`<li class="sg-head" role="presentation">${opt.label}${opt.clear ? html`<button class="link-btn" data-sg-clear tabindex="-1">Clear</button>` : ""}</li>`;
	if (opt.kind === "artist") {
		return html`<li class="sg" ${base}>${avatar(opt.item)}<span class="sg-text"><span class="sg-title ${scriptClass(opt.item.name)}">${opt.item.name}</span><span class="sg-sub">Artist</span></span></li>`;
	}
	if (opt.kind === "album") {
		const by = opt.via ? opt.via.name : creditOf(opt.item.artists, 1);
		return html`<li class="sg" ${base}>${cover(opt.item, { label: false })}<span class="sg-text"><span class="sg-title ${scriptClass(opt.item.title)}">${opt.item.title}</span><span class="sg-sub">Album by ${by}${opt.item.year ? html`, ${opt.item.year}` : ""}</span></span></li>`;
	}
	if (opt.kind === "track") {
		const by = opt.via ? opt.via.name : creditOf(opt.item.artists, 1);
		return html`<li class="sg" ${base}>${cover(opt.item.album, { label: false })}<span class="sg-text"><span class="sg-title ${scriptClass(opt.item.title)}">${opt.item.title}</span><span class="sg-sub">Song by ${by}</span></span><span class="sg-hint">Play</span></li>`;
	}
	if (opt.kind === "answer") {
		return html`<li class="sg sg-answer" ${base}><span class="sg-glyph" aria-hidden="true">✦</span><span class="sg-text"><span class="sg-title">${opt.label}</span><span class="sg-sub">${opt.sub}</span></span><span class="sg-hint">See all</span></li>`;
	}
	const icon = opt.kind === "recent" ? "↺" : opt.kind === "fix" ? "?" : opt.kind === "query" ? "→" : "⌕";
	return html`<li class="sg sg-plain" ${base}><span class="sg-glyph" aria-hidden="true">${icon}</span><span class="sg-text"><span class="sg-title ${scriptClass(opt.label)}">${opt.label}</span></span></li>`;
}

/*
 * While the suggestions are open on a touch screen, the page behind them
 * stays still. With the keyboard up, iPhone otherwise pans the whole page
 * under it, and the fixed search field is put back (--vvt, app.js) only
 * once Safari reports the pan, often late: the field slid away. The list
 * itself still scrolls, and stops at its ends instead of moving the page.
 */
let holding = false;
let lastY = 0;
const onTouchStart = (e) => { lastY = e.touches[0]?.clientY ?? 0; };
function onTouchMove(e) {
	const y = e.touches[0]?.clientY ?? lastY;
	const pull = y - lastY; // > 0: the finger moves down, the list towards its top
	lastY = y;
	const list = e.target instanceof Element ? e.target.closest(".suggest") : null;
	if (list && list.scrollHeight > list.clientHeight + 1) {
		const atTop = list.scrollTop <= 0;
		const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
		if (!((pull > 0 && atTop) || (pull < 0 && atEnd))) return;
	}
	if (e.cancelable) e.preventDefault();
}
function holdPage(on) {
	if (on === holding) return;
	holding = on;
	if (on) {
		document.addEventListener("touchstart", onTouchStart, { passive: true });
		document.addEventListener("touchmove", onTouchMove, { passive: false });
	} else {
		document.removeEventListener("touchstart", onTouchStart);
		document.removeEventListener("touchmove", onTouchMove);
	}
}

function paint(input) {
	const ul = listEl();
	if (!ul) return;
	const visible = options.some((o) => o.kind !== "heading");
	ul.hidden = !visible;
	const panel = document.getElementById("sg-panel");
	if (panel) {
		panel.hidden = !visible;
		for (const chip of panel.querySelectorAll("[data-scope]")) chip.setAttribute("aria-pressed", String(chip.dataset.scope === scope));
	}
	input.setAttribute("aria-expanded", String(visible));
	input.closest(".searchbox")?.classList.toggle("open", visible);
	document.body.classList.toggle("search-open", visible);
	holdPage(visible);
	ul.innerHTML = html`${options.map(optionRow)}`;
	if (active >= 0) input.setAttribute("aria-activedescendant", `sg-${active}`);
	else input.removeAttribute("aria-activedescendant");
	ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

/** Rebuilds the suggestions for the current input value. */
export function updateSuggestions(catalog, input) {
	const q = input.value.trim();
	active = -1;
	if (!q) {
		const recent = readRecent();
		options = recent.length
			? [{ kind: "heading", label: "Recent searches", clear: true }, ...recent.map((r) => ({ kind: "recent", label: r, query: r }))]
			: [];
	} else {
		options = [];
		const seen = new Set();
		const intent = parseIntent(catalog, q);
		if (intent) {
			const a = answer(catalog, intent, 4);
			if (a.total) {
				options.push({ kind: "answer", label: describe(intent, langName), sub: `${a.total.toLocaleString()} ${a.total === 1 ? "result" : "results"}`, query: q });
				const kind = { artists: "artist", albums: "album", tracks: "track" }[intent.kind];
				for (const item of a.items) { seen.add(item); options.push({ kind, item }); }
			}
		}
		const picks = suggestions(catalog, q, scope).filter((p) => !seen.has(p.item));
		const exact = picks.filter((p) => !p.near);
		const near = picks.filter((p) => p.near);
		if (exact.length && options.length) options.push({ kind: "heading", label: "Matches" });
		options.push(...exact);
		// A plainly named artist: offer what people usually want next.
		const artist = scope === "all" && !intent ? namedArtist(catalog, q) : null;
		if (artist && artist.albums.length > 1) options.push({ kind: "query", label: `Albums by ${artist.name}`, query: `albums by ${artist.name}` });
		if (artist && artist.tracks.length > 1) options.push({ kind: "query", label: `Most played songs by ${artist.name}`, query: `songs by ${artist.name}` });
		if (!exact.length && !options.length) {
			const fix = didYouMean(catalog, q);
			if (fix) options.push({ kind: "fix", label: `Did you mean “${fix}”?`, query: fix });
		}
		if (near.length && !intent) options.push({ kind: "heading", label: "Close matches" }, ...near);
		if (!options.length) options.push({ kind: "heading", label: `Nothing close to “${q}”` });
		options.push({ kind: "all", label: `Show all results for “${q}”`, query: q });
	}
	paint(input);
}

export function closeSuggestions(input) {
	options = [];
	active = -1;
	const ul = listEl();
	if (ul) { ul.hidden = true; ul.innerHTML = ""; }
	const panel = document.getElementById("sg-panel");
	if (panel) panel.hidden = true;
	input?.setAttribute("aria-expanded", "false");
	input?.closest(".searchbox")?.classList.remove("open");
	document.body.classList.remove("search-open");
	holdPage(false);
	input?.removeAttribute("aria-activedescendant");
}

/** Arrow-key movement; returns true when the key was handled. */
export function moveSelection(input, key) {
	const selectable = options.map((o, i) => (o.kind === "heading" ? -1 : i)).filter((i) => i >= 0);
	if (!selectable.length) return false;
	const pos = selectable.indexOf(active);
	if (key === "ArrowDown") active = selectable[pos < 0 ? 0 : Math.min(selectable.length - 1, pos + 1)];
	else if (key === "ArrowUp") active = pos <= 0 ? -1 : selectable[pos - 1];
	else return false;
	paint(input);
	return true;
}

/** The highlighted option, or the one at `index` (mouse), or null. */
export function pickOption(index = active) {
	return index >= 0 ? options[index] ?? null : null;
}

export function clearRecent(catalog, input) {
	writeRecent([]);
	updateSuggestions(catalog, input);
}

