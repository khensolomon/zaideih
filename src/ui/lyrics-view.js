/**
 * Lyrics of a song, to read (#/lyrics/<song id>, docs/lyrics.md). Writing,
 * timing and the Lyrics right's decisions are in the studio
 * (#/lyrics/<song id>/studio, ui/lyrics-studio.js).
 *
 * The lyrics are kept as typed and shown with their structure
 * (core/lyrics-format.js, ui/lyrics-render.js): parts, the chorus, details
 * and credits, notes, chords (when this device shows them, transposable)
 * and, for timed lyrics, the line being sung while this song plays. The
 * text size is this device's choice.
 */
import { AUTH_URL } from "../config.js";
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { LYRICS_URL, readLyrics, reportLyrics } from "../core/lyrics.js";
import { lineAt, parseLyrics, prefersFlats } from "../core/lyrics-format.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { on } from "../core/store.js";
import { icon } from "./icons.js";
import { chordsShown, creditsHtml, detailChips, lyricsHtml, showChords } from "./lyrics-render.js";
import { scriptClass } from "./parts.js";

const SIZE_KEY = "zaideih.lyrics.size";
const SIZES = [16, 18, 21, 25];
const sizeIndex = () => {
	try {
		const n = Number(localStorage.getItem(SIZE_KEY));
		return Number.isInteger(n) && n >= 0 && n < SIZES.length ? n : 1;
	} catch {
		return 1;
	}
};
const setSize = (n) => { try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* this visit only */ } };

let st = null;
const when = (seconds) => new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * @param {object} catalog
 * @param {number} id  the song
 * @param {object} ctx { notify, promptText, redrawn }
 */
export function lyricsView(catalog, id, ctx) {
	const track = catalog.track(id);
	if (!track || track.upload) return { title: "Lyrics", body: html`<div class="empty"><h2>No such song</h2><p>Lyrics are kept for songs in the catalog.</p></div>` };
	st = { id, track, lyrics: undefined, offline: false, error: "", transpose: 0, parsed: null, parsedOf: null, lit: -2 };
	return {
		title: `Lyrics: ${track.title}`,
		body: html`<div class="ly-root">${content()}</div>`,
		mount: (view) => mount(view.querySelector(".ly-root"), ctx),
	};
}

function parsed() {
	if (st.parsedOf !== st.lyrics.text) Object.assign(st, { parsed: parseLyrics(st.lyrics.text), parsedOf: st.lyrics.text });
	return st.parsed;
}

function header() {
	const t = st.track;
	return html`<div class="hero ly-hero" style="grid-template-columns:1fr"><div>
		<div class="kind">Lyrics</div>
		<h1 class="page-title ${scriptClass(t.title)}">${t.title}</h1>
		<div class="facts"><span>${creditOf(t.artists, 3)}</span><span><a class="text-link" href="${href(`album/${t.album.id}`)}">${t.album.title}</a></span></div>
		${st.lyrics ? creditsHtml(parsed()) : ""}
	</div></div>`;
}

function content() {
	if (!LYRICS_URL) return html`${header()}<p class="muted">Lyrics are not available in this version of the app.</p>`;
	if (st.lyrics === undefined && !st.error) return html`${header()}<p class="muted" aria-busy="true">Reading the lyrics…</p>`;
	const signedIn = AUTH_URL && account().signedIn;
	const l = st.lyrics;
	const studio = href(`lyrics/${st.id}/studio`);
	if (!l) {
		return html`${header()}
			${st.error ? html`<p class="error" role="alert">${st.error}</p>` : html`<div class="empty ly-empty"><h2>No lyrics yet</h2><p>${signedIn ? "Know the words? Add them for everyone." : "Nobody has added the lyrics of this song yet."}</p></div>`}
			${signedIn ? html`<p><a class="btn primary" href="${studio}">${icon("edit")} Add lyrics</a></p>` : AUTH_URL ? html`<p class="acct-small"><a class="text-link" href="#/account">Sign in</a> to add the lyrics.</p>` : ""}`;
	}
	const p = parsed();
	const chords = p.chords && chordsShown();
	const flats = prefersFlats(p);
	const size = sizeIndex();
	const following = p.timed && player.current()?.id === st.id;
	return html`${header()}
		${st.error ? html`<p class="error" role="alert">${st.error}</p>` : ""}
		<div class="ly-bar">
			${detailChips(p, { transpose: chords ? st.transpose : 0, flats })}
			<span class="ly-bar-end">
				${p.chords ? html`<button class="btn ly-small" data-ly="chords" aria-pressed="${String(chords)}">${chords ? "Hide chords" : "Show chords"}</button>` : ""}
				${chords ? html`<span class="ly-transpose" role="group" aria-label="Transpose">
					<button class="icon-btn" data-ly="down" aria-label="Down a semitone" title="Down a semitone">−</button>
					<span aria-live="polite">${st.transpose ? `${st.transpose > 0 ? "+" : ""}${st.transpose}` : "Key"}</span>
					<button class="icon-btn" data-ly="up" aria-label="Up a semitone" title="Up a semitone">+</button>
				</span>` : ""}
				<button class="icon-btn ly-size" data-ly="smaller" aria-label="Smaller text" title="Smaller text" ${size === 0 ? "disabled" : ""}>A−</button>
				<button class="icon-btn ly-size" data-ly="larger" aria-label="Larger text" title="Larger text" ${size === SIZES.length - 1 ? "disabled" : ""}>A+</button>
				${signedIn && !st.offline ? html`<a class="icon-btn" href="${studio}" aria-label="Edit in the lyrics studio" title="Edit in the lyrics studio">${icon("edit")}</a>` : ""}
			</span>
		</div>
		${p.timed ? html`<p class="acct-small ly-follow">${following ? "The line being sung is lit; tap a line to go there." : "Timed lyrics: play this song to follow along."}</p>` : ""}
		<div style="--ly-size:${SIZES[size]}px">${lyricsHtml(p, { chords, transpose: st.transpose, flats })}</div>
		<p class="acct-small">Version ${l.version}, ${when(l.updated)}${st.offline ? ", kept on this device (offline)" : ""}${signedIn && !st.offline ? html` · <button class="link-btn" data-ly="report">Report a problem</button>` : ""}.${!signedIn && AUTH_URL ? html` <a class="text-link" href="#/account">Sign in</a> to correct them.` : ""}</p>`;
}

function mount(root, ctx) {
	const mine = st;
	const draw = () => {
		if (st !== mine || !root.isConnected) return;
		root.innerHTML = content();
		st.lit = -2; // drawn again: the line being sung is lit again at the next tick
		ctx.redrawn?.();
	};
	(async () => {
		try {
			const { lyrics, offline } = await readLyrics(st.id);
			Object.assign(st, { lyrics, offline, error: "" });
		} catch (err) {
			Object.assign(st, { lyrics: null, error: err.message });
		}
		draw();
	})();

	root.addEventListener("click", async (e) => {
		// Timed lyrics: tapping a line of the song playing goes there.
		const timedLine = e.target.closest(".ly-timed .ly-line[data-time]");
		if (timedLine && timedLine.dataset.time !== "" && player.current()?.id === st.id) {
			player.seek(Number(timedLine.dataset.time) - (parsed().meta.offset ?? 0));
			return;
		}
		const b = e.target.closest("[data-ly]");
		if (!b || !root.contains(b)) return;
		const what = b.dataset.ly;
		if (what === "chords") {
			showChords(!chordsShown());
			draw();
		} else if (what === "up" || what === "down") {
			st.transpose = (((st.transpose + (what === "up" ? 1 : -1) + 17) % 12) - 5);
			draw();
		} else if (what === "smaller" || what === "larger") {
			setSize(Math.min(SIZES.length - 1, Math.max(0, sizeIndex() + (what === "larger" ? 1 : -1))));
			draw();
		} else if (what === "report") {
			const reason = await ctx.promptText("What is wrong with these lyrics? Those who look after lyrics will see it.", "", "Report");
			if (!reason) return;
			try {
				await reportLyrics(st.id, reason);
				ctx.notify("Thank you. Those who look after lyrics will have a look.");
			} catch (err) {
				ctx.notify(`The report could not be sent: ${err.message}`, { kind: "error" });
			}
		}
	});

	// Timed lyrics: the line being sung, lit and kept in view, while this song plays.
	let touched = 0;
	const held = () => { touched = Date.now(); };
	addEventListener("touchstart", held, { passive: true });
	addEventListener("wheel", held, { passive: true });
	const offTime = on("time", ({ position }) => {
		if (st !== mine || !root.isConnected) { offTime(); removeEventListener("touchstart", held); removeEventListener("wheel", held); return; }
		if (!st.lyrics || player.current()?.id !== st.id) return;
		const p = parsed();
		if (!p.timed) return;
		const n = lineAt(p, position);
		if (n === st.lit) return;
		st.lit = n;
		root.querySelector(".ly-line.ly-now")?.classList.remove("ly-now");
		const line = root.querySelector(`.ly-line[data-n="${n}"]`);
		if (!line) return;
		line.classList.add("ly-now");
		// Not while the listener is scrolling by hand.
		if (Date.now() - touched > 4000) line.scrollIntoView({ block: "center", behavior: "smooth" });
	});
	// The page's words for the timed lyrics change when this song starts or stops.
	const offPlayer = on("player", () => {
		if (st !== mine || !root.isConnected) { offPlayer(); return; }
		const follow = root.querySelector(".ly-follow");
		const want = player.current()?.id === st.id ? "The line being sung is lit; tap a line to go there." : "Timed lyrics: play this song to follow along.";
		if (follow && follow.textContent !== want) follow.textContent = want;
	});
}
