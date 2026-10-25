/**
 * Lyrics in Now playing (docs/lyrics.md, "In Now playing"): a panel of the
 * player sheet, in place of the cover on phones and of the queue on wide
 * screens, turned on and off from the sheet's top bar (kept on the device).
 * Timed lyrics light the line being sung and scroll it into the panel's
 * middle; tapping a timed line goes there. The sheet is drawn again often
 * (every change of the player's state), so lyrics read once are kept here
 * and drawn at once, and the panel keeps its scroll.
 */
import { AUTH_URL } from "../config.js";
import { html } from "../core/html.js";
import { LYRICS_URL, readLyrics } from "../core/lyrics.js";
import { lineAt, parseLyrics } from "../core/lyrics-format.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { on } from "../core/store.js";
import { icon } from "./icons.js";
import { lyricsHtml } from "./lyrics-render.js";

const KEY = "zaideih.np.lyrics";
/** id -> { state: "loading" | "none" | "error" | "ok", parsed, error } */
const read = new Map();
let shown = (() => { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } })();
let lit = -2;
let held = 0;
let scroll = { id: null, top: 0 };

export const npLyrics = {
	get on() { return Boolean(LYRICS_URL) && shown; },
	toggle() {
		shown = !shown;
		try { localStorage.setItem(KEY, shown ? "on" : "off"); } catch { /* this visit only */ }
	},
};

/** The sheet's button, for its top bar. */
export function npLyricsButton() {
	if (!LYRICS_URL) return "";
	return html`<button class="icon-btn" data-act="np-lyrics" aria-pressed="${String(npLyrics.on)}" aria-label="${npLyrics.on ? "Hide lyrics" : "Show lyrics"}" title="${npLyrics.on ? "Hide lyrics" : "Show lyrics"}">${icon("lyrics")}</button>`;
}

/** The panel for song `t` (uploads have no lyrics). */
export function npLyricsPanel(t) {
	if (!npLyrics.on || !t) return "";
	const r = read.get(t.id);
	const page = href(`lyrics/${t.id}`);
	let body;
	if (t.upload) body = html`<p class="muted">Your uploads have no lyrics.</p>`;
	else if (!r || r.state === "loading") body = html`<p class="muted" aria-busy="true">Reading the lyrics…</p>`;
	else if (r.state === "error") body = html`<p class="muted">${r.error}</p>`;
	else if (r.state === "none") body = html`<p class="muted">No lyrics yet.${AUTH_URL && account().signedIn ? html` <a class="text-link" href="${href(`lyrics/${t.id}/studio`)}" data-act="close-sheet">Add them</a>` : ""}</p>`;
	else body = lyricsHtml(r.parsed);
	return html`<section class="np-lyrics${r?.parsed?.timed ? " np-timed" : ""}" aria-label="Lyrics">
		${body}
		${r?.state === "ok" ? html`<p class="np-lyrics-foot"><a class="text-link" href="${page}" data-act="close-sheet">Open the lyrics page</a></p>` : ""}
	</section>`;
}

const RETRY_MS = 5000;

/**
 * After the sheet is drawn: reads the song's lyrics when not read yet (and
 * draws the sheet again, `redraw`), keeps the panel's scroll, and lights the
 * line being sung at once.
 */
export function npLyricsMounted(sheet, t, redraw) {
	const panel = sheet.querySelector(".np-lyrics");
	if (!panel || !t || t.upload) return;
	// A failed read is tried again when the sheet is next drawn online, not before RETRY_MS.
	const before = read.get(t.id);
	if (!before || (before.state === "error" && navigator.onLine && Date.now() - before.at > RETRY_MS)) {
		read.set(t.id, { state: "loading" });
		readLyrics(t.id).then(({ lyrics }) => {
			read.set(t.id, lyrics ? { state: "ok", parsed: parseLyrics(lyrics.text) } : { state: "none" });
		}, (err) => read.set(t.id, { state: "error", error: err.message, at: Date.now() })).finally(() => redraw());
		return;
	}
	if (scroll.id === t.id) panel.scrollTop = scroll.top;
	scroll = { id: t.id, top: panel.scrollTop };
	panel.addEventListener("scroll", () => { scroll.top = panel.scrollTop; }, { passive: true });
	for (const ev of ["touchstart", "wheel"]) panel.addEventListener(ev, () => { held = Date.now(); }, { passive: true });
	panel.addEventListener("click", (e) => {
		const line = e.target.closest(".ly-line[data-time]");
		const r = read.get(t.id);
		if (line && line.dataset.time !== "" && r?.parsed && player.current()?.id === t.id) player.seek(Number(line.dataset.time) - (r.parsed.meta.offset ?? 0));
	});
	lit = -2;
	follow(player.position);
}

/** Lyrics saved in the studio: read again next time they are shown. */
export const forgetNpLyrics = (id) => read.delete(id);

function follow(position) {
	const sheet = document.getElementById("sheet");
	const panel = sheet && !sheet.hidden ? sheet.querySelector(".np-lyrics.np-timed") : null;
	const t = player.current();
	const r = t && read.get(t.id);
	if (!panel || !r?.parsed?.timed) return;
	const n = lineAt(r.parsed, position);
	if (n === lit) return;
	lit = n;
	panel.querySelector(".ly-line.ly-now")?.classList.remove("ly-now");
	const line = panel.querySelector(`.ly-line[data-n="${n}"]`);
	if (!line) return;
	line.classList.add("ly-now");
	// Into the middle of the panel (not the page), unless the listener scrolled it in the last 4 seconds.
	if (Date.now() - held > 4000) panel.scrollTo({ top: line.offsetTop - panel.clientHeight / 2 + line.offsetHeight / 2, behavior: "smooth" });
}
on("time", ({ position }) => follow(position));
