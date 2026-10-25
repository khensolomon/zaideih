/**
 * Lyrics of a song, to read (#/lyrics/<song id>, docs/lyrics.md). Writing,
 * timing and the Lyrics right's decisions are in the studio
 * (#/lyrics/<song id>/studio, ui/lyrics-studio.js).
 *
 * The lyrics are kept as typed and shown with their structure
 * (core/lyrics-format.js, ui/lyrics-render.js): parts, the chorus, details
 * and credits, notes, chords (when this device shows them, transposable)
 * and, for timed lyrics, the line being sung while this song plays. The
 * text size is this device's choice. Play starts this song (in its album),
 * so the lyrics can be followed without finding the song first.
 *
 * A song with translations offers them (Original, English, Myanmar); a
 * translation can be read alone or side by side with the original, part
 * beside part (kept as this device's choice).
 *
 * Shared lyrics (ui/lyrics-share.js): a song without lyrics offers the same
 * song on other albums, to read; signed in, a member proposes that it is the
 * same song, and the Lyrics right uses its lyrics. A shared text names the
 * other recordings it is shown on.
 */
import { AUTH_URL } from "../config.js";
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { linkLyrics, LYRICS_URL, proposeSameSong, readLyrics, reportLyrics } from "../core/lyrics.js";
import { lineAt, parseLyrics, prefersFlats } from "../core/lyrics-format.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { on } from "../core/store.js";
import { focusKey, refocus } from "./focus.js";
import { icon } from "./icons.js";
import { chordsShown, creditsHtml, detailChips, lyricsHtml, showChords, sideBySideHtml } from "./lyrics-render.js";
import { LYRICS_LANGS, lyricsIndex } from "../core/lyrics-index.js";
import { artistLinks, cover, scriptClass } from "./parts.js";
import { sharedWithHtml, suggestionsHtml, wireFind } from "./lyrics-share.js";
import { hymnHref, hymnOf } from "../core/songbooks.js";

/** A recording joined to a songbook text (docs/songbooks.md): where its words are printed. */
function hymnLink(source) {
	const h = hymnOf(source);
	return h ? html`<span class="ly-hymn">${icon("lyrics")} Words from <a class="text-link" href="${hymnHref(h)}">${h.book.title} ${h.number}</a>. </span>` : "";
}

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
const SIDE_KEY = "zaideih.lyrics.side";
const sideShown = () => { try { return localStorage.getItem(SIDE_KEY) !== "off"; } catch { return true; } };
const setSide = (on) => { try { localStorage.setItem(SIDE_KEY, on ? "on" : "off"); } catch { /* this visit only */ } };

let st = null;
const when = (seconds) => new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * @param {object} catalog
 * @param {number} id  the song
 * @param {object} ctx { notify, promptText, redrawn }
 */
export function lyricsView(catalog, id, ctx, lang = "") {
	const track = catalog.track(id);
	if (!(lang in LYRICS_LANGS)) lang = "";
	if (!track || track.upload) return { title: "Lyrics", body: html`<div class="empty"><h2>No such song</h2><p>Lyrics are kept for songs in the catalog.</p></div>` };
	st = { catalog, id, track, lang, heard: player.current()?.id === id, lyrics: undefined, original: null, offline: false, error: "", transpose: 0, parsed: null, parsedOf: null, lit: -2 };
	return {
		title: `Lyrics: ${track.title}${lang ? ` (${LYRICS_LANGS[lang]})` : ""}`,
		body: html`<div class="ly-root">${content()}</div>`,
		mount: (view) => mount(view.querySelector(".ly-root"), ctx),
	};
}

function parsed() {
	if (st.parsedOf !== st.lyrics.text) Object.assign(st, { parsed: parseLyrics(st.lyrics.text), parsedOf: st.lyrics.text });
	return st.parsed;
}

/** The languages to choose from: the original, and the translations the index knows of. */
function langSwitch() {
	const langs = new Set(["", ...lyricsIndex.langs(st.id), st.lang]);
	if (langs.size < 2) return "";
	const list = Object.keys(LYRICS_LANGS).filter((l) => langs.has(l));
	return html`<div class="ly-langs">
		<div class="segmented" role="group" aria-label="Lyrics in">
			${list.map((l) => html`<button data-ly="lang" data-lang="${l}" aria-pressed="${String(l === st.lang)}">${LYRICS_LANGS[l]}</button>`)}
		</div>
		${st.lang ? html`<button class="btn ly-small" data-ly="side" aria-pressed="${String(sideShown())}">${sideShown() ? "Translation only" : "Beside the original"}</button>` : ""}
	</div>`;
}

/**
 * Play, as an icon on the line under the title: this song (from it on, in its
 * album), or pause and resume when it is the one playing. Beside it, whether
 * it is: bars moving while it plays, "Paused" while it waits.
 */
function playButton() {
	const now = player.current()?.id === st.id;
	const playing = now && player.state.playing;
	const label = playing ? "Pause" : now ? "Resume" : "Play this song";
	return html`<span class="ly-play-wrap" data-state="${playing ? "playing" : now ? "paused" : "other"}">
		<button class="play-btn ly-play" data-ly="play" data-page-play="${st.track.title}" aria-label="${label}" title="${label}">${icon(playing ? "pause" : "play")}</button>
		${now ? html`<span class="ly-state" aria-live="polite">${playing ? html`<i class="eq" aria-hidden="true"><i></i><i></i><i></i></i>Playing` : "Paused"}</span>` : ""}
	</span>`;
}

function header() {
	const t = st.track;
	return html`<div class="hero ly-hero">
		<a class="ly-cover" href="${href(`album/${t.album.id}`)}" aria-label="Album: ${t.album.title}" title="${t.album.title}">${cover(t.album, { label: false })}</a>
		<div class="ly-hero-text">
			<div class="kind">Lyrics</div>
			<h1 class="page-title ${scriptClass(t.title)}">${t.title}</h1>
			<div class="facts">${playButton()}<span class="ly-artists">${artistLinks(t.artists.slice(0, 3))}</span><span><a class="text-link" href="${href(`album/${t.album.id}`)}">${t.album.title}</a></span></div>
			${st.lyrics ? creditsHtml(parsed()) : ""}
		</div>
	</div>`;
}

/**
 * After this song, while the page is still open: what plays now, with the
 * way to its lyrics.
 */
function nextNotice() {
	const t = player.current();
	if (!st.heard || !t || t.id === st.id || t.upload) return html`<div class="ly-next" hidden></div>`;
	const has = lyricsIndex.has(t.id);
	return html`<div class="ly-next" role="status"><span>Now playing <b class="${scriptClass(t.title)}">${t.title}</b></span><a class="btn ly-small" href="${href(`lyrics/${t.id}`)}">${has ? "Its lyrics" : "Its page"}</a></div>`;
}

/**
 * The same song elsewhere (ui/lyrics-share.js), by who is looking: the
 * Lyrics right uses lyrics (or, when this song has its own, compares in the
 * studio); a member proposes; a listener only reads.
 */
function sameOpts(ctx) {
	const signedIn = Boolean(AUTH_URL && account().signedIn);
	const mod = signedIn && ctx.canModerate?.();
	const own = Boolean(st.lyrics);
	const group = st.lyrics?.shared ? [st.lyrics.shared.source, ...st.lyrics.shared.with] : [];
	return {
		act: mod ? (own ? "compare" : "link") : signedIn ? "propose" : null,
		attr: "data-ly",
		canFind: signedIn,
		exclude: group,
		title: own ? "Same song as another?" : undefined,
	};
}

function content() {
	if (!LYRICS_URL) return html`${header()}<p class="muted">Lyrics are not available in this version of the app.</p>`;
	if (st.lyrics === undefined && !st.error) return html`${header()}<p class="muted" aria-busy="true">Reading the lyrics…</p>`;
	const signedIn = AUTH_URL && account().signedIn;
	const l = st.lyrics;
	const studio = href(`lyrics/${st.id}/studio`, st.lang ? { lang: st.lang } : undefined);
	if (!l) {
		return html`${header()}${nextNotice()}${langSwitch()}
			${st.error ? html`<p class="error" role="alert">${st.error}</p>` : html`<div class="empty ly-empty"><h2>No lyrics yet</h2><p>${signedIn ? "Know the words? Add them for everyone." : "Nobody has added the lyrics of this song yet."}</p></div>`}
			${signedIn ? html`<p><a class="btn primary" href="${studio}">${icon("edit")} Add lyrics</a></p>` : AUTH_URL ? html`<p class="acct-small"><a class="text-link" href="#/account">Sign in</a> to add the lyrics.</p>` : ""}
			${st.lang || st.error ? "" : suggestionsHtml(st.catalog, st.track, sameOpts(st.ctx))}`;
	}
	const p = parsed();
	const chords = p.chords && chordsShown();
	const flats = prefersFlats(p);
	const size = sizeIndex();
	const following = p.timed && player.current()?.id === st.id;
	return html`${header()}${nextNotice()}
		${st.error ? html`<p class="error" role="alert">${st.error}</p>` : ""}
		${langSwitch()}
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
				<button class="icon-btn" data-act="share" data-share="lyrics/${st.id}${st.lang ? `?lang=${st.lang}` : ""}" data-share-title="${st.track.title}" aria-label="Share these lyrics" title="Share these lyrics">${icon("share")}</button>
				${signedIn && !st.offline ? html`<a class="icon-btn" href="${studio}" aria-label="Edit in the lyrics studio" title="Edit in the lyrics studio">${icon("edit")}</a>` : ""}
			</span>
		</div>
		${p.timed ? html`<p class="acct-small ly-follow">${following ? "The line being sung is lit; tap a line to go there." : "Timed lyrics: play this song to follow along."}</p>` : ""}
		<div style="--ly-size:${SIZES[size]}px">${st.lang && sideShown() && st.original ? sideBySideHtml(st.original, p, { chords, transpose: st.transpose, flats }) : lyricsHtml(p, { chords, transpose: st.transpose, flats })}</div>
		${l.shared ? html`<p class="acct-small">${hymnLink(l.shared.source)}${sharedWithHtml(st.catalog, l.shared)}${l.shared.with.some((t) => st.catalog.track(t)) || hymnOf(l.shared.source) ? "." : ""}</p>` : ""}
		<p class="acct-small">Version ${l.version}, ${when(l.updated)}${st.offline ? ", kept on this device (offline)" : ""}${signedIn && !st.offline ? html` · <button class="link-btn" data-ly="report">Report a problem</button>` : ""}${signedIn && !st.offline && !st.lang ? html` · <button class="link-btn" data-ly="same" aria-expanded="${String(Boolean(st.findOpen))}">Same song as another?</button>` : ""}.${!signedIn && AUTH_URL ? html` <a class="text-link" href="#/account">Sign in</a> to correct them.` : ""}</p>
		${st.findOpen && !st.lang ? suggestionsHtml(st.catalog, st.track, sameOpts(st.ctx)) : ""}`;
}

function mount(root, ctx) {
	const mine = st;
	// Finding the same song to use its lyrics (a song without lyrics): results as the person types.
	st.ctx = ctx;
	wireFind(root, st.catalog, st.track, () => sameOpts(ctx));
	const draw = () => {
		if (st !== mine || !root.isConnected) return;
		const focused = focusKey(root);
		root.innerHTML = content();
		refocus(root, focused);
		st.lit = -2; // drawn again: the line being sung is lit again at the next tick
		ctx.redrawn?.();
	};
	(async () => {
		try {
			const [{ lyrics, offline }, original] = await Promise.all([
				readLyrics(st.id, st.lang),
				// A translation is shown beside the song's own words.
				st.lang ? readLyrics(st.id).catch(() => ({ lyrics: null })) : null,
			]);
			// Written to this page's state: another page may be showing by the time they arrive.
			Object.assign(mine, { lyrics, offline, error: "", original: original?.lyrics ? parseLyrics(original.lyrics.text) : null });
		} catch (err) {
			Object.assign(mine, { lyrics: null, error: err.message });
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
		if (what === "play") {
			if (player.current()?.id === st.id) player.toggle();
			else await ctx.playSong(st.track);
		} else if (what === "chords") {
			showChords(!chordsShown());
			draw();
		} else if (what === "up" || what === "down") {
			st.transpose = (((st.transpose + (what === "up" ? 1 : -1) + 17) % 12) - 5);
			draw();
		} else if (what === "lang") {
			location.hash = href(`lyrics/${st.id}`, b.dataset.lang ? { lang: b.dataset.lang } : undefined);
		} else if (what === "side") {
			setSide(!sideShown());
			draw();
		} else if (what === "smaller" || what === "larger") {
			setSize(Math.min(SIZES.length - 1, Math.max(0, sizeIndex() + (what === "larger" ? 1 : -1))));
			draw();
		} else if (what === "same") {
			st.findOpen = !st.findOpen;
			draw();
			if (st.findOpen) root.querySelector(".ly-same")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		} else if (what === "propose") {
			const other = st.catalog.track(Number(b.dataset.to));
			if (!other) return;
			if (!(await ctx.confirmAction(`“${st.track.title}” is the same song as “${other.title}” (${other.album.title})? Those who look after lyrics will check and link them.`, "Send"))) return;
			try {
				await proposeSameSong(st.id, other.id);
				ctx.notify("Thank you: sent to those who look after lyrics");
			} catch (err) {
				ctx.notify(`It could not be sent: ${err.message}`, { kind: "error" });
			}
		} else if (what === "compare") {
			location.hash = href(`lyrics/${st.id}/studio`, { merge: b.dataset.to });
		} else if (what === "link") {
			const from = st.catalog.track(Number(b.dataset.to));
			if (!from) return;
			if (!(await ctx.confirmAction(`Show the lyrics of “${from.title}” from ${from.album.title} on this song too? Both will show one text; only those who look after lyrics can undo it.`, "Use these lyrics"))) return;
			try {
				st.lyrics = await linkLyrics(st.id, from.id);
				st.parsedOf = null;
				ctx.notify("Linked: this song now shows those lyrics");
				lyricsIndex.refresh({ force: true }).catch(() => {});
			} catch (err) {
				ctx.notify(`They could not be linked: ${err.message}`, { kind: "error" });
			}
			draw();
		} else if (what === "report") {
			const reason = await ctx.promptText("What is wrong with these lyrics? Those who look after lyrics will see it.", "", "Report");
			if (!reason) return;
			try {
				await reportLyrics(st.id, reason, st.lang);
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
	// The translations offered come with the lyrics index, often after the page is drawn.
	const offIndex = on("lyrics-index", () => {
		if (st !== mine || !root.isConnected) { offIndex(); return; }
		if (st.lyrics !== undefined) draw();
	});
	// The page's words for the timed lyrics change when this song starts or stops.
	const offPlayer = on("player", () => {
		if (st !== mine || !root.isConnected) { offPlayer(); return; }
		const play = root.querySelector(".ly-play-wrap");
		if (play) play.outerHTML = String(playButton());
		// Heard here, then the player went on: say what plays now.
		if (player.current()?.id === st.id) st.heard = true;
		const next = root.querySelector(".ly-next");
		if (next) next.outerHTML = String(nextNotice());
		const follow = root.querySelector(".ly-follow");
		const want = player.current()?.id === st.id ? "The line being sung is lit; tap a line to go there." : "Timed lyrics: play this song to follow along.";
		if (follow && follow.textContent !== want) follow.textContent = want;
	});
}
