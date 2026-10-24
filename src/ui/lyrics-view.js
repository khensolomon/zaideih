/**
 * Lyrics of a song (#/lyrics/<song id>, docs/lyrics.md): reading, adding and
 * editing them signed in, and for the Lyrics right, every version, hiding,
 * showing and restoring.
 *
 * Saving starts from the version the editor opened; when someone else saved
 * first, the editor keeps their text and is shown the newer lyrics beside
 * it, and saving again replaces them knowingly.
 */
import { AUTH_URL } from "../config.js";
import { creditOf } from "../core/catalog.js";
import { html } from "../core/html.js";
import { hideLyrics, LYRICS_URL, lyricsVersions, readLyrics, restoreLyrics, saveLyrics, showLyrics } from "../core/lyrics.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { on } from "../core/store.js";
import { icon } from "./icons.js";
import { scriptClass } from "./parts.js";

// State that survives redrawing the page.
let st = null;

const when = (seconds) => new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * @param {object} catalog
 * @param {number} id  the song
 * @param {object} ctx { notify, promptText, confirmAction, canModerate: () => boolean, redrawn }
 */
export function lyricsView(catalog, id, ctx) {
	const track = catalog.track(id);
	if (!track || track.upload) return { title: "Lyrics", body: html`<div class="empty"><h2>No such song</h2><p>Lyrics are kept for songs in the catalog.</p></div>` };
	st = { id, track, lyrics: undefined, offline: false, error: "", editing: false, draft: "", base: 0, conflict: undefined, history: null, busy: false };
	return {
		title: `Lyrics: ${track.title}`,
		body: html`<div class="ly-root">${content(ctx)}</div>`,
		mount: (view) => mount(view.querySelector(".ly-root"), ctx),
	};
}

function header() {
	const t = st.track;
	return html`<div class="hero ly-hero" style="grid-template-columns:1fr"><div>
		<div class="kind">Lyrics</div>
		<h1 class="page-title ${scriptClass(t.title)}">${t.title}</h1>
		<div class="facts"><span>${creditOf(t.artists, 3)}</span><span><a class="text-link" href="${href(`album/${t.album.id}`)}">${t.album.title}</a></span></div>
	</div></div>`;
}

function editor() {
	const c = st.conflict;
	return html`<form class="ly-edit" data-ly="form">
		${c !== undefined ? html`<div class="ly-conflict" role="alert">
			<p><b>Someone else saved ${c ? "these lyrics" : "a change"} while you were editing.</b> Your text is below, unchanged. ${c ? "Theirs is here; saving now replaces it with yours." : "The lyrics are no longer there; saving adds yours."}</p>
			${c ? html`<pre class="ly-text ${scriptClass(c.text)}">${c.text}</pre>` : ""}
		</div>` : ""}
		<label class="ly-label" for="ly-draft">${st.base ? "Edit the lyrics" : "Add the lyrics"}</label>
		<textarea id="ly-draft" name="text" class="${scriptClass(st.draft || st.track.title)}" rows="18" maxlength="20000" required spellcheck="false" placeholder="One line per sung line; a blank line between verses.">${st.draft}</textarea>
		<p class="acct-small">Lyrics appear for everyone at once. Every version is kept, so a mistake can always be undone.</p>
		${st.error ? html`<p class="error" role="alert">${st.error}</p>` : ""}
		<div class="actions">
			<button class="btn primary" type="submit" ${st.busy ? "disabled" : ""}>${st.busy ? "Saving…" : "Save"}</button>
			<button class="btn" type="button" data-ly="cancel" ${st.busy ? "disabled" : ""}>Cancel</button>
		</div>
	</form>`;
}

function reading(ctx) {
	if (st.lyrics === undefined && !st.error) return html`<p class="muted" aria-busy="true">Reading the lyrics…</p>`;
	const signedIn = AUTH_URL && account().signedIn;
	const l = st.lyrics;
	const actions = signedIn
		? html`<div class="actions"><button class="btn" data-ly="edit" ${st.offline ? "disabled" : ""}>${icon("lyrics")} ${l ? "Edit lyrics" : "Add lyrics"}</button></div>`
		: AUTH_URL ? html`<p class="acct-small"><a class="text-link" href="#/account">Sign in</a> to ${l ? "correct these lyrics" : "add the lyrics"}.</p>` : "";
	return html`
		${st.error ? html`<p class="error" role="alert">${st.error}</p>` : ""}
		${l
			? html`<pre class="ly-text ${scriptClass(l.text)}">${l.text}</pre>
				<p class="acct-small">Version ${l.version}, ${when(l.updated)}${st.offline ? ", kept on this device (offline)" : ""}.</p>`
			: st.error ? "" : html`<div class="empty ly-empty"><h2>No lyrics yet</h2><p>${signedIn ? "Know the words? Add them for everyone." : "Nobody has added the lyrics of this song yet."}</p></div>`}
		${actions}
		${ctx.canModerate() ? moderation() : ""}`;
}

function moderation() {
	const h = st.history;
	if (!h) return html`<section class="ly-mod"><h2>Lyrics right</h2><p class="muted">Reading the versions…</p></section>`;
	return html`<section class="ly-mod">
		<h2>Lyrics right</h2>
		${h.hidden
			? html`<p class="acct-warn">Hidden by ${h.hidden.by} on ${when(h.hidden.at)}: ${h.hidden.reason}</p><div class="actions"><button class="btn" data-ly="show">Show again</button></div>`
			: h.versions.length ? html`<div class="actions"><button class="btn danger" data-ly="hide">Hide…</button></div>` : ""}
		${h.versions.length ? html`<h3>Versions</h3><ol class="ly-versions">${h.versions.map((v) => html`<li>
			<details><summary><b>Version ${v.version}</b> by ${v.by.name}, ${when(v.at)}${v.note ? html` <span class="muted">(${v.note})</span>` : ""}${v.version === h.version && !h.hidden ? html` <span class="ly-shown">shown now</span>` : ""}</summary>
				<pre class="ly-text ${scriptClass(v.text)}">${v.text}</pre>
				${v.version !== h.version ? html`<button class="btn" data-ly="restore" data-version="${v.version}">Restore version ${v.version}</button>` : ""}
			</details></li>`)}</ol>` : html`<p class="muted">No versions yet.</p>`}
	</section>`;
}

function content(ctx) {
	if (!LYRICS_URL) return html`${header()}<p class="muted">Lyrics are not available in this version of the app.</p>`;
	return html`${header()}${st.editing ? editor() : reading(ctx)}`;
}

function mount(root, ctx) {
	const mine = st;
	const draw = () => {
		if (st !== mine || !root.isConnected) return;
		// Keep what is being typed across redraws.
		const area = root.querySelector("#ly-draft");
		if (area) st.draft = area.value;
		root.innerHTML = content(ctx);
		ctx.redrawn?.();
	};
	const load = async () => {
		try {
			const { lyrics, offline } = await readLyrics(st.id);
			Object.assign(st, { lyrics, offline, error: "" });
		} catch (err) {
			Object.assign(st, { lyrics: null, error: err.message });
		}
		draw();
	};
	const loadHistory = async () => {
		if (!ctx.canModerate()) return;
		try {
			st.history = await lyricsVersions(st.id);
		} catch (err) {
			st.history = { version: 0, hidden: null, versions: [] };
			st.error = `The versions could not be read: ${err.message}`;
		}
		draw();
	};
	// After a change by the Lyrics right: the page and the versions again.
	const after = async (done) => {
		ctx.notify(done);
		await Promise.all([load(), loadHistory()]);
	};
	const guarded = async (fn) => {
		if (st.busy) return;
		st.busy = true;
		try {
			await fn();
		} catch (err) {
			st.error = err.message;
		} finally {
			st.busy = false;
			draw();
		}
	};

	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-ly]");
		if (!b || !root.contains(b)) return;
		const what = b.dataset.ly;
		if (what === "edit") {
			Object.assign(st, { editing: true, draft: st.lyrics?.text ?? "", base: st.lyrics?.version ?? 0, conflict: undefined, error: "" });
			draw();
			root.querySelector("#ly-draft")?.focus();
		} else if (what === "cancel") {
			Object.assign(st, { editing: false, draft: "", conflict: undefined, error: "" });
			draw();
		} else if (what === "hide") {
			const reason = await ctx.promptText("Why hide these lyrics? Shown to anyone who tries to edit them.", "", "Hide");
			if (reason) await guarded(async () => { await hideLyrics(st.id, reason); await after("Lyrics hidden"); });
		} else if (what === "show") {
			await guarded(async () => { await showLyrics(st.id); await after("Lyrics shown again"); });
		} else if (what === "restore") {
			const v = Number(b.dataset.version);
			if (!(await ctx.confirmAction(`Make version ${v} the lyrics shown? The current version stays in the list.`, "Restore"))) return;
			await guarded(async () => { await restoreLyrics(st.id, v, st.history.version); await after(`Version ${v} restored`); });
		}
	});
	root.addEventListener("submit", async (e) => {
		e.preventDefault();
		st.draft = root.querySelector("#ly-draft").value;
		await guarded(async () => {
			try {
				st.lyrics = await saveLyrics(st.id, st.draft, st.base);
				Object.assign(st, { editing: false, draft: "", conflict: undefined, error: "", offline: false });
				ctx.notify("Lyrics saved");
				loadHistory();
			} catch (err) {
				if (err.status !== 409) throw err;
				// Someone else saved first: keep the text, show theirs, and start from their version.
				Object.assign(st, { conflict: err.current ?? null, base: err.current?.version ?? 0, error: "" });
			}
		});
	});
	load();
	loadHistory();
	// The member's rights arrive with their library, often after the page is drawn.
	const off = on("uploads", (state) => {
		if (st !== mine || !root.isConnected) { off(); return; }
		if (!state.loading && ctx.canModerate() && !st.history) loadHistory();
		else if (!ctx.canModerate() && st.history) { st.history = null; draw(); }
	});
}
