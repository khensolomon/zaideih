/**
 * The lyrics studio (#/lyrics/<song id>/studio, docs/lyrics.md "Studio"):
 * the whole page is for writing one song's lyrics, while the song plays in
 * the app's own player.
 *
 *   Write    the text, in a real <textarea> (so phone keyboards, Myanmar
 *            input, spell-check and undo work as everywhere), over a layer
 *            that marks what the reader recognises; each part labelled in
 *            the margin; details as chips that write the top lines.
 *   Preview  the lyrics as listeners will see them.
 *   Timing   tap as each line starts while the song plays; the times are
 *            written into the text (LRC), a chorus sung again included.
 *   History  for the Lyrics right: versions, reports, hide, show, restore.
 *
 * What is typed is kept on the device as it is typed (core/lyrics.js
 * drafts), so leaving the page loses nothing: coming back continues it.
 * Text in Zawgyi cannot be saved (the Worker refuses it too).
 */
import { AUTH_URL } from "../config.js";
import { html, raw } from "../core/html.js";
import { compareLyrics, dropDraft, hideLyrics, keepDraft, linkLyrics, proposeSameSong, LYRICS_URL, lyricsVersions, readDraft, readLyrics, resolveReports, restoreLyrics, saveLyrics, showLyrics, unlinkLyrics } from "../core/lyrics.js";
import { clearTimes, DETAILS, hasSheetSyllables, joinSyllables, looksZawgyi, lrcTime, parseLyrics, setDetail, setLineTimes, splitDetails } from "../core/lyrics-format.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { on } from "../core/store.js";
import { focusKey, refocus } from "./focus.js";
import { LYRICS_LANGS, lyricsIndex } from "../core/lyrics-index.js";
import { forgetNpLyrics } from "./np-lyrics.js";
import { icon } from "./icons.js";
import { creditsHtml, detailChips, formatHint, guideHtml, lyricsHtml } from "./lyrics-render.js";
import { scriptClass } from "./parts.js";
import { sharedWithHtml, suggestionsHtml, wireFind } from "./lyrics-share.js";
import { compareWords, suggestKeep } from "../core/lyrics-merge.js";
import { creditOf } from "../core/catalog.js";

const MAX = 20_000;
const DRAFT_MS = 300;
let st = null;

const clock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const day = (s) => new Date(s * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** The names a song's parts are inserted with: the hymnbook's for Zolai songs. */
function partNames(track) {
	return /^zo/i.test(track.album?.lang?.name ?? "") ? { verse: "Tang", chorus: "Sakkik" } : { verse: "Verse", chorus: "Chorus" };
}

/**
 * @param {object} catalog
 * @param {number} id  the song
 * @param {object} ctx { notify, promptText, confirmAction, openMenu, canModerate: () => boolean, playSong(track) }
 */
export function lyricsStudio(catalog, id, ctx, lang = "") {
	const track = catalog.track(id);
	if (!(lang in LYRICS_LANGS)) return { title: "Lyrics studio", body: html`<div class="empty"><h2>No such language</h2><p>Lyrics are kept in the song's own words, and in ${Object.values(LYRICS_LANGS).slice(1).join(" and ")} translations.</p></div>` };
	if (!track || track.upload) return { title: "Lyrics studio", body: html`<div class="empty"><h2>No such song</h2><p>Lyrics are kept for songs in the catalog.</p></div>` };
	st = {
		catalog, id, track, lang, original: null, names: lang ? { verse: "Verse", chorus: "Chorus" } : partNames(track), mode: "write", loading: true,
		server: null, text: "", head: "", base: 0, parsed: parseLyrics(""), draft: null,
		saving: false, error: "", conflict: undefined, keepSyllables: false, guide: false,
		history: null, next: 0,
	};
	return {
		title: `Studio: ${track.title}${lang ? ` (${LYRICS_LANGS[lang]})` : ""}`,
		body: html`<div class="st-root">${frame(ctx)}</div>`,
		mount: (view) => mount(view.querySelector(".st-root"), ctx),
	};
}

const dirty = () => st.text !== (st.server?.text ?? "");
/*
 * The text box holds the words; the details at the top (Key: Eb ...) are the
 * chips. st.text is always st.head + the words. The split is made again only
 * when the whole text changes (loading, a chip, joining syllables, timing),
 * never while typing, so the box never moves under the writer's fingers.
 */
const words = () => st.text.slice(st.head.length);
const headLines = () => (st.head ? st.head.split("\n").length - 1 : 0);
function setText(full) {
	st.text = full;
	st.head = splitDetails(full).head;
}

/* ------------------------------------------------------------- drawing ---- */

function frame(ctx) {
	if (!LYRICS_URL) return html`${head(ctx)}<p class="muted st-pad">Lyrics are not available in this version of the app.</p>`;
	if (!(AUTH_URL && account().signedIn)) {
		return html`${head(ctx)}<div class="st-pad"><div class="empty"><h2>Sign in to write lyrics</h2><p>Adding and correcting lyrics needs an account, so every version has someone behind it.</p><p><a class="btn primary" href="#/account">Sign in</a></p></div></div>`;
	}
	if (st.loading) return html`${head(ctx)}<p class="muted st-pad" aria-busy="true">Reading the lyrics…</p>`;
	const body = { write, preview, timing, history }[st.mode](ctx);
	st.bannersHtml = html`${banners(ctx)}`.toString();
	return html`${head(ctx)}<div class="st-page">${raw(st.bannersHtml)}${body}</div>`;
}

function head(ctx) {
	const t = st.track;
	const signed = AUTH_URL && account().signedIn;
	const next = (st.server?.version ?? 0) + 1;
	const state = st.saving ? "Saving…"
		: !signed || st.loading ? ""
		: dirty() ? "Draft kept on this device"
		: st.server ? `Version ${st.server.version}` : "No lyrics yet";
	const modes = [["write", "Write", "edit"], ["preview", "Preview", "eye"], ["timing", "Timing: tap along to time the lines", "timer"]];
	if (ctx.canModerate()) modes.push(["history", "History, reports and hiding", "history"]);
	const blocked = !dirty() || st.saving || looksZawgyi(st.text) || !st.text.trim();
	return html`<header class="st-head">
		<a class="st-icon" href="${href(`lyrics/${st.id}`, st.lang ? { lang: st.lang } : undefined)}" aria-label="Back to the lyrics (Esc)" title="Back to the lyrics (Esc)">${icon("back")}</a>
		<div class="st-title">
			<b class="${scriptClass(t.title)}">${t.title}</b>
			<span>${t.album.title}${state ? html` · ${state}` : ""}</span>
		</div>
		${signed && !st.loading ? html`<button class="st-lang" data-st="lang" aria-haspopup="menu" title="Which lyrics: the song's own words, or a translation">${LYRICS_LANGS[st.lang]} ${icon("down")}</button>` : ""}
		${signed && !st.loading ? html`<div class="st-modes" role="tablist" aria-label="Studio">
			${modes.map(([m, hint, ic]) => html`<button role="tab" class="st-mode" data-st="mode" data-mode="${m}" aria-selected="${String(st.mode === m)}" aria-label="${hint}" title="${hint}">${icon(ic)}</button>`)}
		</div>
		<button class="st-save" data-st="save" aria-label="Save as version ${next}" title="${blocked && !st.saving && !dirty() ? "Nothing to save yet" : `Save as version ${next}`}" ${blocked ? "disabled" : ""}>${icon("check")}</button>` : ""}
	</header>`;
}

function banners(ctx) {
	const out = [];
	// Shared lyrics (docs/lyrics.md): one text for several recordings; timing is each one's own.
	const shared = st.server?.shared;
	if (shared) {
		const linked = shared.source !== st.id;
		out.push(html`<div class="st-banner"><p><b>Shared lyrics.</b> ${sharedWithHtml(st.catalog, shared)}: changing the words changes them there too. Timing is this recording's own.</p>
			${linked && ctx.canModerate() ? html`<button class="btn" data-st="unlink-copy">Give it a copy of its own</button><button class="link-btn" data-st="unlink">Unlink</button>` : ""}</div>`);
	}
	if (!st.server && !st.lang && !st.text.trim()) {
		const offer = suggestionsHtml(st.catalog, st.track, sameOpts(ctx));
		if (offer) out.push(offer);
	}
	if (st.compare) out.push(mergePanel());
	if (st.draft) {
		out.push(html`<div class="st-banner"><p>Continuing your draft from ${clock(st.draft.at)}.${st.draft.newer ? html` Someone saved version ${st.server.version} since: saving will show you theirs to compare.` : ""}</p><button class="link-btn" data-st="discard">Discard draft</button></div>`);
	}
	if (looksZawgyi(st.text)) {
		out.push(html`<div class="st-banner st-bad" role="alert"><p><b>This text is in Zawgyi.</b> Zaideih keeps Myanmar text in Unicode only, so it cannot be saved. Convert it to Unicode first, then paste it here again.</p></div>`);
	}
	if (!st.keepSyllables && hasSheetSyllables(st.text)) {
		out.push(html`<div class="st-banner"><p>This looks copied from sheet music, with words split into syllables ("To - pa"). Join them into words? Hyphens inside words stay.</p><button class="btn" data-st="join">Join syllables</button><button class="link-btn" data-st="keep-syllables">Keep as is</button></div>`);
	}
	if (st.conflict !== undefined) {
		const c = st.conflict;
		out.push(html`<div class="st-banner" role="alert"><p><b>Someone else saved ${c ? `version ${c.version}` : "a change"} while you were writing.</b> Your text is unchanged. ${c ? "Theirs is below; saving now replaces it with yours." : "Their lyrics are no longer there; saving adds yours."}</p>
			${c ? html`<details><summary>Their version</summary><pre class="ly-text ${scriptClass(c.text)}">${c.text}</pre></details>` : ""}</div>`);
	}
	if (st.error) out.push(html`<p class="error" role="alert">${st.error}</p>`);
	return out;
}

function chips() {
	const m = st.parsed.meta;
	const set = DETAILS.filter(([n]) => m[n]);
	return html`<div class="st-details" aria-label="Details">
		${set.map(([n, label]) => html`<button class="st-chip" data-st="detail" data-name="${n}" title="Change ${label.toLowerCase()}"><span>${label}</span> ${m[n]}</button>`)}
		<button class="st-chip st-chip-add" data-st="detail-add" aria-label="Add a detail: key, time, credits" title="Add a detail: key, time, credits">${icon("plus")}</button>
	</div>`;
}

function write() {
	const p = st.parsed;
	const lines = words().split("\n");
	const offset = headLines();
	return html`
		${st.lang ? html`<details class="st-ref"${st.refOpen ? " open" : ""}><summary>The song's own words${st.original ? "" : " (none yet)"}</summary>${st.original ? lyricsHtml(st.original) : html`<p class="muted">Translations can be written before the original; the original is added in Original.</p>`}</details>` : ""}
		${chips()}
		<div class="st-editor">
			<div class="st-margin" aria-hidden="true"></div>
			<div class="st-field ${scriptClass(st.text || st.track.title)}">
				<div class="st-mirror" aria-hidden="true">${lines.map((l, i) => mirrorLine(l, i + offset))}</div>
				<div class="st-marks" aria-hidden="true"></div>
				<textarea id="st-text" aria-label="Lyrics of ${st.track.title}" spellcheck="false" maxlength="${MAX}" placeholder="1. The first verse, one line per sung line&#10;&#10;${st.names.chorus}:&#10;The chorus">${words()}</textarea>
			</div>
			<button class="st-insert" data-st="insert" aria-label="Insert a part, a chord or an answering part" title="Insert a part, a chord or an answering part" hidden>${icon("plus")}</button>
		</div>
		<p class="st-status">${formatHint(p)} · ${st.text.length.toLocaleString()} of ${MAX.toLocaleString()} · <button class="link-btn" data-st="guide">How to write lyrics</button><span class="st-discard"${dirty() ? "" : " hidden"}> · <button class="link-btn" data-st="discard">Discard changes</button></span></p>
		${st.guide ? html`<div class="ly-guide">${guideHtml()}</div>` : ""}
		<div class="st-keys" role="toolbar" aria-label="Insert">
			<button data-st="part" data-part="verse">${st.names.verse}</button>
			<button data-st="part" data-part="chorus">${st.names.chorus}</button>
			<button data-st="answer" aria-label="Answering part">( )</button>
			<button data-st="chord">Chord</button>
			<button data-st="more" aria-label="More">···</button>
		</div>`;
}

/* The text as the layer under the textarea draws it: the same characters, with what is recognised tinted. */
const TOKENS = [
	[/^(\s*)(\d{1,2}[.)])(\s)/, "mk-num"],
	[/^(\s*)(\[[^\]]+\]|\{[^}]*\})(\s*)$/, "mk-head"],
	[/^(\s*)([^\s:[\]{}][^:[\]{}]{0,23}:)(\s*)/, "mk-head", (m) => /^(sakkik|tang|chorus|refrain|verse|bridge|intro|outro|pre-?chorus|hook|သံပြိုင်|အပိုဒ်)/i.test(m[2])],
];
function mirrorLine(line, i) {
	if (!line) return html`<div data-l="${i}">\u200b</div>`;
	const meta = i < 12 && /^\s*(key|time|tempo|capo|hymn|original( title)?|words|music|scripture|english( title)?|bpm)\s*[:=]/i.test(line);
	if (meta) return html`<div data-l="${i}"><mark class="mk-detail">${line}</mark></div>`;
	for (const [re, cls, ok] of TOKENS) {
		const m = re.exec(line);
		if (m && (!ok || ok(m))) {
			const rest = line.slice(m[0].length);
			return html`<div data-l="${i}">${m[1]}<mark class="${cls}">${m[2]}</mark>${m[3] ?? ""}${inline(rest)}</div>`;
		}
	}
	return html`<div data-l="${i}">${inline(line)}</div>`;
}
/** Inside a line: times, chords and answering parts, tinted. */
function inline(text) {
	return text.split(/(\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]|\[[A-G][^\]\s]{0,10}\]|\([^()]{1,120}\))/).map((piece, k) => {
		if (k % 2 === 0) return piece;
		if (piece.startsWith("[") && /\d:/.test(piece)) return html`<mark class="mk-time">${piece}</mark>`;
		if (piece.startsWith("[")) return html`<mark class="mk-chord">${piece}</mark>`;
		return html`<mark class="mk-echo">${piece}</mark>`;
	});
}

function preview() {
	const p = st.parsed;
	if (!p.blocks.length) return html`<div class="empty"><h2>Nothing to preview yet</h2><p>Write the lyrics first.</p></div>`;
	return html`<div class="st-preview">${creditsHtml(p)}${detailChips(p)}${lyricsHtml(p, { chords: true })}</div>`;
}

/** The lines in the order they are sung, a chorus sung again included: what Timing taps through. */
function sung() {
	const out = [];
	for (const b of st.parsed.blocks) {
		b.lines.forEach((l, k) => {
			const src = l.of ?? l;
			if (l.kind !== "words" || src.src === undefined || !l.parts.some((x) => x.text.trim())) return;
			out.push({ line: l, source: src, part: k === 0 ? b.label : "", again: Boolean(l.of) });
		});
	}
	return out;
}

function timing() {
	const rows = sung();
	if (!rows.length) return html`<div class="empty"><h2>Nothing to time yet</h2><p>Write the lyrics first, then come back to tap along.</p></div>`;
	st.next = Math.min(st.next, rows.length);
	const here = player.current()?.id === st.id;
	const done = rows.filter((r) => r.line.time !== null).length;
	return html`
		<p class="st-status">${done} of ${rows.length} lines timed. ${here ? "Tap as each line starts; tap a line in the list to go back to it." : "Play the song, then tap as each line starts."}</p>
		<ol class="st-timing" aria-label="Lines">
			${rows.map((r, k) => html`${r.part ? html`<li class="st-tpart" aria-hidden="true">${r.part}${r.again ? " · again" : ""}</li>` : ""}
			<li><button class="st-trow${k === st.next ? " st-tnext" : ""}${r.again ? " st-tagain" : ""}" data-st="trow" data-k="${k}">
				<span class="st-ttime">${r.line.time !== null ? lrcTime(r.line.time) : k === st.next ? "next" : "—"}</span>
				<span class="${scriptClass(r.line.parts.map((x) => x.text).join(""))}">${r.line.parts.map((x) => x.text).join("")}</span>
			</button></li>`)}
		</ol>
		<div class="st-tap">
			${here
				? html`<button class="btn primary st-tapbtn" data-st="tap" ${st.next >= rows.length ? "disabled" : ""}>${st.next >= rows.length ? "Every line is timed" : "Tap as the line starts"}</button>`
				: html`<button class="btn primary st-tapbtn" data-st="play">${icon("play")} Play this song</button>`}
			<div class="st-tlinks">
				<button class="link-btn" data-st="undo-tap" ${st.next ? "" : "disabled"}>Undo last tap</button>
				<button class="link-btn" data-st="clear-times" ${done ? "" : "disabled"}>Clear all times</button>
			</div>
		</div>`;
}

/**
 * The same song elsewhere (ui/lyrics-share.js), by who is looking and what
 * this song has: without lyrics, the Lyrics right uses another's and a
 * member proposes; with its own, the Lyrics right compares to merge.
 */
function sameOpts(ctx) {
	const mod = ctx.canModerate();
	const shared = st.server?.shared;
	const own = Boolean(st.server) && (!shared || shared.source === st.id);
	return {
		act: own ? (mod ? "compare" : null) : mod ? "link" : "propose",
		attr: "data-st",
		canFind: true,
		exclude: shared ? [shared.source, ...shared.with] : [],
		title: own ? "Same song as another?" : undefined,
	};
}

/** One copy in the merge panel: its song, what it has, and the choice to keep it. */
function mergeCopy(c, value, worth, suggested) {
	const t = st.catalog.track(c.track);
	const checked = st.compare.keep === value;
	return html`<label class="st-merge-copy${checked ? " on" : ""}">
		<input type="radio" name="keep" value="${value}" ${checked ? "checked" : ""} data-st="merge-keep">
		<span class="st-merge-head"><b>${value === "track" ? "Keep this song's text" : "Keep the other text"}</b>${suggested ? html` <span class="st-suggested">Suggested</span>` : ""}</span>
		<span class="st-merge-song ${scriptClass(t?.title ?? "")}">${t ? html`${t.title} · ${t.album.title} · ${creditOf(t.artists, 2)}` : `Song ${c.track}`}${c.source !== c.track ? ` (shows song ${c.source}'s text)` : ""}</span>
		<span class="st-merge-worth">${worth.reasons.join(" · ")}</span>
	</label>`;
}

/** Comparing this song's lyrics with another song's, to merge them into one text. */
function mergePanel() {
	const c = st.compare;
	if (c.loading) return html`<section class="st-merge" aria-busy="true"><p>Comparing the two…</p></section>`;
	const other = st.catalog.track(c.b.track);
	const d = c.diff;
	return html`<section class="st-merge" aria-label="Merge">
		<h2>Merge with “${other?.title ?? `song ${c.b.track}`}”</h2>
		<p>${d.same ? "The same words, line by line: nothing is lost by merging." : html`The words differ: <b>${d.onlyA.length}</b> line${d.onlyA.length === 1 ? "" : "s"} only in this song, <b>${d.onlyB.length}</b> only in the other.`} Chords, times, repeat marks and spacing are not counted.</p>
		${d.same ? "" : html`<details class="st-merge-diff" open><summary>What differs</summary><div class="st-merge-cols">
			<div><h3>Only in this song</h3>${d.onlyA.length ? html`<ul>${d.onlyA.map((l) => html`<li class="${scriptClass(l)}">${l}</li>`)}</ul>` : html`<p class="muted">Nothing</p>`}</div>
			<div><h3>Only in the other</h3>${d.onlyB.length ? html`<ul>${d.onlyB.map((l) => html`<li class="${scriptClass(l)}">${l}</li>`)}</ul>` : html`<p class="muted">Nothing</p>`}</div>
		</div></details>`}
		<div class="st-merge-pick" role="radiogroup" aria-label="Which text stays">
			${mergeCopy(c.a, "track", c.worth.a, c.suggest === "track")}
			${mergeCopy(c.b, "to", c.worth.b, c.suggest === "to")}
		</div>
		<p class="acct-small">One text for both from then on. The other text and its history stay with its song, hidden, and “Give it a copy of its own” brings them back. Each recording keeps its own timing.</p>
		<div class="actions"><button class="btn primary" data-st="merge-do">Merge</button><button class="link-btn" data-st="merge-cancel">Cancel</button></div>
	</section>`;
}

function history(ctx) {
	const h = st.history;
	if (!h) return html`<p class="muted" aria-busy="true">Reading the versions…</p>`;
	return html`<div class="st-history">
		${h.hidden
			? html`<div class="st-banner st-bad"><p>Hidden by ${h.hidden.by} on ${day(h.hidden.at)}: ${h.hidden.reason}</p><button class="btn" data-st="show">Show again</button></div>`
			: h.versions.length ? html`<div class="actions"><button class="btn danger" data-st="hide">Hide…</button></div>` : ""}
		${h.reports?.length ? html`<section class="st-reports"><h2>Reported</h2><ul>${h.reports.map((r) => html`<li>“${r.reason}” <span class="muted">${r.by}, ${day(r.at)}</span></li>`)}</ul>
			<button class="btn" data-st="resolve">Nothing to change</button></section>` : ""}
		<h2>Versions</h2>
		${h.versions.length ? html`<ol class="ly-versions">${h.versions.map((v) => html`<li><details>
			<summary><b>Version ${v.version}</b> by ${v.by.name}, ${day(v.at)}${v.note ? html` <span class="muted">(${v.note})</span>` : ""}${v.version === h.version && !h.hidden ? html` <span class="ly-shown">shown now</span>` : ""}</summary>
			<pre class="ly-text ${scriptClass(v.text)}">${v.text}</pre>
			${v.version !== h.version ? html`<button class="btn" data-st="restore" data-version="${v.version}">Restore version ${v.version}</button>` : ""}
		</details></li>`)}</ol>` : html`<p class="muted">No versions yet.</p>`}
		${h.own?.length ? html`<h2>This song's own text, before it was merged</h2><ol class="ly-versions">${h.own.map((v) => html`<li><details>
			<summary><b>Version ${v.version}</b> by ${v.by.name}, ${day(v.at)}${v.note ? html` <span class="muted">(${v.note})</span>` : ""}</summary>
			<pre class="ly-text ${scriptClass(v.text)}">${v.text}</pre>
		</details></li>`)}</ol>` : ""}
		${st.lang || st.compare ? "" : suggestionsHtml(st.catalog, st.track, sameOpts(ctx))}
	</div>`;
}

/* ------------------------------------------------------------ behaviour ---- */

function mount(root, ctx) {
	const mine = st;
	const alive = () => st === mine && root.isConnected;
	let draftTimer = 0;

	const draw = () => {
		if (!alive()) return;
		const area = root.querySelector("#st-text");
		const caret = area && document.activeElement === area ? [area.selectionStart, area.selectionEnd] : null;
		const scroll = scrollY;
		const focused = caret ? null : focusKey(root);
		root.innerHTML = frame(ctx);
		refocus(root, focused);
		const again = root.querySelector("#st-text");
		if (again) {
			// Set, not only written in the markup: HTML drops a newline at the very start of a textarea.
			if (again.value !== words()) again.value = words();
			fit();
			if (caret) { again.focus({ preventScroll: true }); again.setSelectionRange(...caret); }
		}
		scrollTo(0, scroll);
		marks();
	};
	const reparse = () => { st.parsed = parseLyrics(st.text); };
	const saveDraft = () => {
		clearTimeout(draftTimer);
		draftTimer = 0;
		if (st !== mine || st.loading) return;
		if (dirty()) keepDraft(st.id, { text: st.text, base: st.base }, st.lang);
		else dropDraft(st.id, st.lang);
	};
	const soonDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, DRAFT_MS); };
	// Leaving the page (another page, or closing the tab): the draft is written at once.
	const leave = () => { if (draftTimer) saveDraft(); };
	addEventListener("hashchange", leave);
	addEventListener("pagehide", leave);

	/**
	 * The text changed: typed or inserted in the box (the words; drawn again only
	 * where needed), or changed as a whole (redraw: chips, joining, timing).
	 */
	const changed = (text, { redraw = false } = {}) => {
		if (redraw) setText(text);
		else st.text = text;
		reparse();
		soonDraft();
		if (redraw) { draw(); return; }
		const mirror = root.querySelector(".st-mirror");
		const offset = headLines();
		if (mirror) mirror.innerHTML = html`${words().split("\n").map((l, i) => mirrorLine(l, i + offset))}`.toString();
		fit();
		marks();
		// Only the parts of the page that follow the text.
		const status = root.querySelector(".st-status");
		if (status && st.mode === "write") status.firstChild.textContent = `${formatHint(st.parsed)} · ${text.length.toLocaleString()} of ${MAX.toLocaleString()} · `;
		root.querySelector(".st-discard")?.toggleAttribute("hidden", !dirty());
		const headNow = root.querySelector(".st-head");
		if (headNow) headNow.outerHTML = head(ctx).toString();
		const ban = root.querySelector(".st-page");
		// Rebuilt only when they change: alerts are not announced again on each key, a merge panel keeps its choice.
		const next = html`${banners(ctx)}`.toString();
		if (ban && next !== st.bannersHtml) {
			for (const b of ban.querySelectorAll(":scope > .st-banner, :scope > .error, :scope > .st-merge, :scope > .ly-same")) b.remove();
			ban.insertAdjacentHTML("afterbegin", next);
			st.bannersHtml = next;
		}
		const det = root.querySelector(".st-details");
		if (det) det.outerHTML = chips().toString();
	};

	/** The textarea as tall as its text: the page scrolls, not the box. */
	const fit = () => {
		const area = root.querySelector("#st-text");
		const mirror = root.querySelector(".st-mirror");
		if (area && mirror) area.style.height = `${Math.max(mirror.offsetHeight, 240)}px`;
	};

	/** The margin: each part's label at its first line, a bar along it, and a mark where a chorus is sung again. */
	const marks = () => {
		const margin = root.querySelector(".st-margin");
		const layer = root.querySelector(".st-marks");
		const mirror = root.querySelector(".st-mirror");
		if (!margin || !layer || !mirror) return;
		const lineEl = (i) => mirror.querySelector(`[data-l="${i}"]`);
		let labels = "";
		let bars = "";
		let prev = null;
		for (const b of st.parsed.blocks) {
			if (b.src === null || b.src === undefined) {
				// Sung again here (not written): after the part before it.
				const end = prev && lineEl(prev.last);
				if (end && b.recall) labels += html`<span class="st-again" style="top:${end.offsetTop + end.offsetHeight - 4}px">↻ ${b.label}</span>`;
				continue;
			}
			const first = lineEl(b.src);
			const last = lineEl(b.last ?? b.src);
			if (!first || !last) continue;
			const top = first.offsetTop;
			const height = last.offsetTop + last.offsetHeight - top;
			const chorus = b.kind === "chorus";
			if (b.label) labels += html`<span class="st-label${chorus ? " st-label-chorus" : ""}" style="top:${top}px">${b.label}${b.recall ? " ↻" : ""}</span>`;
			bars += html`<span class="st-bar${chorus ? " st-bar-chorus" : ""}" style="top:${top + 4}px;height:${Math.max(height - 8, 8)}px"></span>`;
			prev = b;
		}
		margin.innerHTML = labels.toString();
		layer.innerHTML = bars.toString();
		caretPlus();
	};

	/** The margin's + beside the line being written. */
	const caretPlus = () => {
		const area = root.querySelector("#st-text");
		const plus = root.querySelector(".st-insert");
		const mirror = root.querySelector(".st-mirror");
		if (!area || !plus || !mirror) return;
		if (document.activeElement !== area) { plus.hidden = true; return; }
		const line = headLines() + area.value.slice(0, area.selectionStart).split("\n").length - 1;
		const el = mirror.querySelector(`[data-l="${line}"]`);
		if (!el) return;
		plus.hidden = false;
		plus.style.top = `${el.offsetTop}px`;
	};

	/** Inserts at the caret (replacing a selection); `select` [from, to] within the inserted text. */
	const insert = (text, select = null) => {
		const area = root.querySelector("#st-text");
		if (!area) return;
		const a = area.selectionStart ?? area.value.length;
		const b = area.selectionEnd ?? a;
		area.focus();
		area.setRangeText(text, a, b, "end");
		if (select) area.setSelectionRange(a + select[0], a + select[1]);
		changed(st.head + area.value);
	};
	/** A part on a line of its own, after a blank line: numbered in a hymnbook, else in brackets. */
	const insertPart = (kind) => {
		const area = root.querySelector("#st-text");
		if (!area) return;
		const before = area.value.slice(0, area.selectionStart);
		const lead = !before.trim() ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
		const hymn = st.parsed.formats.includes("hymnbook") || (!st.parsed.formats.includes("sections") && st.names.verse === "Tang");
		const name = st.names[kind] ?? kind;
		if (kind === "verse" && hymn) {
			const n = st.parsed.blocks.filter((b) => b.kind === "verse" && /^\d+$/.test(b.label)).length + 1;
			insert(`${lead}${n}. `);
		} else if (kind === "chorus" && hymn) {
			insert(`${lead}${name}:\n`);
		} else {
			insert(`${lead}[${name}]\n`);
		}
	};
	const insertChord = () => insert("[G]", [1, 2]);
	const insertAnswer = () => {
		const area = root.querySelector("#st-text");
		const sel = area ? area.value.slice(area.selectionStart, area.selectionEnd) : "";
		insert(`(${sel})`, sel ? null : [1, 1]);
	};
	const moreItems = () => [
		{ label: "Bridge", run: () => insertPart("Bridge") },
		{ label: "Intro", run: () => insertPart("Intro") },
		{ label: "Outro", run: () => insertPart("Outro") },
		{ label: "A note, such as (softly)", run: () => insert("\n(softly)\n", [2, 8]) },
		"-",
		{ label: "Join sheet-music syllables", run: () => changed(joinSyllables(st.text), { redraw: true }) },
		{ label: "How to write lyrics", run: () => { st.guide = true; draw(); } },
	];

	const editDetail = async (name, add = false) => {
		const label = DETAILS.find(([n]) => n === name)[1];
		const value = await ctx.promptText(add ? `Add ${label.toLowerCase()}` : `${label} (empty to take it away)`, st.parsed.meta[name] ?? "", add ? "Add" : "Save");
		if (value === null) return;
		changed(setDetail(st.text, name, value), { redraw: true });
	};

	const loadHistory = async () => {
		if (!ctx.canModerate()) return;
		try {
			st.history = await lyricsVersions(st.id, st.lang);
		} catch (err) {
			st.history = { version: 0, hidden: null, versions: [], reports: [] };
			st.error = `The versions could not be read: ${err.message}`;
		}
	};
	const guarded = async (fn) => {
		if (st.saving) return;
		st.saving = true;
		st.error = "";
		draw();
		try {
			await fn();
		} catch (err) {
			st.error = err.message;
		} finally {
			st.saving = false;
			draw();
		}
	};
	/** Compares this song's lyrics with song `other`'s, for merging (the Lyrics right). */
	const openCompare = async (other) => {
		st.compare = { loading: true };
		draw();
		root.querySelector(".st-merge")?.scrollIntoView({ block: "start", behavior: "smooth" });
		await guarded(async () => {
			try {
				const { a, b } = await compareLyrics(st.id, other);
				if (!a || !b) throw new Error(!a ? "this song has no lyrics to merge" : `song ${other} has no lyrics to merge with`);
				const worth = suggestKeep(a, b, Math.floor(Date.now() / 1000));
				const suggest = worth.keep === "a" ? "track" : "to";
				st.compare = { a, b, diff: compareWords(a.text, b.text), worth, suggest, keep: suggest };
			} catch (err) {
				st.compare = null;
				throw err;
			}
		});
	};

	/** After a decision of the Lyrics right: the saved lyrics and the versions again. */
	const refresh = async (done) => {
		const { lyrics } = await readLyrics(st.id, st.lang);
		st.server = lyrics;
		await loadHistory();
		if (!dirty() && lyrics) { st.base = lyrics.version; setText(lyrics.text); }
		reparse();
		ctx.notify(done);
	};

	const tap = (k = st.next) => {
		const rows = sung();
		const row = rows[k];
		if (!row) return;
		const src = row.source;
		const occurrences = rows.filter((r) => r.source === src);
		const occ = occurrences.indexOf(row);
		const times = [...src.times];
		times[occ] = player.position;
		const upto = times.findIndex((t) => t === undefined);
		const text = setLineTimes(st.text, src.src, src.col, upto < 0 ? times : times.slice(0, upto));
		st.next = k + 1;
		changed(text, { redraw: true });
		root.querySelector(".st-tnext")?.scrollIntoView({ block: "center", behavior: "smooth" });
		root.querySelector("[data-st=tap]")?.focus({ preventScroll: true });
	};
	const untap = () => {
		if (!st.next) return;
		const rows = sung();
		const row = rows[st.next - 1];
		const src = row.source;
		const occ = rows.filter((r) => r.source === src).indexOf(row);
		st.next -= 1;
		changed(setLineTimes(st.text, src.src, src.col, src.times.slice(0, occ)), { redraw: true });
	};

	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-st]");
		if (!b || !root.contains(b)) return;
		const what = b.dataset.st;
		if (what === "mode") {
			st.mode = b.dataset.mode;
			st.error = "";
			if (st.mode === "timing") {
				// Carry on from the first line without a time.
				const rows = sung();
				const first = rows.findIndex((r) => r.line.time === null);
				st.next = first < 0 ? rows.length : first;
			}
			if (st.mode === "history" && !st.history) { draw(); await loadHistory(); }
			draw();
			if (st.mode === "write") root.querySelector("#st-text")?.focus({ preventScroll: true });
		} else if (what === "save") {
			await guarded(async () => {
				try {
					const before = st.base;
					const saved = await saveLyrics(st.id, st.text, st.base, st.lang);
					Object.assign(st, { server: saved, base: saved.version, draft: null, conflict: undefined });
					setText(saved.text);
					reparse();
					await dropDraft(st.id, st.lang);
					// A shared text: timing alone is this recording's, and makes no new version of the words.
					ctx.notify(saved.version === before ? "Timing saved for this recording" : `Saved as version ${saved.version}`);
					lyricsIndex.refresh({ force: true }).catch(() => {});
					forgetNpLyrics(st.id);
					if (st.history) await loadHistory();
				} catch (err) {
					if (err.status !== 409) throw err;
					Object.assign(st, { conflict: err.current ?? null, base: err.current?.version ?? 0 });
				}
			});
		} else if (what === "link") {
			const from = st.catalog.track(Number(b.dataset.to));
			if (!from || !(await ctx.confirmAction(`Show the lyrics of “${from.title}” from ${from.album.title} on this song too? Both will show one text; only those who look after lyrics can undo it.`, "Use these lyrics"))) return;
			await guarded(async () => {
				const lyrics = await linkLyrics(st.id, from.id);
				Object.assign(st, { server: lyrics, base: lyrics.version, draft: null });
				setText(lyrics.text);
				reparse();
				await dropDraft(st.id, st.lang);
				ctx.notify("Linked: this song now shows those lyrics");
				lyricsIndex.refresh({ force: true }).catch(() => {});
				forgetNpLyrics(st.id);
			});
		} else if (what === "propose") {
			const other = st.catalog.track(Number(b.dataset.to));
			if (!other || !(await ctx.confirmAction(`“${st.track.title}” is the same song as “${other.title}” (${other.album.title})? Those who look after lyrics will check and link them.`, "Send"))) return;
			await guarded(async () => {
				await proposeSameSong(st.id, other.id);
				ctx.notify("Thank you: sent to those who look after lyrics");
			});
		} else if (what === "compare") {
			await openCompare(Number(b.dataset.to));
		} else if (what === "merge-cancel") {
			st.compare = null;
			draw();
		} else if (what === "merge-do") {
			const c = st.compare;
			const other = st.catalog.track(c.b.track);
			if (!(await ctx.confirmAction(`Merge with “${other?.title ?? c.b.track}”, keeping ${c.keep === "track" ? "this song's" : "the other"} text?`, "Merge"))) return;
			await guarded(async () => {
				await linkLyrics(st.id, c.b.track, { merge: true, keep: c.keep, proposal: st.proposal });
				const { lyrics } = await readLyrics(st.id, st.lang);
				Object.assign(st, { server: lyrics, base: lyrics?.version ?? 0, draft: null, compare: null, history: null, proposal: null });
				setText(lyrics?.text ?? "");
				reparse();
				if (st.mode === "history") await loadHistory();
				ctx.notify("Merged: one text for both");
				lyricsIndex.refresh({ force: true }).catch(() => {});
				forgetNpLyrics(st.id);
			});
		} else if (what === "unlink" || what === "unlink-copy") {
			const copy = what === "unlink-copy";
			if (!(await ctx.confirmAction(copy
				? "Give this recording a copy of the lyrics as its own, with its timing? From then on, changes to it are its own, and the others' no longer reach it."
				: "Unlink this recording? It will have no lyrics until someone adds or links them. The shared text stays with the others.", copy ? "Make a copy" : "Unlink"))) return;
			await guarded(async () => {
				await unlinkLyrics(st.id, copy);
				const { lyrics } = await readLyrics(st.id, st.lang);
				Object.assign(st, { server: lyrics, base: lyrics?.version ?? 0, draft: null, history: null });
				setText(lyrics?.text ?? "");
				reparse();
				ctx.notify(copy ? "This recording now has its own copy" : "Unlinked");
				lyricsIndex.refresh({ force: true }).catch(() => {});
				forgetNpLyrics(st.id);
			});
		} else if (what === "discard") {
			if (!(await ctx.confirmAction(st.server ? `Discard your changes and go back to version ${st.server.version}?` : "Discard what you have written?", "Discard"))) return;
			await dropDraft(st.id, st.lang);
			Object.assign(st, { draft: null, base: st.server?.version ?? 0, conflict: undefined });
			setText(st.server?.text ?? "");
			reparse();
			draw();
		} else if (what === "join") {
			changed(joinSyllables(st.text), { redraw: true });
		} else if (what === "keep-syllables") {
			st.keepSyllables = true;
			draw();
		} else if (what === "guide") {
			st.guide = !st.guide;
			draw();
		} else if (what === "detail") {
			await editDetail(b.dataset.name);
		} else if (what === "detail-add") {
			const missing = DETAILS.filter(([n]) => !st.parsed.meta[n]);
			ctx.openMenu(b, missing.map(([n, label]) => ({ label, run: () => editDetail(n, true) })));
		} else if (what === "insert") {
			ctx.openMenu(b, [
				{ label: st.names.verse, run: () => insertPart("verse") },
				{ label: st.names.chorus, run: () => insertPart("chorus") },
				{ label: "Chord", run: insertChord },
				{ label: "Answering part ( )", run: insertAnswer },
				"-",
				...moreItems(),
			]);
		} else if (what === "lang") {
			ctx.openMenu(b, Object.entries(LYRICS_LANGS).map(([code, name]) => ({
				label: `${name}${code === st.lang ? " ✓" : lyricsIndex.langs(st.id).includes(code) ? "" : " (none yet)"}`,
				run: () => { location.hash = href(`lyrics/${st.id}/studio`, code ? { lang: code } : undefined); },
			})));
		} else if (what === "part") {
			insertPart(b.dataset.part);
		} else if (what === "answer") {
			insertAnswer();
		} else if (what === "chord") {
			insertChord();
		} else if (what === "more") {
			ctx.openMenu(b, moreItems());
		} else if (what === "play") {
			await ctx.playSong(st.track);
			draw();
		} else if (what === "tap") {
			tap();
		} else if (what === "undo-tap") {
			untap();
		} else if (what === "clear-times") {
			if (!(await ctx.confirmAction("Take every time out of these lyrics?", "Clear times"))) return;
			st.next = 0;
			changed(clearTimes(st.text), { redraw: true });
		} else if (what === "trow") {
			const k = Number(b.dataset.k);
			st.next = k;
			// Going back to a line: the song goes to just before the line before it, to tap it again in time.
			const rows = sung();
			const before = rows[k - 1]?.line.time ?? null;
			if (player.current()?.id === st.id) player.seek(before !== null ? Math.max(0, before - 0.5) : 0);
			draw();
		} else if (what === "hide") {
			const reason = await ctx.promptText("Why hide these lyrics? Shown to anyone who tries to edit them.", "", "Hide");
			if (reason) await guarded(async () => { await hideLyrics(st.id, reason, st.lang); await refresh("Lyrics hidden"); });
		} else if (what === "show") {
			await guarded(async () => { await showLyrics(st.id, st.lang); await refresh("Lyrics shown again"); });
		} else if (what === "resolve") {
			await guarded(async () => { await resolveReports(st.id, st.lang); await refresh("Reports dealt with"); });
		} else if (what === "restore") {
			const v = Number(b.dataset.version);
			if (!(await ctx.confirmAction(`Make version ${v} the lyrics shown? Every version stays in the list.`, "Restore"))) return;
			await guarded(async () => { await restoreLyrics(st.id, v, st.history.version, st.lang); await refresh(`Version ${v} restored`); });
		}
	});

	// The original, beside a translation: open or closed as the writer left it.
	root.addEventListener("toggle", (e) => { if (e.target.classList?.contains("st-ref")) st.refOpen = e.target.open; }, true);
	root.addEventListener("input", (e) => { if (e.target.id === "st-text") changed(st.head + e.target.value); });
	// Finding the same song: results as the person types, offering what fits who is looking.
	wireFind(root, st.catalog, st.track, () => sameOpts(ctx));
	root.addEventListener("change", (e) => {
		if (e.target.dataset?.st === "merge-keep" && st.compare) { st.compare.keep = e.target.value; draw(); }
	});
	root.addEventListener("keyup", (e) => { if (e.target.id === "st-text") caretPlus(); });
	root.addEventListener("pointerup", (e) => { if (e.target.id === "st-text") caretPlus(); });
	root.addEventListener("focusin", (e) => { if (e.target.id === "st-text") { document.body.classList.add("st-typing"); caretPlus(); } });
	root.addEventListener("focusout", (e) => {
		if (e.target.id !== "st-text") return;
		document.body.classList.remove("st-typing");
		// The + stays while it is being reached for.
		setTimeout(() => { if (!root.querySelector(".st-insert:focus, .st-insert:hover")) caretPlus(); }, 150);
	});
	// Ctrl or Cmd + S saves; Esc goes back to the lyrics (the draft is kept).
	root.addEventListener("keydown", (e) => {
		// Escape in the find field clears it (the browser's own), not the studio.
		if (e.key === "Escape" && !document.querySelector("dialog[open], .menu") && !e.target.closest?.(".ly-find-input")) {
			e.preventDefault();
			location.hash = href(`lyrics/${st.id}`, st.lang ? { lang: st.lang } : undefined);
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault();
			root.querySelector("[data-st=save]:not([disabled])")?.click();
		}
	});
	addEventListener("resize", () => { if (alive()) { fit(); marks(); } });
	// Timing: the play button becomes the tap button when the song starts.
	const offPlayer = on("player", () => {
		if (!alive()) { offPlayer(); removeEventListener("hashchange", leave); removeEventListener("pagehide", leave); return; }
		if (st.mode === "timing" && !root.querySelector("[data-st=tap]") === (player.current()?.id === st.id)) draw();
	});

	(async () => {
		const [server, draft, original] = await Promise.all([
			readLyrics(st.id, st.lang).catch((err) => ({ error: err })),
			readDraft(st.id, st.lang),
			// Translating: the song's own words beside, for reference.
			st.lang ? readLyrics(st.id).catch(() => ({ lyrics: null })) : null,
		]);
		if (!alive()) return;
		if (original?.lyrics) st.original = parseLyrics(original.lyrics.text);
		if (server.error) st.error = server.error.message;
		st.server = server.lyrics ?? null;
		await loadHistory();
		if (!alive()) return; // another song or language opened meanwhile
		// Hidden lyrics are not public; the Lyrics right edits the latest version.
		if (!st.server && st.history?.version) {
			const v = st.history.versions[0];
			st.server = { version: st.history.version, text: v.text, updated: v.at };
		}
		st.base = st.server?.version ?? 0;
		setText(st.server?.text ?? "");
		if (draft && draft.text !== st.text) {
			Object.assign(st, { base: draft.base, draft: { at: draft.at, newer: (st.server?.version ?? 0) > draft.base } });
			setText(draft.text);
		}
		st.loading = false;
		reparse();
		draw();
		// Opened to compare with another song (the admin's Waiting list, the lyrics page).
		st.proposal = ctx.proposal ?? null;
		if (ctx.merge && ctx.canModerate() && st.server) await openCompare(ctx.merge);
		else root.querySelector("#st-text")?.focus({ preventScroll: true });
	})();
}
