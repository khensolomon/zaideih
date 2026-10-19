/**
 * Search suggestions (ARIA combobox on #q).
 *
 * Typing shows quick picks (artists, albums, songs), a "did you mean"
 * correction when nothing matches, and a "Show all results" row. Focusing the
 * empty box shows recent searches. Arrow keys move, Enter picks, Escape
 * closes. Recent searches are a per-device convenience kept in localStorage.
 */
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { correction, suggestions } from "../core/search.js";
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

export function rememberSearch(query) {
	const q = query.trim();
	if (q.length < 2) return;
	const lower = q.toLowerCase();
	writeRecent([q, ...readRecent().filter((s) => s.toLowerCase() !== lower)].slice(0, RECENT_MAX));
}

let options = [];
let active = -1;

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
		return html`<li class="sg" ${base}>${cover(opt.item, { label: false })}<span class="sg-text"><span class="sg-title ${scriptClass(opt.item.title)}">${opt.item.title}</span><span class="sg-sub">Album, ${creditOf(opt.item.artists, 1)}</span></span></li>`;
	}
	if (opt.kind === "track") {
		return html`<li class="sg" ${base}>${cover(opt.item.album, { label: false })}<span class="sg-text"><span class="sg-title ${scriptClass(opt.item.title)}">${opt.item.title}</span><span class="sg-sub">Song, ${creditOf(opt.item.artists, 1)}</span></span><span class="sg-hint">Play</span></li>`;
	}
	const icon = opt.kind === "recent" ? "↺" : opt.kind === "fix" ? "?" : "⌕";
	return html`<li class="sg sg-plain" ${base}><span class="sg-glyph" aria-hidden="true">${icon}</span><span class="sg-text"><span class="sg-title ${scriptClass(opt.label)}">${opt.label}</span></span></li>`;
}

function paint(input) {
	const ul = listEl();
	if (!ul) return;
	const visible = options.some((o) => o.kind !== "heading");
	ul.hidden = !visible;
	input.setAttribute("aria-expanded", String(visible));
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
		const picks = suggestions(catalog, q);
		options = picks.length ? picks : [];
		if (!picks.length) {
			const fix = correction(catalog, q);
			if (fix) options.push({ kind: "fix", label: `Did you mean “${fix}”?`, query: fix });
		}
		options.push({ kind: "all", label: `Show all results for “${q}”`, query: q });
	}
	paint(input);
}

export function closeSuggestions(input) {
	options = [];
	active = -1;
	const ul = listEl();
	if (ul) { ul.hidden = true; ul.innerHTML = ""; }
	input?.setAttribute("aria-expanded", "false");
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

