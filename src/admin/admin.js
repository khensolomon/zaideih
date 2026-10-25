/**
 * The hidden admin page (#/admin): edit the catalog through GitHub.
 *
 *   Connect      Sign in with GitHub (src/admin/session.js, finished by the
 *                audio Worker), or a fine-grained GitHub token for
 *                khensolomon/zaideih; either is kept on this device only
 *                (localStorage). Refused while Google Analytics is on here,
 *                since a third-party script on the page could read it.
 *
 * A page of its own, laid out like the lyrics studio: one header with the
 * section, a find field (Ctrl+K), the sections as icons with hints, the
 * draft and the person's photo; the app's own player stays below.
 *
 *   Overview     what waits for this person (requests, lyrics reports,
 *                suggestions, data checks), the draft, lyrics lately, plays.
 *   Catalog      find an album or artist; its page keeps every change in the
 *                draft as it is made (src/admin/draft.js): titles, year,
 *                language, genres, song credits, hiding, artist names and
 *                spellings. Songs play in the app's player.
 *   Draft        the changes, one line each; publish them as one pull request
 *                with the next version and a changelog section; the checks
 *                run; "Merge and release" squash-merges it with the release
 *                line, so the release workflow deploys it. A bar above the
 *                player shows the draft while editing.
 *   Suggestions  people without write access (contributors, guests) send
 *                their draft as a suggestion: the audio Worker opens the pull
 *                request for them (worker/media/suggest.js); editors see the
 *                open ones on the Overview and review them on GitHub.
 *   Requests     members' albums asked to be published (worker/media/requests.js),
 *                for Review publishing: listen, then approve (the Worker copies
 *                the songs into music/, and a pull request adds the album to
 *                the catalog, src/admin/publish.js) or decline with a reason.
 *   Lyrics       reports and the latest edits, for the Lyrics right.
 *   Members      rights, blocking and uploads in personal libraries.
 *   Checks       catalog checks (src/admin/health.js).
 *   Statistics   counted plays from the audio Worker (GET /plays).
 *
 * Levels (src/core/access.js) come from the person's repository permission;
 * GitHub enforces what each may do on every request.
 *
 * Loaded as its own bundle only when the page is opened (tools/build.mjs).
 */
import { html, raw } from "../core/html.js";
import { icon } from "../ui/icons.js";
import { logoMark } from "../ui/logo.js";
import { normalize } from "../core/text.js";
import { nextVersion, parseVersion, releaseFiles, VERSION_FILES } from "../../tools/lib/version.mjs";
import { applyChanges, cleanValue, describe, DraftError, indexData, setChange, sourceText } from "./draft.js";
import { BASE, createGitHub, GitHubError, REPO } from "./github.js";
import { healthChecks } from "./health.js";
import { buildPublish } from "./publish.js";
import { stringifyMedia } from "../../tools/lib/media.mjs";
import { createSession, PENDING_KEY, SESSION_KEY, SignInError } from "./session.js";
import { LEVELS, saveWho, TOKEN_KEY } from "../core/access.js";
import { AccountError, createAccount, homeScreenApp, waitForSignIn } from "../core/account.js";

const DRAFT_KEY = "zaideih.admin.draft";
const DATA = { albums: "assets/data/albums.json", artists: "assets/data/artist.name.json", category: "assets/data/category.json", media: "assets/data/media.json" };
const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

const store = {
	get(key) { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } },
	set(key, value) {
		try {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, JSON.stringify(value));
		} catch (err) {
			throw new Error(`this device could not keep the admin data (${err.message})`);
		}
	},
};

/**
 * @param {HTMLElement} root
 * @param {{ catalog, notify, analyticsOn: () => boolean, totalsUrl: string, desktop: boolean }} ctx
 */
export function mount(root, ctx) {
	const s = {
		tab: "overview",
		openChecks: new Set(),
		rights: new Set(),      // in personal libraries (worker/media/members.js)
		tokenOpen: false,
		gh: null,
		via: null,        // "github" (signed in) or "token"
		user: null,
		level: null,      // src/core/access.js
		name: "",
		avatar: "",
		done: null,       // { edits, suggestions } released, for the header
		menu: false,      // the person's menu in the header
		jump: null,       // { kind, id, track } from a listener page's Edit link
		suggestions: null, // open suggestions, for editors
		data: null,       // { head, albums, artists, category, index }
		draft: store.get(DRAFT_KEY) ?? { changes: [], pr: null },
		query: "",
		open: null,       // { kind: "album" | "artist", id }
		busy: "",
		error: "",
		pr: null,         // live status of the open pull request
		totals: null,
		requests: null,   // GET /library/requests: { reviewer, requests }
		reviewing: null,  // the request whose approval form is open
		jumpReview: null, // #/admin?review=<id>, from "Public in the catalog"
	};
	let poll = 0;
	const session = createSession({ authUrl: ctx.authUrl, local: localStorage, tab: sessionStorage });
	// The Zaideih session for the audio Worker's own routes (core/account.js), got from this sign-in.
	const account = createAccount({ authUrl: ctx.authUrl, local: localStorage, githubToken: () => session.token() });

	const saveDraft = () => store.set(DRAFT_KEY, s.draft);
	/** Shows what went wrong; `keepPage` leaves the page (and what is typed in it) as it is. */
	const fail = (err, { keepPage = false } = {}) => {
		s.busy = "";
		s.error = err instanceof GitHubError || err instanceof DraftError || err instanceof SignInError ? err.message : `${err.name}: ${err.message}`;
		// A refused value is the listener's to fix and is shown on the page; anything else also goes to the console.
		if (!(err instanceof DraftError || err instanceof SignInError)) console.error(err);
		if (keepPage) refreshChrome();
		else render();
	};

	const names = () => ({
		artist: (id) => s.data?.index.artist.get(id)?.name,
		lang: (id) => s.data?.category.lang.find((l) => l.id === id)?.name,
		genre: (id) => s.data?.category.genre.find((g) => g.id === id)?.name,
		type: (id) => s.data?.category.artist.find((t) => t.id === id)?.name,
	});

	/** Connects with a fine-grained token (via "token") or this device's GitHub sign-in (via "github"). */
	async function connect(via, token) {
		s.busy = via === "github" ? "Checking the GitHub sign-in…" : "Checking the token…";
		s.error = "";
		render();
		try {
			const gh = createGitHub(via === "github" ? () => session.token() : token);
			const who = await gh.whoami();
			// Without write access, a GitHub sign-in can still send suggestions (the Worker opens them); a token cannot.
			if (!who.canWrite && via === "token") {
				throw new SignInError(`${who.login} cannot write to ${REPO}; give the token Contents and Pull requests (read and write) on that repository, or sign in with GitHub to send suggestions`);
			}
			if (via === "token") store.set(TOKEN_KEY, token);
			s.gh = gh;
			s.via = via;
			s.user = who.login;
			s.level = who.level;
			s.canWrite = who.canWrite;
			s.name = who.name;
			s.avatar = who.avatar;
			// Kept before the library is asked: the Zaideih session is got for the person kept here.
			saveWho(localStorage, { login: who.login, level: who.level, via });
			// Decoration only: the header shows nothing about it when GitHub's search is unavailable.
			gh.contributions(who.login).then((d) => { s.done = d; render(); }, (err) => console.warn("contributions", err));
			// Moderators of personal libraries get the Members tab (docs/library.md).
			// Rights in personal libraries (worker/media/members.js): the Members tab, and what it offers.
			libraryCall("GET", "").then((lib) => {
				s.rights = new Set(lib.member?.rights ?? []);
				s.isOwner = lib.member?.role === "owner";
				if (may("review")) loadRequests().catch(fail);
				if (may("lyrics")) loadLyrics().catch(fail);
				render();
			}, (err) => console.warn("library", err.message));
			ctx.onWho?.();
			await load();
		} catch (err) {
			// A sign-in that cannot be used is forgotten here, so the page does not retry it on every visit.
			if (via === "github") store.set(SESSION_KEY, null);
			saveWho(localStorage, null);
			ctx.onWho?.();
			fail(err);
		}
	}

	/**
	 * In an app added to the home screen, GitHub opens in a browser sheet that
	 * cannot come back: the sign-in button is a link prepared in advance, and
	 * the page takes the code from the Worker (core/account.js waitForSignIn).
	 */
	async function prepareSignInLink() {
		if (!homeScreenApp() || !ctx.authUrl) { s.signInLink = null; return; }
		s.signInLink = await session.start(`${location.origin}${location.pathname}`, { wait: true });
	}

	async function waitForGitHub() {
		let nonce = null;
		try { nonce = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null")?.nonce ?? null; } catch { /* below */ }
		if (!nonce) throw new SignInError("the sign-in was not prepared on this page; try again");
		s.busy = "Finish signing in with GitHub in the window that opened, then come back here.";
		s.error = "";
		render();
		try {
			const code = await waitForSignIn({ authUrl: ctx.authUrl, nonce }).promise;
			await finishSignIn(new URLSearchParams({ signin: code, nonce }));
		} catch (err) {
			if (err instanceof AccountError) throw new SignInError(err.message);
			throw err;
		} finally {
			if (!s.gh) await prepareSignInLink();
		}
	}

	/** Goes to GitHub to sign in; GitHub comes back to #/admin?signin=… through the Worker. */
	async function signInWithGitHub() {
		s.busy = "Opening GitHub…";
		render();
		location.assign(await session.start(`${location.origin}${location.pathname}`));
	}

	/** Back from GitHub: exchange the code, then connect. */
	async function finishSignIn(query) {
		// The code is single-use; take it out of the address and history right away.
		history.replaceState(history.state, "", "#/admin");
		if (query.get("signin-error")) throw new SignInError(`GitHub did not sign you in: ${query.get("signin-error")}`);
		s.busy = "Finishing the GitHub sign-in…";
		render();
		await session.finish({ code: query.get("signin"), nonce: query.get("nonce") });
		await connect("github");
	}

	/** A listener page's Edit link (#/admin?album=…&track=… or ?artist=…): open that editor. */
	function openJump() {
		const { kind, id } = s.jump;
		const known = kind === "album" ? s.data.index.album.has(id) : s.data.index.artist.has(id);
		if (!known) { s.error = `That ${kind} is not in the catalog on ${BASE}; it may have been changed since this page was loaded.`; return; }
		s.tab = "catalog";
		s.open = { kind, id };
	}

	function focusTrack(trackId) {
		s.flash = trackId;
		render();
		const row = root.querySelector(`[data-track="${trackId}"]`);
		if (!row) return;
		row.scrollIntoView({ block: "center" });
		row.querySelector("input")?.focus({ preventScroll: true });
		setTimeout(() => { s.flash = null; }, 2000);
	}

	async function disconnect() {
		const via = s.via;
		store.set(TOKEN_KEY, null);
		saveWho(localStorage, null);
		ctx.onWho?.();
		s.gh = null; s.via = null; s.user = null; s.level = null; s.data = null; s.suggestions = null; s.done = null; s.menu = false; s.rights = new Set(); s.isOwner = false; s.members = null; s.requests = null; s.reviewing = null;
		render();
		await account.signOut().catch((err) => console.warn("the Zaideih session could not be signed out", err));
		if (via === "github") await session.signOut();
		await prepareSignInLink().catch(fail);
		render();
	}

	async function load() {
		s.busy = `Loading the catalog from ${BASE}…`;
		render();
		const head = await s.gh.head();
		const [albums, artists, category] = await Promise.all([DATA.albums, DATA.artists, DATA.category].map((p) => s.gh.file(p, head)));
		const parsed = { albums: JSON.parse(albums.text), artists: JSON.parse(artists.text), category: JSON.parse(category.text) };
		s.data = { head, ...parsed, index: indexData(parsed) };
		s.busy = "";
		if (s.draft.pr) watch();
		if (s.jump) openJump();
		render();
		if (s.jump?.track) focusTrack(s.jump.track);
		s.jump = null;
		// Editors: the number of open suggestions, on the Overview.
		if (s.canWrite) loadSuggestions().catch(fail);
		// The Overview's listening line; it says nothing more when the counts cannot be read.
		loadTotals().catch((err) => console.warn("the counted plays could not be read", err));
	}


	/* ---------------------------------------------------------- editing ---- */

	/*
	 * The album and artist pages: every field is kept in the draft as soon as
	 * it changes (on leaving a field, or at once for switches and lists), and
	 * marked until the draft is published. A refused value is shown and stays
	 * in the field to be corrected; the draft keeps what it had.
	 */

	/** The value as the draft has it (the change, or the source). */
	function draftValue(kind, id, field, source) {
		const c = s.draft.changes.find((x) => x.kind === kind && x.id === id && x.field === field);
		return c ? c.value : source;
	}

	/** Whether the draft changes this field (or, without `field`, anything of this item). */
	const changed = (kind, id, field) => s.draft.changes.some((c) => c.kind === kind && c.id === id && (!field || c.field === field));

	function results() {
		const q = normalize(s.query);
		if (q.length < 2) return { albums: [], artists: [] };
		const albums = s.data.albums.filter((a) => normalize(a.ab).includes(q) || a.ui === s.query.trim()).slice(0, 30);
		const artists = s.data.artists.filter((a) => normalize(a.name).includes(q) || (a.aka && normalize(a.aka).includes(q))).slice(0, 20);
		return { albums, artists };
	}

	const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
	const artistNames = (ids) => ids.map((a) => s.data.index.artist.get(a)?.name ?? `#${a}`).join(", ");
	/** The app's cover for an album (drawn by the app's bundle, so taken as it is). */
	const coverOf = (id) => raw(String(ctx.cover?.(id) ?? ""));

	/** Artist names typed in a song's row, as ids; an unknown name is refused. */
	function artistIds(typed, trackId) {
		return typed.split(",").map((x) => x.trim()).filter(Boolean).map((n) => {
			const m = /^#(\d+)$/.exec(n);
			if (m) return Number(m[1]);
			const hit = s.data.artists.find((a) => a.name === n) ?? s.data.artists.find((a) => normalize(a.name) === normalize(n));
			if (!hit) throw new DraftError(`no artist named "${n}" (song ${trackId}); add the artist first or pick a name from the list`);
			return hit.id;
		});
	}

	function crumbs(what) {
		return html`<nav class="adm-crumbs" aria-label="Where"><button class="link-btn" data-adm="close">Catalog</button><span aria-hidden="true">›</span><span>${what}</span></nav>`;
	}

	function albumEditor(al) {
		const cat = s.data.category;
		const yr = draftValue("album", al.ui, "yr", al.yr?.[0] ?? null);
		const lg = draftValue("album", al.ui, "lg", al.lg);
		const gr = draftValue("album", al.ui, "gr", al.gr);
		const mark = (f) => (changed("album", al.ui, f) ? " adm-changed" : "");
		const genre = (id) => cat.genre.find((g) => g.id === id)?.name ?? `#${id}`;
		const plays = al.tk.reduce((n, t) => n + (t.p ?? 0), 0);
		const lyricsCount = al.tk.filter((t) => ctx.lyrics?.has(t.i)).length;
		return html`<div class="adm-item" data-form="album" data-id="${al.ui}">
			${crumbs(html`Album <code>${al.ui}</code>`)}
			<div class="adm-hero">
				<a class="adm-cover" href="#/album/${al.ui}" title="Open in the app">${coverOf(al.ui)}</a>
				<div class="adm-hero-text">
					<span class="adm-kicker">Album · ${plural(al.tk.length, "song")} · ${plural(plays, "play")}${lyricsCount ? ` · ${lyricsCount} with lyrics` : ""}</span>
					<input class="adm-title${mark("ab")}" name="ab" value="${draftValue("album", al.ui, "ab", al.ab)}" required aria-label="Album title" title="Album title" autocomplete="off">
					<div class="adm-facts">
						<label class="adm-pill${mark("yr")}" title="Year (empty: none)"><span>Year</span><input name="yr" type="number" min="1900" max="2100" value="${yr ?? ""}" placeholder="none" inputmode="numeric"></label>
						<label class="adm-pill adm-pill-select${mark("lg")}" title="Language"><select name="lg" aria-label="Language">${cat.lang.map((l) => html`<option value="${l.id}" ${l.id === lg ? "selected" : ""}>${l.name}</option>`)}</select>${icon("down")}</label>
						<span class="adm-sep" aria-hidden="true"></span>
						${gr.map((g) => html`<button type="button" class="adm-genre${mark("gr")}" data-adm="genre-drop" data-genre="${g}" aria-label="Remove the genre ${genre(g)}" title="Remove the genre">${genre(g)}${icon("close")}</button>`)}
						<label class="adm-genre-add" title="Add a genre">${icon("plus")}<span>Genre</span><select name="gr-add" aria-label="Add a genre"><option value="" selected></option>${cat.genre.filter((g) => !gr.includes(g.id)).map((g) => html`<option value="${g.id}">${g.name}</option>`)}</select></label>
					</div>
				</div>
			</div>
			<div class="adm-songs" role="table" aria-label="Songs">
				<div class="adm-song adm-song-head" role="row"><span role="columnheader"><span class="sr">Listen</span></span><span role="columnheader">Title</span><span role="columnheader">Artists</span><span role="columnheader" class="num">Plays</span><span role="columnheader">Lyrics</span><span role="columnheader" class="end">Shown</span></div>
				${al.tk.map((t) => {
					const hidden = draftValue("track", t.i, "h", t.h === true);
					const has = ctx.lyrics?.has(t.i);
					return html`<div class="adm-song${changed("track", t.i) ? " adm-changed" : ""}${hidden ? " adm-hidden" : ""}${s.flash === t.i ? " adm-flash" : ""}" role="row" data-track="${t.i}">
						${listenButton(t.i)}
						<input name="t" value="${draftValue("track", t.i, "t", t.t)}" aria-label="Title of song ${t.i}" autocomplete="off">
						<input name="a" value="${artistNames(draftValue("track", t.i, "a", t.a))}" list="adm-artists" aria-label="Artists of song ${t.i}" title="Artist names, separated by commas" autocomplete="off">
						<span class="num">${(t.p ?? 0).toLocaleString()}</span>
						<a class="adm-ly${has ? " on" : ""}" href="#/lyrics/${t.i}${has ? "" : "/studio"}" title="${has ? "Read the lyrics" : "Write the lyrics in the studio"}">${has ? html`${icon("lyrics")}<span>Lyrics</span>` : "Write"}</a>
						<label class="adm-switch end" title="${hidden ? "Hidden in the app" : "Shown in the app"}"><input type="checkbox" name="shown" role="switch" ${hidden ? "" : "checked"} aria-label="Song ${t.i} shown in the app"><span aria-hidden="true"></span></label>
					</div>`;
				})}
			</div>
			<datalist id="adm-artists">${s.data.artists.map((a) => html`<option value="${a.name}">`)}</datalist>
			<p class="adm-hint">Each change goes to your draft as you make it. Nothing changes in the app until the draft is published.</p>
		</div>`;
	}

	function artistEditor(a) {
		const cat = s.data.category;
		const type = draftValue("artist", a.id, "type", a.type);
		const mark = (f) => (changed("artist", a.id, f) ? " adm-changed" : "");
		const albums = s.data.albums.filter((al) => al.tk.some((t) => t.a.includes(a.id)));
		return html`<div class="adm-item" data-form="artist" data-id="${a.id}">
			${crumbs(html`Artist <code>${a.id}</code>`)}
			<div class="adm-hero">
				<a class="adm-cover adm-cover-artist" href="#/artist/${a.id}" title="Open in the app">${icon("person")}</a>
				<div class="adm-hero-text">
					<span class="adm-kicker">Artist · ${plural(albums.length, "album")}</span>
					<input class="adm-title${mark("name")}" name="name" value="${draftValue("artist", a.id, "name", a.name)}" required aria-label="Artist name" title="Artist name" autocomplete="off">
					<div class="adm-facts">
						<label class="adm-pill adm-pill-select${mark("type")}" title="Type"><select name="type" aria-label="Type">${cat.artist.map((t) => html`<option value="${t.id}" ${t.id === type ? "selected" : ""}>${t.name}</option>`)}</select>${icon("down")}</label>
					</div>
				</div>
			</div>
			<div class="adm-fields">
				<label class="adm-field${mark("aka")}"><span>Also known as</span><input name="aka" value="${draftValue("artist", a.id, "aka", a.aka ?? "")}" placeholder="none" autocomplete="off"></label>
				<label class="adm-field${mark("thesaurus")}"><span>Other spellings, for search</span><input name="thesaurus" value="${draftValue("artist", a.id, "thesaurus", a.thesaurus ?? []).join(", ")}" placeholder="Separated by commas" autocomplete="off"></label>
			</div>
			${albums.length ? html`<h2 class="adm-h">Albums</h2><ul class="adm-rows">${albums.slice(0, 60).map((al) => albumRow(al))}</ul>${albums.length > 60 ? html`<p class="adm-hint">and ${(albums.length - 60).toLocaleString()} more</p>` : ""}` : ""}
		</div>`;
	}

	const albumRow = (al) => html`<li><button data-adm="open" data-kind="album" data-id="${al.ui}"><span class="adm-thumb">${coverOf(al.ui)}</span><span class="adm-row-text"><b>${draftValue("album", al.ui, "ab", al.ab)}</b><small>${[al.yr?.[0], plural(al.tk.length, "song")].filter(Boolean).join(" · ")}</small></span>${changed("album", al.ui) || al.tk.some((t) => changed("track", t.i)) ? html`<span class="adm-dot" title="Changed in your draft"></span>` : ""}</button></li>`;

	function catalogView() {
		const open = s.open && (s.open.kind === "album" ? s.data.index.album.get(s.open.id) : s.data.index.artist.get(s.open.id));
		if (open) return s.open.kind === "album" ? albumEditor(open) : artistEditor(open);
		const r = results();
		const q = s.query.trim();
		return html`<div class="adm-find-page">
			<label class="adm-search">${icon("search")}<input type="search" data-adm="search" data-where="page" value="${s.query}" placeholder="Find an album or an artist" aria-label="Find an album or an artist (2 letters or more, or an album id)" autocomplete="off" spellcheck="false"></label>
			${normalize(q).length < 2
				? html`<p class="adm-hint">Two letters or more, or an album id. ${plural(s.data.albums.length, "album")} and ${plural(s.data.artists.length, "artist")} on ${BASE}.</p>`
				: !r.albums.length && !r.artists.length ? html`<p class="adm-hint">Nothing found for “${q}”.</p>` : ""}
			${r.albums.length ? html`<h2 class="adm-h">Albums</h2><ul class="adm-rows">${r.albums.map(albumRow)}</ul>` : ""}
			${r.artists.length ? html`<h2 class="adm-h">Artists</h2><ul class="adm-rows">${r.artists.map((a) => html`<li><button data-adm="open" data-kind="artist" data-id="${a.id}"><span class="adm-thumb adm-thumb-artist">${icon("person")}</span><span class="adm-row-text"><b>${draftValue("artist", a.id, "name", a.name)}</b><small>${a.aka ?? ""}</small></span>${changed("artist", a.id) ? html`<span class="adm-dot" title="Changed in your draft"></span>` : ""}</button></li>`)}</ul>` : ""}
		</div>`;
	}

	/**
	 * Keeps one field in the draft. Returns true when the page needs drawing
	 * again (a list or a switch changed); typed fields are marked in place, so
	 * moving on with Tab keeps its place.
	 */
	function keepField(el) {
		const form = el.closest("[data-form]");
		const kind = form?.dataset.form;
		const row = el.closest("[data-track]");
		let change = null;
		if (kind === "album") {
			const id = form.dataset.id;
			if (row) {
				const tid = Number(row.dataset.track);
				if (el.name === "t") change = { kind: "track", id: tid, field: "t", value: el.value };
				else if (el.name === "a") change = { kind: "track", id: tid, field: "a", value: artistIds(el.value, tid) };
				else if (el.name === "shown") change = { kind: "track", id: tid, field: "h", value: !el.checked };
			} else if (["ab", "yr", "lg"].includes(el.name)) change = { kind: "album", id, field: el.name, value: el.value };
			else if (el.name === "gr-add" && el.value) {
				const al = s.data.index.album.get(id);
				change = { kind: "album", id, field: "gr", value: [...draftValue("album", id, "gr", al.gr), Number(el.value)] };
			}
		} else if (kind === "artist" && ["name", "aka", "type", "thesaurus"].includes(el.name)) {
			change = { kind: "artist", id: Number(form.dataset.id), field: el.name, value: el.value };
		}
		if (!change) return false;
		const value = cleanValue(change, change.value, s.data.category);
		s.draft.changes = setChange(s.draft.changes, s.data.index, { ...change, value });
		saveDraft();
		el.removeAttribute("aria-invalid");
		return el.tagName === "SELECT" || el.type === "checkbox";
	}

	/** After a typed field is kept: its mark, its row's mark, and the draft counts. */
	function markKept(el) {
		const form = el.closest("[data-form]");
		const row = el.closest("[data-track]");
		if (row) row.classList.toggle("adm-changed", changed("track", Number(row.dataset.track)));
		else {
			const kind = form.dataset.form;
			const id = kind === "album" ? form.dataset.id : Number(form.dataset.id);
			(el.closest(".adm-pill, .adm-field") ?? el).classList.toggle("adm-changed", changed(kind, id, el.name));
		}
		refreshChrome();
	}

	function removeGenre(id, genreId) {
		const al = s.data.index.album.get(id);
		const value = cleanValue({ kind: "album", field: "gr" }, draftValue("album", id, "gr", al.gr).filter((g) => g !== genreId), s.data.category);
		s.draft.changes = setChange(s.draft.changes, s.data.index, { kind: "album", id, field: "gr", value });
		saveDraft();
	}

	/* ---------------------------------------------------------- listening ---- */

	/*
	 * Catalog songs play in the app's own player. A request's songs are not
	 * in the catalog yet: they play here, one at a time, and the app's player
	 * pauses while they do (and the other way round).
	 */
	const preview = new Audio();
	preview.preload = "none";
	let previewUrl = "";

	function listenButton(trackId) {
		const now = ctx.player?.current?.()?.id === trackId;
		const on = now && ctx.player.state.playing;
		return html`<button type="button" class="adm-listen${now ? " now" : ""}" data-adm="play" data-id="${trackId}" aria-label="${on ? "Pause" : "Listen"}" title="${on ? "Pause" : "Listen"}">${icon(on ? "pause" : "play")}</button>`;
	}

	async function playSong(trackId) {
		if (!ctx.player) throw new Error("the player is not available on this page");
		if (ctx.player.current()?.id === trackId) return ctx.player.toggle();
		const al = s.data.index.track.get(trackId)?.album;
		const ids = (al?.tk ?? []).map((t) => t.i).filter((i) => ctx.catalog.track(i));
		if (!ctx.catalog.track(trackId)) throw new DraftError("this song is hidden, so the app's player does not have it; show it and publish to listen in the app");
		previewStop();
		await ctx.player.playList(ids, trackId, al.ab);
	}

	function previewStop() {
		preview.pause();
		previewUrl = "";
		paintListening();
	}

	async function previewToggle(url) {
		if (previewUrl === url && !preview.paused) { preview.pause(); paintListening(); return; }
		if (previewUrl !== url) { preview.src = url; previewUrl = url; }
		if (ctx.player?.state.playing) ctx.player.pause();
		try {
			await preview.play();
		} catch (err) {
			previewUrl = "";
			throw new DraftError(`this song could not be played here (${err.message}); its file may not be ready yet`);
		} finally {
			paintListening();
		}
	}
	preview.addEventListener("ended", () => paintListening());
	preview.addEventListener("pause", () => paintListening());

	/** The listen buttons, drawn again in place when what is playing changes. */
	function paintListening() {
		if (!root.isConnected) return;
		for (const b of root.querySelectorAll("[data-adm=play]")) b.outerHTML = String(listenButton(Number(b.dataset.id)));
		for (const b of root.querySelectorAll("[data-adm=preview]")) {
			const on = b.dataset.url === previewUrl && !preview.paused;
			b.classList.toggle("now", b.dataset.url === previewUrl);
			b.setAttribute("aria-label", on ? "Pause" : "Listen");
			b.innerHTML = String(icon(on ? "pause" : "play"));
		}
	}
	const offPlayer = ctx.onPlayer?.((st) => {
		if (!root.isConnected) { offPlayer?.(); preview.pause(); return; }
		if (st.playing && !preview.paused) preview.pause();
		paintListening();
	});


	/* --------------------------------------------------------- publishing ---- */

	async function publish(note) {
		if (!note.trim()) throw new DraftError("write a short note for the changelog");
		s.busy = "Reading the newest files from GitHub…";
		s.error = "";
		render();
		const head = await s.gh.head();
		const want = [DATA.albums, DATA.artists, ...VERSION_FILES.packages, ...VERSION_FILES.locks, VERSION_FILES.changelog];
		const fetched = Object.fromEntries(await Promise.all(want.map(async (p) => [p, (await s.gh.file(p, head)).text])));
		const fresh = { albums: JSON.parse(fetched[DATA.albums]), artists: JSON.parse(fetched[DATA.artists]) };
		const { albums, artists, missing } = applyChanges(fresh, s.draft.changes);
		if (missing.length) throw new DraftError(`some changes no longer apply:\n${missing.map((m) => m.reason).join("\n")}\nRemove them from the draft.`);
		const index = indexData(fresh);
		const lines = s.draft.changes.map((c) => describe(c, index, names()));
		const current = JSON.parse(fetched["package.json"]).version;
		parseVersion(current);
		const next = nextVersion(current);
		const files = releaseFiles(fetched, next, [`${note.trim()} (catalog, ${lines.length} change${lines.length === 1 ? "" : "s"})`]);
		if (s.draft.changes.some((c) => c.kind !== "artist")) files[DATA.albums] = sourceText(albums, fetched[DATA.albums]);
		if (s.draft.changes.some((c) => c.kind === "artist")) files[DATA.artists] = sourceText(artists, fetched[DATA.artists]);
		const title = `release: web ${next} ${note.trim()}`;
		const body = `Catalog changes from the admin page, by ${s.user}.\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\nMerging with "Merge and release" on the admin page releases v${next}.`;
		s.busy = "Opening the pull request…";
		render();
		// One flat name: a branch under a folder ("admin/…") cannot be created
		// while a branch with the folder's name ("admin") exists.
		const branch = `catalog-edit-${next}-${Date.now().toString(36)}`;
		const pr = await s.gh.propose({ parent: head, files, branch, title: `Catalog: ${note.trim()}`, body });
		s.draft.pr = { ...pr, branch, title, body, version: next };
		saveDraft();
		s.busy = "";
		watch();
	}

	/** People without write access: the Worker opens the pull request for them (worker/media/suggest.js). */
	async function sendSuggestion(note) {
		if (!note.trim()) throw new DraftError("write a short note saying what the suggestion corrects");
		s.busy = "Reading the newest files from GitHub…";
		s.error = "";
		render();
		const head = await s.gh.head();
		const want = [DATA.albums, DATA.artists];
		const fetched = Object.fromEntries(await Promise.all(want.map(async (p) => [p, (await s.gh.file(p, head)).text])));
		const fresh = { albums: JSON.parse(fetched[DATA.albums]), artists: JSON.parse(fetched[DATA.artists]) };
		const { albums, artists, missing } = applyChanges(fresh, s.draft.changes);
		if (missing.length) throw new DraftError(`some changes no longer apply:\n${missing.map((m) => m.reason).join("\n")}\nRemove them from the draft.`);
		const lines = s.draft.changes.map((c) => describe(c, indexData(fresh), names()));
		const files = {};
		if (s.draft.changes.some((c) => c.kind !== "artist")) files[DATA.albums] = sourceText(albums, fetched[DATA.albums]);
		if (s.draft.changes.some((c) => c.kind === "artist")) files[DATA.artists] = sourceText(artists, fetched[DATA.artists]);
		s.busy = "Sending the suggestion…";
		render();
		let res;
		try {
			res = await fetch(`${ctx.authUrl}/suggest`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${await session.token()}` },
				body: JSON.stringify({ base: head, note: note.trim(), lines, files }),
				cache: "no-store",
			});
		} catch (err) {
			throw new SignInError(`the suggestion could not be sent (${err.message})`);
		}
		const answer = await res.json().catch(() => null);
		if (!res.ok) throw new SignInError(`the suggestion was not accepted: ${answer?.error ?? `HTTP ${res.status}`}`);
		s.draft.pr = { number: answer.number, url: answer.url, branch: answer.branch, suggestion: true };
		saveDraft();
		s.busy = "";
		ctx.notify(`Sent as suggestion #${answer.number}; an editor reviews it`);
		watch();
	}

	async function loadSuggestions() {
		s.suggestions = await s.gh.suggestions();
		render();
	}

	function watch() {
		clearTimeout(poll);
		const tick = async () => {
			if (!s.draft.pr || !root.isConnected) return;
			try {
				s.pr = await s.gh.status(s.draft.pr.number);
				if (s.pr.merged || s.pr.state === "closed") {
					// Merged (here or on GitHub) or closed: the draft is done.
					if (s.pr.merged) {
						const suggestion = s.draft.pr.suggestion;
						s.draft = { changes: [], pr: null };
						saveDraft();
						ctx.notify(suggestion ? "Your suggestion was merged; it ships with the next release" : "Merged: the release deploys in a few minutes");
						await load();
					}
					return render();
				}
				render();
				const pending = !s.pr.checks.length || s.pr.checks.some((c) => c.status !== "completed");
				if (pending) poll = setTimeout(tick, 10000);
			} catch (err) {
				fail(err);
			}
		};
		tick();
	}

	async function mergeAndRelease() {
		const pr = s.draft.pr;
		s.busy = "Merging…";
		render();
		await s.gh.merge(pr.number, s.pr.head, pr.title, pr.body);
		await s.gh.deleteBranch(pr.branch).catch((err) => console.warn("the branch could not be deleted", err));
		s.draft = { changes: [], pr: null };
		saveDraft();
		s.busy = "";
		ctx.notify(`Merged. ${pr.title.split(" ").slice(0, 3).join(" ")} is being released`);
		await load();
	}

	/* --------------------------------------------------------- statistics ---- */

	async function loadTotals() {
		const res = await fetch(ctx.totalsUrl, { cache: "no-store" });
		if (!res.ok) throw new Error(`GET ${ctx.totalsUrl}: HTTP ${res.status}`);
		s.totals = await res.json();
		if (s.tab === "overview" || s.tab === "stats") render();
	}

	/* ------------------------------------------------------------ members ---- */

	/** The audio Worker's personal-library routes, with this sign-in. */
	async function libraryCall(method, path, body) {
		if (!ctx.libraryUrl) throw new Error("personal libraries are not built into this version");
		let res;
		try {
			res = await account.send((token) => fetch(`${ctx.libraryUrl}${path}`, {
				method,
				headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
				body: body ? JSON.stringify(body) : undefined,
				cache: "no-store",
			}));
		} catch (err) {
			if (err instanceof AccountError) throw new SignInError(err.message);
			throw new SignInError(`the library could not be reached (${err.message})`);
		}
		if (res.status === 204) return null;
		const answer = await res.json().catch(() => null);
		if (!res.ok) throw new SignInError(answer?.error ?? `the library answered HTTP ${res.status}`);
		return answer;
	}

	/* ------------------------------------------------------------- lyrics ---- */

	/*
	 * For the Lyrics right (docs/lyrics.md): songs with open reports, then the
	 * latest edits, each opening the song in the lyrics studio, where its
	 * versions, hiding and restoring are.
	 */
	/** The lyrics routes of the audio Worker (worker/media/lyrics.js), with this sign-in. */
	async function lyricsCall(method, path, body) {
		const base = ctx.libraryUrl ? ctx.libraryUrl.replace(/\/library$/, "/lyrics") : "";
		if (!base) throw new Error("lyrics are not built into this version");
		let res;
		try {
			res = await account.send((token) => fetch(`${base}${path}`, {
				method,
				headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
				body: body ? JSON.stringify(body) : undefined,
				cache: "no-store",
			}));
		} catch (err) {
			if (err instanceof AccountError) throw new SignInError(err.message);
			throw new SignInError(`the lyrics could not be reached (${err.message})`);
		}
		const answer = await res.json().catch(() => null);
		if (!res.ok) throw new SignInError(answer?.error ?? `the lyrics answered HTTP ${res.status}`);
		return answer;
	}

	async function loadLyrics() {
		s.lyrics = await lyricsCall("GET", "/recent");
		render();
	}

	async function loadMembers() {
		s.members = (await libraryCall("GET", "/members")).members;
		render();
	}

	async function loadMemberUploads(id) {
		s.memberUploads = (await libraryCall("GET", `/members/${id}`)).uploads;
		render();
	}

	async function setMember(id, change, done) {
		await libraryCall("POST", `/members/${id}`, change);
		ctx.notify(done);
		await loadMembers();
	}

	async function deleteMemberUpload(id, title) {
		await libraryCall("DELETE", `/uploads/${id}`);
		ctx.notify(`Deleted “${title}”`);
		await Promise.all([loadMembers(), s.memberOpen ? loadMemberUploads(s.memberOpen) : null]);
	}

	const mb = (n) => `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
	const ago = (t) => new Date(t * 1000).toLocaleDateString();

	/** What this person may do here; co-owners (and the owner) may do everything. */
	const may = (right) => s.isOwner || s.rights.has("manage") || s.rights.has(right);

	const RIGHT_NAMES = {
		manage: ["Co-owner", "everything below, and gives or takes any right"],
		review: ["Review publishing", "approves or rejects requests to publish"],
		moderate: ["Moderate members", "blocks members and deletes uploads"],
		storage: ["Storage", "adds files from a folder in storage the owner sets"],
		lyrics: ["Lyrics", "hides lyrics, shows them again, and restores earlier versions"],
	};

	/* ----------------------------------------------------------- requests ---- */

	async function loadRequests() {
		s.requests = await libraryCall("GET", "/requests");
		if (s.jumpReview && s.requests.requests.some((r) => r.id === s.jumpReview)) {
			s.tab = "requests";
			s.reviewing = s.jumpReview;
		}
		s.jumpReview = null;
		render();
	}

	/** The album as the reviewer filled it in on the approval form. */
	function readApproval(formEl) {
		const f = new FormData(formEl);
		return {
			title: f.get("ab"), year: f.get("yr"), lang: Number(f.get("lg")), genres: f.getAll("gr"),
			songs: [...formEl.querySelectorAll("[data-upload]")].map((li) => ({ upload: Number(li.dataset.upload), title: li.querySelector("[name=t]").value, artists: li.querySelector("[name=a]").value })),
		};
	}

	/**
	 * Approves a request and opens the pull request that adds the album to the
	 * catalog. Everything is built and checked first; then the Worker copies
	 * the songs; then the pull request. A request approved earlier whose pull
	 * request was not opened keeps its album id, track ids and files.
	 */
	async function publishRequest(id, formEl) {
		const req = s.requests.requests.find((r) => r.id === id);
		const form = readApproval(formEl);
		s.busy = "Reading the newest catalog from GitHub…";
		s.error = "";
		render();
		const head = await s.gh.head();
		const want = [DATA.albums, DATA.artists, DATA.media, ...(s.canWrite ? [...VERSION_FILES.packages, ...VERSION_FILES.locks, VERSION_FILES.changelog] : [])];
		const fetched = Object.fromEntries(await Promise.all(want.map(async (p) => [p, (await s.gh.file(p, head)).text])));
		const data = { albums: JSON.parse(fetched[DATA.albums]), artists: JSON.parse(fetched[DATA.artists]), media: JSON.parse(fetched[DATA.media]), category: s.data.category };
		const reserved = new Set(s.requests.requests.filter((r) => r.status === "approved" && r.id !== id).flatMap((r) => (r.songs ?? []).map((u) => u.catalogTrack).filter(Boolean)));
		const assigned = req.status === "approved"
			? { album: req.catalogAlbum, tracks: req.songs.map((u) => ({ upload: u.upload, track: u.catalogTrack, key: u.catalogKey })) }
			: null;
		const out = buildPublish(data, req, form, { reserved, assigned });
		if (req.status === "open") {
			s.busy = `Copying ${out.approve.tracks.length} song(s) into the catalog's storage…`;
			render();
			await libraryCall("POST", `/requests/${id}/approve`, out.approve);
		}
		const files = { [DATA.albums]: sourceText(out.albums, fetched[DATA.albums]), [DATA.media]: stringifyMedia(out.media) };
		if (out.newArtists.length) files[DATA.artists] = sourceText(out.artists, fetched[DATA.artists]);
		const note = `Published ${form.title.trim()}`.slice(0, 120);
		s.busy = "Opening the pull request…";
		render();
		let url;
		if (s.canWrite) {
			const current = JSON.parse(fetched["package.json"]).version;
			parseVersion(current);
			const next = nextVersion(current);
			Object.assign(files, releaseFiles(fetched, next, [`${note} (${out.approve.tracks.length} songs, from @${req.login}'s library)`]));
			// The title is the release line, so merging here or on GitHub releases the site and the track paths.
			const title = `release: web+d1 ${next} ${note}`;
			const body = `Publishing request #${id}, approved by ${s.user} on the admin page.\n\n${out.lines.map((l) => `- ${l}`).join("\n")}\n\nThe songs are already copied to ${out.approve.tracks[0].key.split("/").slice(0, -1).join("/")}/. Merging releases v${next}; the member's uploaded copies are removed once the track paths are loaded.`;
			url = (await s.gh.propose({ parent: head, files, branch: `publish-${id}-${Date.now().toString(36)}`, title, body })).url;
		} else {
			url = await suggest({ base: head, note, lines: out.lines, files });
		}
		await libraryCall("POST", `/requests/${id}/pr`, { url });
		s.busy = "";
		// Kept open: its pull request and "Merge and release" are what come next.
		s.reviewing = id;
		ctx.notify(s.canWrite ? "Approved; the pull request is open" : "Approved; sent to the editors as a suggestion");
		await loadRequests();
	}

	/** Sends files as a suggestion (worker/media/suggest.js); answers the pull request's address. */
	async function suggest(payload) {
		let res;
		try {
			res = await fetch(`${ctx.authUrl}/suggest`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${await session.token()}` },
				body: JSON.stringify(payload),
				cache: "no-store",
			});
		} catch (err) {
			throw new SignInError(`the suggestion could not be sent (${err.message})`);
		}
		const answer = await res.json().catch(() => null);
		if (!res.ok) throw new SignInError(`the suggestion was not accepted: ${answer?.error ?? `HTTP ${res.status}`}`);
		return answer.url;
	}

	/** Merges a publishing pull request with its own title, the release line, once its checks pass. */
	async function mergePublished(url) {
		const number = Number(url.split("/").pop());
		s.busy = "Checking the pull request…";
		render();
		const st = await s.gh.status(number);
		if (st.merged) { s.busy = ""; ctx.notify("Already merged"); return loadRequests(); }
		const done = st.checks.length && st.checks.every((c) => c.status === "completed");
		if (!done || !st.checks.every((c) => ["success", "skipped", "neutral"].includes(c.conclusion))) {
			throw new DraftError(done ? "a check failed on the pull request; open it on GitHub" : "the checks are still running; try again in a minute");
		}
		s.busy = "Merging…";
		render();
		await s.gh.merge(number, st.head, st.title, "");
		await s.gh.deleteBranch(st.branch).catch((err) => console.warn("the branch could not be deleted", err));
		s.busy = "";
		ctx.notify("Merged: the release deploys in a few minutes");
		await loadRequests();
	}

	const STATUS_NAMES = { open: "waiting", withdrawn: "withdrawn", rejected: "rejected", approved: "approved, waiting for the release", released: "in the catalog" };

	function applyFixes(id) {
		const check = s.health.find((c) => c.id === id);
		let n = 0;
		for (const f of check.fixes) {
			const before = s.draft.changes.length;
			s.draft.changes = setChange(s.draft.changes, s.data.index, f);
			if (s.draft.changes.length !== before) n += 1;
		}
		saveDraft();
		ctx.notify(`${n} fix(es) added; the draft has ${s.draft.changes.length} change(s)`);
	}

	/* ------------------------------------------------------------- views ---- */

	const when = (sec) => new Date(sec * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
	const LANG_NAMES = { en: "English", my: "Myanmar" };
	const firstName = () => (s.name || s.user || "").split(/\s+/)[0];

	function greeting() {
		const h = new Date().getHours();
		return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
	}

	/** What waits for this person, as the Overview's cards: [section, label, count, line]. */
	function waiting() {
		const out = [];
		if (may("review")) {
			const open = s.requests?.requests.filter((r) => r.status === "open") ?? null;
			out.push(["requests", "Requests to publish", open?.length, open?.length ? `“${open[0].album}”${open.length > 1 ? ` and ${open.length - 1} more` : ""}` : "Nothing waiting"]);
		}
		if (may("lyrics")) {
			const r = s.lyrics?.reports ?? null;
			const p = s.lyrics?.proposals ?? [];
			const first = r?.[0];
			const line = p.length ? `${p.length} proposal${p.length === 1 ? "" : "s"}: the same song` : first ? `“${first.reasons[0]?.reason ?? "reported"}” on ${ctx.catalog.track(first.track)?.title ?? `song ${first.track}`}` : "Nothing to look at";
			out.push(["lyrics", "Lyrics to look at", r ? r.length + p.length : r?.length, line]);
		}
		if (s.canWrite) {
			const n = s.suggestions?.length;
			out.push(["suggestions", "Suggestions", n, n ? `${n === 1 ? "A correction" : "Corrections"} from contributors, on GitHub` : "No open suggestions"]);
		}
		s.health ??= healthChecks(s.data);
		const found = s.health.filter((c) => c.total);
		out.push(["checks", "Data checks", found.reduce((n, c) => n + c.total, 0), found.length ? `${found[0].title}${found.length > 1 ? `, and ${found.length - 1} more check${found.length > 2 ? "s" : ""}` : ""}` : "All clear"]);
		return out;
	}

	function overview() {
		const cards = waiting();
		const need = cards.filter(([id, , n]) => n && id !== "checks").reduce((a, [, , n]) => a + n, 0);
		const n = s.draft.changes.length;
		const recent = (s.lyrics?.edits ?? []).slice(0, 4);
		const t = s.totals;
		let top = null;
		let recentSum = 0;
		if (t) for (const [id, , last] of t.tracks) { recentSum += last; if (!top || last > top[1]) top = [id, last]; }
		return html`<div class="adm-overview">
			<div class="adm-greet"><h1>${greeting()}${firstName() ? `, ${firstName()}` : ""}</h1><span>${need ? `${plural(need, "thing needs", "things need")} you` : "Nothing needs you right now"}</span></div>
			<section class="adm-cards" aria-label="Needs you">${cards.map(([id, label, count, line]) => html`<button class="adm-card-btn" data-adm="tab" data-tab="${id}">
				<span class="adm-card-label">${label}${count ? html`<span class="adm-dot"></span>` : ""}</span>
				<b>${count === undefined || count === null ? "…" : count.toLocaleString()}</b>
				<span class="adm-card-line">${line}</span>
			</button>`)}</section>
			<div class="adm-two">
				<section aria-label="Your draft">
					<div class="adm-h-row"><h2 class="adm-h">Your draft</h2><span class="adm-hint">kept on this device</span></div>
					${s.draft.pr ? html`<p class="adm-line">${s.draft.pr.suggestion ? "Suggestion" : "Pull request"} #${s.draft.pr.number} is open. <button class="link-btn" data-adm="tab" data-tab="draft">Follow it</button></p>`
						: n ? html`<ol class="adm-changes">${s.draft.changes.slice(-5).reverse().map((c) => html`<li><span>${describe(c, s.data.index, names())}</span><button class="link-btn" data-adm="undo" data-i="${s.draft.changes.indexOf(c)}">Undo</button></li>`)}</ol>
							${n > 5 ? html`<p class="adm-hint">and ${plural(n - 5, "more change")}</p>` : ""}
							<div class="adm-actions"><button class="btn primary" data-adm="tab" data-tab="draft">${s.canWrite ? "Review and publish" : "Review and send"}</button></div>`
						: html`<p class="adm-hint">No changes yet. <button class="link-btn" data-adm="find">Find an album or an artist</button> to start.</p>`}
				</section>
				${recent.length ? html`<section aria-label="Lyrics lately">
					<h2 class="adm-h">Lyrics lately</h2>
					<ol class="adm-feed">${recent.map((e) => html`<li><span class="adm-feed-icon">${icon("lyrics")}</span><span><a href="#/lyrics/${e.track}${e.lang ? `?lang=${e.lang}` : ""}"><b>${ctx.catalog.track(e.track)?.title ?? `Song ${e.track}`}</b></a>, version ${e.version}<br><small>${e.by.name}${e.lang ? ` · ${LANG_NAMES[e.lang] ?? e.lang}` : ""} · ${when(e.at)}</small></span></li>`)}</ol>
				</section>` : ""}
			</div>
			<section aria-label="Listening">
				<div class="adm-h-row"><h2 class="adm-h">Listening${t ? `, last ${t.recentDays} days` : ""}</h2><button class="link-btn" data-adm="tab" data-tab="stats">Statistics</button></div>
				<div class="adm-tiles">
					<div class="adm-tile"><span>Plays</span><b>${t ? recentSum.toLocaleString() : "…"}</b></div>
					<div class="adm-tile"><span>Most played</span><b class="adm-tile-text">${top ? html`${ctx.catalog.track(top[0])?.title ?? `#${top[0]}`} <small>${top[1].toLocaleString()}</small>` : "…"}</b></div>
					<div class="adm-tile"><span>Songs with lyrics</span><b>${ctx.lyrics ? ctx.lyrics.size.toLocaleString() : "…"}</b></div>
				</div>
			</section>
		</div>`;
	}

	function statistics() {
		if (!s.totals) return html`<p class="adm-hint">Reading the counted plays…</p>`;
		const rows = s.totals.tracks.map(([id, total, recent]) => ({ id, total, recent, t: ctx.catalog.track(id) }));
		const sum = rows.reduce((a, r) => a + r.total, 0);
		const recentSum = rows.reduce((a, r) => a + r.recent, 0);
		const list = (sorted, key) => html`<ol class="adm-rank">${sorted.slice(0, 25).map((r) => html`<li><span class="adm-row-text"><b>${r.t ? r.t.title : `#${r.id} (not in the catalog)`}</b><small>${r.t ? r.t.album.title : ""}</small></span><span class="num">${r[key].toLocaleString()}</span></li>`)}</ol>`;
		return html`<div class="adm-tiles">
				<div class="adm-tile"><span>Last ${s.totals.recentDays} days</span><b>${recentSum.toLocaleString()}</b></div>
				<div class="adm-tile"><span>Since counting began</span><b>${sum.toLocaleString()}</b></div>
				<div class="adm-tile"><span>Songs played</span><b>${rows.length.toLocaleString()}</b></div>
			</div>
			<div class="adm-two">
				<section><h2 class="adm-h">Last ${s.totals.recentDays} days</h2>${list([...rows].sort((a, b) => b.recent - a.recent), "recent")}</section>
				<section><h2 class="adm-h">Since counting began</h2>${list([...rows].sort((a, b) => b.total - a.total), "total")}</section>
			</div>
			<p class="adm-hint">Updated ${new Date(s.totals.updated * 1000).toLocaleString()}; the Worker caches 5 minutes. <button class="link-btn" data-adm="totals">Read again</button></p>`;
	}

	function suggestionsView() {
		if (!s.suggestions) return html`<p class="adm-hint">Reading the open suggestions…</p>`;
		return html`<p class="adm-lead">Changes sent by people without write access, as pull requests. Review each on GitHub; merging adds it to master, and it ships with the next release.</p>
			${s.suggestions.length ? html`<ul class="adm-rows">${s.suggestions.map((p) => html`<li><a href="${p.url}" target="_blank" rel="noopener"><span class="adm-thumb">${icon("github")}</span><span class="adm-row-text"><b>#${p.number} ${p.title.replace(/^Suggestion: /, "")}</b><small>by @${p.by} · ${new Date(p.created).toLocaleDateString()}</small></span></a></li>`)}</ul>` : html`<p class="adm-hint">No open suggestions.</p>`}
			<p><button class="link-btn" data-adm="suggestions">Check again</button></p>`;
	}

	function lyricsView() {
		const l = s.lyrics;
		if (!l) return html`<p class="adm-hint">Reading the latest lyrics…</p>`;
		const song = (id, lang, sub) => {
			const t = ctx.catalog.track(id);
			const link = `#/lyrics/${id}/studio${lang ? `?lang=${lang}` : ""}`;
			return html`<li><a href="${link}"><span class="adm-thumb">${t ? coverOf(t.album.id) : icon("lyrics")}</span><span class="adm-row-text"><b>${t ? t.title : `Song ${id}`}${lang ? html` <span class="adm-tag">${LANG_NAMES[lang] ?? lang}</span>` : ""}</b>${sub}</span></a></li>`;
		};
		const label = (id) => {
			const t = ctx.catalog.track(id);
			return t ? html`<b>${t.title}</b> <small>${t.album.title} · ${t.artists.map((a) => a.name).slice(0, 2).join(", ")}</small>` : html`<b>Song ${id}</b>`;
		};
		const proposals = l.proposals ?? [];
		return html`${proposals.length ? html`<h2 class="adm-h">Waiting: the same song? · ${proposals.length}</h2>
			<p class="adm-lead">Members say these songs are the same. Compare opens the studio with both side by side, the text to keep suggested; merging makes one text for both.</p>
			<ul class="adm-proposals">${proposals.map((p) => html`<li>
				<span class="adm-row-text"><span>${label(p.track)}</span><span>same as ${label(p.target)}</span><small>by ${p.by}, ${when(p.at)}${p.note ? ` · “${p.note}”` : ""}</small></span>
				<span class="adm-actions"><a class="btn primary" href="#/lyrics/${p.track}/studio?merge=${p.target}&proposal=${p.id}">Compare</a><button class="link-btn" data-adm="proposal-decline" data-id="${p.id}" data-track="${p.track}">Decline…</button></span>
			</li>`)}</ul>` : ""}
			<p class="adm-lead">Each song opens in the lyrics studio, where its versions, hiding and restoring are.</p>
			<h2 class="adm-h">Reported${l.reports.length ? ` · ${l.reports.length}` : ""}</h2>
			${l.reports.length ? html`<ul class="adm-rows">${l.reports.map((r) => song(r.track, r.lang, r.reasons.map((x) => html`<small>“${x.reason}”, ${x.by}, ${when(x.at)}</small>`)))}</ul>` : html`<p class="adm-hint">Nothing reported.</p>`}
			<h2 class="adm-h">Latest edits</h2>
			${l.edits.length ? html`<ul class="adm-rows">${l.edits.map((e) => song(e.track, e.lang, html`<small>Version ${e.version} by ${e.by.name}, ${when(e.at)}${e.note ? `, ${e.note}` : ""}${e.hidden ? " · hidden" : ""}</small>`))}</ul>` : html`<p class="adm-hint">No lyrics yet.</p>`}
			<p><button class="link-btn" data-adm="lyrics-reload">Read again</button></p>`;
	}

	/**
	 * Members of personal libraries, for anyone the owner has given a right:
	 * space and uploads; blocking and deleting with Moderate members; giving
	 * and taking rights for the owner and co-owners.
	 */
	function membersView() {
		if (!s.members) return html`<p class="adm-hint">Reading the members…</p>`;
		return html`<p class="adm-lead">People who have used their own library. Blocking stops their uploads playing at once and can be undone; deleting an upload cannot. The owner's library is private, and nobody can block the owner or change the owner's rights.</p>
			<ul class="adm-members">${s.members.map((m) => html`<li data-blocked="${String(Boolean(m.blocked))}">
				<div class="adm-member">
					<span class="adm-thumb adm-thumb-artist">${m.login.slice(0, 1).toUpperCase()}</span>
					<span class="adm-row-text"><b>${m.login}${m.owner ? html` <span class="adm-tag">owner</span>` : m.rights.map((r) => html` <span class="adm-tag">${RIGHT_NAMES[r]?.[0] ?? r}</span>`)}${m.blocked ? html` <span class="adm-tag danger">blocked</span>` : ""}</b>
					<small>${plural(m.uploads, "upload")} · ${mb(m.used)} · last seen ${ago(m.lastSeen)}${m.blocked ? ` · blocked by ${m.blocked.by}: ${m.blocked.reason}` : ""}</small></span>
				</div>
				${m.owner ? "" : html`<div class="adm-actions">
					${m.uploads && may("moderate") ? html`<button class="btn" data-adm="member-open" data-id="${m.id}" aria-expanded="${String(s.memberOpen === m.id)}">${s.memberOpen === m.id ? "Hide uploads" : "Uploads"}</button>` : ""}
					${!may("moderate") ? "" : m.blocked
						? html`<button class="btn" data-adm="member-unblock" data-id="${m.id}">Unblock</button>`
						: html`<form class="adm-inline" data-form="block" data-id="${m.id}"><input name="reason" required maxlength="200" placeholder="Reason, e.g. spam" aria-label="Reason for blocking ${m.login}"><button class="btn danger" type="submit">Block</button></form>`}
				</div>`}
				${!m.owner && may("manage") ? html`<fieldset class="adm-rights"><legend>Rights of ${m.login}</legend>${Object.entries(RIGHT_NAMES).map(([r, [name, what]]) => html`<label class="adm-chip-check" title="${what}"><input type="checkbox" data-adm="member-right" data-id="${m.id}" data-right="${r}" ${m.rights.includes(r) ? "checked" : ""}>${name}</label>`)}</fieldset>` : ""}
				${!m.owner && may("manage") && m.rights.includes("storage") && !m.rights.includes("manage") ? html`<form class="adm-folder" data-form="folder" data-id="${m.id}"><label class="adm-field"><span>Storage folder</span><input name="folder" value="${m.folder}" spellcheck="false" autocomplete="off" aria-describedby="folder-help-${m.id}"></label><button class="btn" type="submit">Save</button><small id="folder-help-${m.id}">Where in R2 ${m.login} adds files from, e.g. <code>shared/${m.login}/</code>. Empty: <code>private/${m.id}/</code>.</small></form>` : ""}
				${s.memberOpen === m.id ? (s.memberUploads ? html`<ol class="adm-member-uploads">${s.memberUploads.map((u) => html`<li><span>${u.title}<small>${[u.artist, u.album, u.fileName, mb(u.size)].filter(Boolean).join(" · ")}</small></span><button class="link-btn danger" data-adm="upload-delete" data-id="${u.id}" data-title="${u.title}">Delete</button></li>`)}</ol>` : html`<p class="adm-hint">Reading…</p>`) : ""}
			</li>`)}</ul>
			<p><button class="link-btn" data-adm="members-reload">Check again</button></p>`;
	}

	/* The request being looked at: the chosen one, or the first waiting. */
	function requestShown() {
		const list = s.requests?.requests ?? [];
		return list.find((r) => r.id === s.reviewing) ?? (s.reqFilter === "done" ? null : list.find((r) => r.status === "open")) ?? null;
	}

	const duration = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

	/** The request's album as it will be published: every field editable, every song to listen to. */
	function requestPane(r) {
		const cat = s.data.category;
		const years = (r.songs ?? []).map((u) => u.year).filter(Boolean);
		const lang = r.lang || 0;
		const editable = r.status === "open" || (r.status === "approved" && !r.pr);
		const head = html`<span class="adm-kicker">Request from <b>@${r.login ?? r.owner}</b> · asked ${ago(r.created)}${r.songs ? ` · ${plural(r.songs.length, "song")}` : ""} · ${STATUS_NAMES[r.status]}${r.reviewer && r.status !== "open" ? ` by ${r.reviewer}` : ""}</span>`;
		const songs = (r.songs ?? []).map((u) => html`<div class="adm-song adm-song-req" role="row" ${editable ? html`data-upload="${u.upload}"` : ""}>
			<button type="button" class="adm-listen" data-adm="preview" data-url="${u.url}" aria-label="Listen" title="Listen">${icon("play")}</button>
			${editable ? html`<input name="t" value="${u.title}" required aria-label="Title of ${u.fileName}" autocomplete="off">
				<input name="a" value="${u.artist}" list="adm-artists" aria-label="Artists of ${u.fileName}" title="Artist names, separated by commas; a new name is added to the catalog" autocomplete="off">`
				: html`<span>${u.title}</span><span>${u.artist}</span>`}
			<span class="num" title="${u.fileName}">${duration(u.duration)}</span>
		</div>`);
		if (!editable) {
			return html`<div class="adm-item">
				<div class="adm-hero"><div class="adm-hero-text">${head}<h2 class="adm-title-text">${r.album}</h2></div></div>
				${r.note ? html`<p class="adm-quote">“${r.note}”</p>` : ""}
				${r.reason ? html`<p class="adm-quote">Reason: ${r.reason}</p>` : ""}
				${r.pr ? html`<p><a class="text-link" href="${r.pr}" target="_blank" rel="noopener">${r.pr.replace("https://github.com/", "")}</a></p>` : ""}
				${songs.length ? html`<div class="adm-songs" role="table" aria-label="Songs">${songs}</div>` : ""}
				${r.status === "approved" && r.pr && s.canWrite && r.pr.includes(`/${REPO}/pull/`) ? html`<div class="adm-actions"><button class="btn primary" data-adm="req-merge" data-url="${r.pr}">Merge and release</button></div>` : ""}
			</div>`;
		}
		return html`<form class="adm-item" data-form="approve" data-id="${r.id}">
			<div class="adm-hero"><div class="adm-hero-text">
				${head}
				<input class="adm-title" name="ab" value="${r.album}" required aria-label="Album title" autocomplete="off">
				<div class="adm-facts">
					<label class="adm-pill" title="Year (empty: none)"><span>Year</span><input name="yr" type="number" min="1900" max="2100" value="${years[0] ?? ""}" placeholder="none" inputmode="numeric"></label>
					<label class="adm-pill adm-pill-select" title="Language"><select name="lg" required aria-label="Language">${lang ? "" : html`<option value="" selected disabled>Language…</option>`}${cat.lang.filter((l) => l.id).map((l) => html`<option value="${l.id}" ${l.id === lang ? "selected" : ""}>${l.name}</option>`)}</select>${icon("down")}</label>
				</div>
			</div></div>
			${r.note ? html`<p class="adm-quote">“${r.note}”</p>` : ""}
			<div class="adm-facts" data-genres aria-label="Genres">
				<span class="adm-facts-label">Genres</span>
				<label class="adm-genre-add" title="Add a genre">${icon("plus")}<span>Genre</span><select data-adm-genre-add aria-label="Add a genre"><option value="" selected></option>${cat.genre.map((g) => html`<option value="${g.id}">${g.name}</option>`)}</select></label>
			</div>
			<div class="adm-songs" role="table" aria-label="Songs">${songs}</div>
			<datalist id="adm-artists">${s.data.artists.map((a) => html`<option value="${a.name}">`)}</datalist>
			<p class="adm-hint">Listen first: approve only music the member may share. The songs are copied into the catalog's storage under music/, and ${s.canWrite ? "a pull request adds the album; merging it releases the site and the track paths" : "the album goes to the editors as a suggestion"}. The member stays credited in their library.</p>
			<div class="adm-actions adm-actions-end">
				<button class="btn primary" type="submit">${r.status === "approved" ? "Open the pull request" : "Approve and publish"}</button>
				${r.status === "open" ? html`<span class="adm-grow"></span>${s.rejecting === r.id
					? html`<span class="adm-inline"><input name="reason" form="reject-${r.id}" required maxlength="200" placeholder="Reason, e.g. not their recording" aria-label="Reason for declining"><button class="btn danger" type="submit" form="reject-${r.id}">Decline</button><button class="link-btn" type="button" data-adm="reject-cancel">Cancel</button></span>`
					: html`<button class="link-btn" type="button" data-adm="reject-open" data-id="${r.id}">Decline…</button>`}` : ""}
			</div>
		</form>
		${s.rejecting === r.id ? html`<form id="reject-${r.id}" data-form="reject" data-id="${r.id}" hidden></form>` : ""}`;
	}

	function requestsView() {
		if (!s.requests) return html`<p class="adm-hint">Reading the requests…</p>`;
		const list = s.requests.requests;
		const done = s.reqFilter === "done";
		const shown = list.filter((r) => (done ? r.status !== "open" : r.status === "open"));
		const open = requestShown();
		const waitingN = list.filter((r) => r.status === "open").length;
		return html`<div class="adm-split">
			<aside class="adm-split-list" aria-label="Requests">
				<div class="adm-seg" role="tablist">
					<button role="tab" data-adm="req-filter" data-filter="open" aria-selected="${String(!done)}">Waiting${waitingN ? html` <span>${waitingN}</span>` : ""}</button>
					<button role="tab" data-adm="req-filter" data-filter="done" aria-selected="${String(done)}">Decided</button>
				</div>
				${shown.length ? html`<ul class="adm-rows">${shown.map((r) => html`<li><button data-adm="req-open" data-id="${r.id}" aria-current="${String(open?.id === r.id)}"><span class="adm-thumb">${icon("album")}</span><span class="adm-row-text"><b>${r.album}</b><small>@${r.login ?? r.owner}${r.songs ? ` · ${plural(r.songs.length, "song")}` : ""} · ${ago(r.created)}</small></span></button></li>`)}</ul>`
					: html`<p class="adm-hint">${done ? "Nothing decided yet." : "No requests waiting."}</p>`}
				<p><button class="link-btn" data-adm="requests-reload">Check again</button></p>
			</aside>
			<div class="adm-split-main">${open ? requestPane(open) : html`<p class="adm-lead">Members ask to publish an album of their own uploads. Pick one to listen to it and decide.</p>`}</div>
		</div>`;
	}

	function checksView() {
		s.health ??= healthChecks(s.data);
		return html`<p class="adm-lead">Checks of the source data on ${BASE}. Open an item to edit it; some checks add all their fixes to the draft at once.</p>
			${s.health.map((c) => html`<details class="adm-check" ${s.openChecks.has(c.id) ? "open" : ""} data-check="${c.id}">
				<summary><span class="adm-row-text"><b>${c.title}</b><small>${c.help}</small></span><span class="adm-count" data-zero="${String(!c.total)}">${c.total.toLocaleString()}</span></summary>
				${c.fixes ? html`<p><button class="btn" data-adm="fix" data-check="${c.id}">Add all ${c.fixes.length.toLocaleString()} fixes to the draft</button></p>` : ""}
				${c.total ? html`<ul class="adm-check-items">${c.items.map((it) => html`<li><button class="link-btn" data-adm="open" data-kind="${it.open.kind}" data-id="${it.open.id}">${it.label}</button></li>`)}</ul>${c.total > c.items.length ? html`<p class="adm-hint">and ${(c.total - c.items.length).toLocaleString()} more</p>` : ""}` : html`<p class="adm-hint">Nothing to look at.</p>`}
			</details>`)}`;
	}

	function draftView() {
		const n = s.draft.changes.length;
		const pr = s.draft.pr;
		if (pr) {
			const st = s.pr;
			const checks = st?.checks ?? [];
			const done = checks.length && checks.every((c) => c.status === "completed");
			const green = done && checks.every((c) => ["success", "skipped", "neutral"].includes(c.conclusion));
			const checkList = html`<ul class="adm-checks">${checks.length ? checks.map((c) => html`<li data-state="${c.status === "completed" ? c.conclusion : "running"}"><a href="${c.url}" target="_blank" rel="noopener">${c.name}</a>: ${c.status === "completed" ? c.conclusion : "running…"}</li>`) : html`<li data-state="running">Waiting for the checks to start…</li>`}</ul>`;
			if (pr.suggestion) {
				return html`<div class="adm-panel">
					<h2 class="adm-h">Suggestion #${pr.number}</h2>
					<p><a class="text-link" href="${pr.url}" target="_blank" rel="noopener">${pr.url}</a></p>
					<p class="adm-hint">${st?.state === "closed" ? "Closed without merging. Read the comments on GitHub; the draft is kept." : "Waiting for an editor to review it. You can follow and discuss it on GitHub."}</p>
					${checkList}
					<div class="adm-actions"><button class="btn" data-adm="refresh">Check again</button><button class="link-btn danger" data-adm="forget-pr">Forget this suggestion</button></div>
				</div>`;
			}
			return html`<div class="adm-panel">
				<h2 class="adm-h">Pull request #${pr.number}</h2>
				<p><a class="text-link" href="${pr.url}" target="_blank" rel="noopener">${pr.url}</a> · releases v${pr.version}</p>
				${checkList}
				${done && !green ? html`<p class="adm-error">A check failed: open it on GitHub, then fix the draft there or close the pull request.</p>` : ""}
				<div class="adm-actions"><button class="btn primary" data-adm="merge" ${green ? "" : "disabled"}>Merge and release v${pr.version}</button><button class="btn" data-adm="refresh">Check again</button><button class="link-btn danger" data-adm="forget-pr">Forget this pull request</button></div>
			</div>`;
		}
		if (!n) return html`<p class="adm-hint">No changes yet. <button class="link-btn" data-adm="find">Find an album or an artist</button> to start.</p>`;
		return html`<ol class="adm-changes adm-changes-full">${s.draft.changes.map((c, i) => html`<li><span>${describe(c, s.data.index, names())}</span><button class="link-btn" data-adm="open" data-kind="${c.kind === "artist" ? "artist" : "album"}" data-id="${c.kind === "track" ? s.data.index.track.get(c.id)?.album.ui : c.id}">Open</button><button class="link-btn" data-adm="undo" data-i="${i}">Undo</button></li>`)}</ol>
			${s.canWrite ? html`<form class="adm-publish" data-form="publish">
				<label class="adm-field"><span>Note for the changelog and the release</span><input name="note" required maxlength="120" placeholder="Corrected titles and credits" autocomplete="off"></label>
				<div class="adm-actions"><button class="btn primary" type="submit">Publish as a pull request</button><span class="adm-grow"></span><button class="link-btn danger" type="button" data-adm="discard">Discard the draft</button></div>
			</form>` : html`<form class="adm-publish" data-form="suggest">
				<p class="adm-hint">As a ${LEVELS[s.level].name.toLowerCase()}, your changes go to the editors as a suggestion: a pull request in your name that they review before it is released.</p>
				<label class="adm-field"><span>What does it correct?</span><input name="note" required maxlength="120" placeholder="Corrected titles and credits" autocomplete="off"></label>
				<div class="adm-actions"><button class="btn primary" type="submit">Send as a suggestion</button><span class="adm-grow"></span><button class="link-btn danger" type="button" data-adm="discard">Discard the draft</button></div>
			</form>`}`;
	}

	/** The sign-in card, centred on the page: the only thing shown before connecting. */
	function signIn(message = null) {
		return html`<div class="adm-gate"><div class="adm-card">
			<span class="adm-logo logo-tile">${raw(logoMark())}</span>
			<h1>Admin</h1>
			${message ?? html`
				<p class="muted">Edit the catalog through GitHub: every change becomes a pull request on <b>${REPO}</b>, released when merged.</p>
				${s.busy ? html`<p class="adm-busy">${s.busy}</p>` : ""}
				${s.error ? html`<p class="adm-error" role="alert">${s.error}</p>` : ""}
				${ctx.authUrl ? html`${s.signInLink
					? html`<a class="btn primary adm-github" href="${s.signInLink}" target="_blank" rel="noopener" data-adm-open="github">${icon("github")}Sign in with GitHub</a>`
					: html`<button class="btn primary adm-github" data-adm="github" ${s.busy || homeScreenApp() ? "disabled" : ""}>${icon("github")}Sign in with GitHub</button>`}
				<p class="muted adm-small">Editing needs write access to ${REPO}. The sign-in stays on this device.</p>` : ""}
				<details class="adm-howto" data-keep="token" ${s.tokenOpen || !ctx.authUrl ? "open" : ""}><summary>${ctx.authUrl ? "Use a token instead" : "Connect with a token"}</summary>
					<form class="adm-token" data-form="token">
						<label>GitHub token<input name="token" type="password" autocomplete="off" required placeholder="github_pat_…"></label>
						<button class="btn" type="submit">Connect</button>
					</form>
					<ol><li>Open <a class="text-link" href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub, fine-grained tokens</a>.</li>
					<li>Repository access: only <b>${REPO}</b>.</li>
					<li>Permissions: <b>Contents</b> and <b>Pull requests</b> read and write, <b>Checks</b> read. Set an expiry date.</li>
					<li>Paste it here. It stays on this device only.</li></ol>
				</details>`}
		</div></div>`;
	}

	/** GitHub's avatar address at twice the shown size, for sharp photos. */
	const sized = (url) => {
		try { const u = new URL(url); u.searchParams.set("s", "96"); return u.href; } catch { return ""; }
	};

	/*
	 * The sections, as icons with hints in the header, like the lyrics
	 * studio's modes. The draft and suggestions have no icon of their own:
	 * the Draft button and the Overview's cards open them.
	 */
	const SECTIONS = {
		overview: ["Overview", "grid", "Overview: what needs you"],
		// No icon of its own: the find field (an icon on phones) is the way into it.
		catalog: ["Catalog", "album", ""],
		requests: ["Requests", "inbox", "Requests to publish"],
		lyrics: ["Lyrics", "lyrics", "Lyrics: reports and edits"],
		members: ["Members", "people", "Members and rights"],
		checks: ["Checks", "shield", "Checks of the catalog data"],
		stats: ["Statistics", "chart", "Statistics: counted plays"],
		draft: ["Your draft", "draft", ""],
		suggestions: ["Suggestions", "github", ""],
	};

	function sectionShown(id) {
		if (id === "requests") return may("review");
		if (id === "lyrics") return may("lyrics");
		if (id === "members") return s.rights.size > 0;
		if (id === "suggestions") return s.canWrite;
		return true;
	}

	/** Something waiting in a section: a dot on its icon. */
	function sectionCount(id) {
		if (id === "requests") return s.requests?.requests.filter((r) => r.status === "open").length ?? 0;
		if (id === "lyrics") return (s.lyrics?.reports.length ?? 0) + (s.lyrics?.proposals?.length ?? 0);
		return 0;
	}

	/** One line about the person: their level and what they have had released. */
	function status() {
		// The repository's owner is Zaideih's owner (docs/library.md).
		const level = s.isOwner ? "Owner" : LEVELS[s.level]?.name ?? "";
		const d = s.done;
		if (!d) return level;
		if (s.canWrite) {
			const n = d.edits + d.suggestions;
			return `${level} · ${n ? `${plural(n, "catalog edit")} released` : "ready for a first edit"}`;
		}
		return `${level} · ${d.suggestions ? `${plural(d.suggestions, "suggestion")} accepted, thank you` : "every correction helps"}`;
	}

	function subtitle() {
		if (s.busy) return s.busy;
		if (s.tab === "catalog" && s.open) return s.open.kind === "album" ? "Album" : "Artist";
		if (s.tab === "draft") {
			const n = s.draft.changes.length;
			return s.draft.pr ? `${s.draft.pr.suggestion ? "Suggestion" : "Pull request"} #${s.draft.pr.number}` : n ? plural(n, "change") : "Empty";
		}
		return status();
	}

	const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

	/**
	 * The header, the lyrics studio's: the section and a line under it, the
	 * find field, the sections as icons, the draft, and the person's photo,
	 * which opens their menu.
	 */
	/**
	 * Back, inside the admin: an album or artist to the results, a section to
	 * Overview. From Overview, back to the app (phones; the sidebar is there
	 * on wide screens).
	 */
	function backButton() {
		if (s.tab === "catalog" && s.open) return html`<button class="st-icon adm-back" data-adm="close" aria-label="Back to the results" title="Back to the results">${icon("back")}</button>`;
		if (s.tab !== "overview") return html`<button class="st-icon adm-back" data-adm="tab" data-tab="overview" aria-label="Back to Overview" title="Back to Overview">${icon("back")}</button>`;
		return html`<a class="st-icon adm-back adm-back-app" href="#/" aria-label="Back to the app" title="Back to the app">${icon("back")}</a>`;
	}

	function header() {
		const n = s.draft.changes.length;
		const initials = (s.name || s.user || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
		const level = s.isOwner ? "Owner" : LEVELS[s.level]?.name ?? "";
		const draftLabel = s.draft.pr ? `Your draft: ${s.draft.pr.suggestion ? "suggestion" : "pull request"} #${s.draft.pr.number}` : `Your draft: ${plural(n, "change")}`;
		return html`<header class="st-head adm-head">
			${backButton()}
			<div class="st-title"><b>${SECTIONS[s.tab][0]}</b><span>${subtitle()}</span></div>
			<label class="adm-find${s.tab === "catalog" ? " on" : ""}" title="Find an album or an artist (${MAC ? "⌘K" : "Ctrl+K"})">${icon("search")}<input type="search" data-adm="search" data-where="head" value="${s.query}" placeholder="Find an album or artist" aria-label="Find an album or an artist (2 letters or more, or an album id)" autocomplete="off" spellcheck="false"><kbd>${MAC ? "⌘K" : "Ctrl K"}</kbd></label>
			<button class="adm-find-icon${s.tab === "catalog" ? " on" : ""}" data-adm="find" aria-label="Find an album or an artist" title="Find an album or an artist (${MAC ? "⌘K" : "Ctrl+K"})">${icon("search")}</button>
			<div class="st-modes adm-modes" role="tablist" aria-label="Admin">
				${Object.entries(SECTIONS).filter(([id, [, , hint]]) => hint && sectionShown(id)).map(([id, [, ic, hint]]) => {
					const count = sectionCount(id);
					return html`<button role="tab" class="st-mode" data-adm="tab" data-tab="${id}" aria-selected="${String(s.tab === id)}" aria-label="${hint}${count ? `, ${count} waiting` : ""}" title="${hint}${count ? ` · ${count} waiting` : ""}">${icon(ic)}${count ? html`<span class="adm-mode-dot"></span>` : ""}</button>`;
				})}
			</div>
			<button class="adm-draft-btn${s.tab === "draft" ? " on" : ""}" data-adm="tab" data-tab="draft" aria-label="${draftLabel}" title="${draftLabel}" data-empty="${String(!n && !s.draft.pr)}">${icon("draft")}<span class="lbl">Draft</span><span class="n">${s.draft.pr ? `#${s.draft.pr.number}` : n}</span></button>
			<div class="adm-me">
				<button class="adm-me-btn" data-adm="menu" aria-expanded="${String(s.menu)}" aria-label="${s.name || s.user}, ${level}: account and catalog" title="${s.name || s.user} · ${level}">
					${s.avatar ? html`<img class="adm-photo" src="${sized(s.avatar)}" alt="" width="44" height="44" referrerpolicy="no-referrer">` : html`<span class="adm-photo blank">${initials}</span>`}
				</button>
				${s.menu ? html`<div class="adm-menu" role="dialog" aria-label="Account and catalog">
					<div class="adm-menu-who">${s.avatar ? html`<img class="adm-photo" src="${sized(s.avatar)}" alt="" width="44" height="44" referrerpolicy="no-referrer">` : html`<span class="adm-photo blank">${initials}</span>`}<span><b>${s.name || s.user}</b><br>@${s.user} · ${status()}</span></div>
					<p>${s.via === "github" ? "Signed in with GitHub" : "Connected with a token"} on this device. Catalog from ${BASE}${s.data ? html` at <code>${s.data.head.slice(0, 7)}</code>` : ""}, ${REPO}.</p>
					<div class="adm-actions">
						<button class="btn" data-adm="reload">${icon("reload")}Load the newest</button>
						<button class="btn danger" data-adm="logout">${icon("logout")}${s.via === "github" ? "Sign out" : "Disconnect"}</button>
					</div>
				</div>` : ""}
			</div>
		</header>`;
	}

	/** Above the player while editing: the draft in a line, with the way to publish it. */
	function tray() {
		const n = s.draft.changes.length;
		if (!n || s.draft.pr || s.tab === "draft" || s.tab === "overview") return html`<div class="adm-tray" hidden></div>`;
		const last = s.draft.changes[n - 1];
		return html`<div class="adm-tray" role="status">
			<span class="adm-dot" aria-hidden="true"></span>
			<span class="adm-tray-text"><b>${plural(n, "change")} in your draft</b><span> · last: ${describe(last, s.data.index, names())}</span></span>
			<button class="link-btn" data-adm="undo" data-i="${n - 1}">Undo last</button>
			<button class="btn primary" data-adm="tab" data-tab="draft">${s.canWrite ? "Review and publish" : "Review and send"}</button>
		</div>`;
	}

	function messages() {
		return html`<div class="adm-msgs">${s.error ? html`<div class="st-banner st-bad" role="alert"><p>${s.error}</p><button class="link-btn" data-adm="dismiss">Dismiss</button></div>` : ""}</div>`;
	}

	function body() {
		switch (s.tab) {
			case "overview": return overview();
			case "catalog": return catalogView();
			case "draft": return draftView();
			case "suggestions": return suggestionsView();
			case "requests": return requestsView();
			case "lyrics": return lyricsView();
			case "members": return membersView();
			case "checks": return checksView();
			default: return statistics();
		}
	}

	/** The header, the messages and the tray again, leaving the page (and what is typed in it) alone. */
	function refreshChrome() {
		if (!root.isConnected || !root.querySelector(".adm-head")) return;
		root.querySelector(".adm-head").outerHTML = String(header());
		root.querySelector(".adm-msgs").outerHTML = String(messages());
		root.querySelector(".adm-tray").outerHTML = String(tray());
	}

	function render() {
		if (!root.isConnected) return;
		// A render replaces the page; the field being typed in keeps the focus.
		const active = document.activeElement?.closest?.(".admin") ? document.activeElement : null;
		const focusName = active?.dataset.adm ?? null;
		const focusWhere = active?.dataset.where ?? null;
		const focusField = active?.name ? { name: active.name, track: active.closest("[data-track]")?.dataset.track } : null;
		document.title = s.gh && s.data ? `${SECTIONS[s.tab][0]} · Admin` : "Admin";
		if (ctx.desktop) { root.innerHTML = signIn(html`<p>The admin page works in the web app only.</p>`); return; }
		if (ctx.analyticsOn()) {
			root.innerHTML = signIn(html`<p><b>Turn off usage statistics first.</b></p><p class="muted">The GitHub token is kept on this device, and Google's statistics script on the page could read it. Turn statistics off on the <a class="text-link" href="#/about">About</a> page, then come back.</p>`);
			return;
		}
		if (!s.gh || !s.data) { root.innerHTML = signIn(); return; }
		root.innerHTML = html`${header()}
			<div class="adm-page" data-section="${s.tab}">${messages()}${body()}</div>
			${tray()}`;
		if (focusName === "search") {
			const el = root.querySelector(`[data-adm=search][data-where="${focusWhere}"]`);
			el?.focus();
			el?.setSelectionRange(el.value.length, el.value.length);
		} else if (focusField) {
			const scope = focusField.track ? root.querySelector(`[data-track="${focusField.track}"]`) : root;
			scope?.querySelector(`[name="${focusField.name}"]`)?.focus({ preventScroll: true });
		}
	}

	/** Opens a section, reading what it shows. */
	async function openSection(id) {
		s.tab = id;
		s.error = "";
		s.menu = false;
		if (id === "draft" && s.draft.pr) watch();
		render();
		scrollTo(0, 0);
		if (id === "suggestions") await loadSuggestions();
		if (id === "members") await loadMembers();
		if (id === "requests") await loadRequests();
		if (id === "lyrics") await loadLyrics();
		if (id === "stats" && !s.totals) await loadTotals();
	}

	/**
	 * Find: the header's field where it is one (wide screens), else the
	 * Catalog page's own. One field shows at a time (app.css).
	 */
	function find() {
		const head = root.querySelector("[data-adm=search][data-where=head]");
		if (head && head.offsetParent) { head.focus(); head.select(); return; }
		s.open = null;
		openSection("catalog").catch(fail);
		root.querySelector("[data-adm=search][data-where=page]")?.focus();
	}

	/* ------------------------------------------------------------ events ---- */

	// Escape closes the person's menu; Ctrl+K (⌘K) finds. The listener ends with the page.
	const onKey = (e) => {
		if (!root.isConnected) { removeEventListener("keydown", onKey); return; }
		if (e.key === "Escape" && s.menu) { s.menu = false; refreshChrome(); root.querySelector("[data-adm=menu]")?.focus(); }
		else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && s.gh && s.data) { e.preventDefault(); find(); }
	};
	addEventListener("keydown", onKey);
	// Keep the checks open or closed across renders (toggle does not bubble).
	root.addEventListener("toggle", (e) => {
		const id = e.target.dataset?.check;
		if (id) e.target.open ? s.openChecks.add(id) : s.openChecks.delete(id);
		if (e.target.dataset?.keep === "token") s.tokenOpen = e.target.open;
	}, true);
	root.addEventListener("input", (e) => {
		// Typing in the header's field shows the results in Catalog, wherever the page was.
		if (e.target.dataset.adm === "search") { s.query = e.target.value; s.open = null; s.tab = "catalog"; render(); }
	});
	// The album and artist pages keep each field as it changes.
	root.addEventListener("change", (e) => {
		const el = e.target;
		// A request's genres: a chip each, carrying the value for the approval form.
		if (el.matches("[data-adm-genre-add]")) {
			const opt = el.selectedOptions[0];
			if (el.value) {
				el.closest(".adm-genre-add").insertAdjacentHTML("beforebegin", String(html`<button type="button" class="adm-genre" data-adm="req-genre-drop" aria-label="Remove the genre ${opt.text}" title="Remove the genre">${opt.text}${icon("close")}<input type="hidden" name="gr" value="${el.value}"></button>`));
				opt.hidden = true;
			}
			el.value = "";
			return;
		}
		if (!el.closest("[data-form=album], [data-form=artist]") || !el.name) return;
		try {
			if (keepField(el)) { s.error = ""; render(); }
			else { s.error = ""; markKept(el); }
		} catch (err) {
			el.setAttribute("aria-invalid", "true");
			if (el.tagName === "SELECT" && el.name === "gr-add") el.value = "";
			fail(err, { keepPage: true });
		}
	});
	// Enter in a typed field keeps it, as leaving it does.
	root.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && e.target.matches?.("[data-form=album] input, [data-form=artist] input")) { e.preventDefault(); e.target.blur(); }
	});
	root.addEventListener("submit", async (e) => {
		e.preventDefault();
		const form = e.target;
		try {
			if (form.dataset.form === "token") await connect("token", new FormData(form).get("token").trim());
			else if (form.dataset.form === "publish") await publish(new FormData(form).get("note"));
			else if (form.dataset.form === "suggest") await sendSuggestion(new FormData(form).get("note"));
			else if (form.dataset.form === "folder") await setMember(Number(form.dataset.id), { folder: String(new FormData(form).get("folder")).trim() }, "Storage folder saved");
			else if (form.dataset.form === "approve") await publishRequest(Number(form.dataset.id), form);
			else if (form.dataset.form === "reject") {
				await libraryCall("POST", `/requests/${form.dataset.id}/reject`, { reason: new FormData(form).get("reason") });
				ctx.notify("Declined; the member sees your reason");
				s.rejecting = null;
				s.reviewing = null;
				await loadRequests();
			}
			else if (form.dataset.form === "block") await setMember(Number(form.dataset.id), { blocked: true, reason: new FormData(form).get("reason") }, "Blocked");
		} catch (err) {
			fail(err);
		}
	});
	root.addEventListener("click", async (e) => {
		if (e.target.closest("[data-adm-open]")) {
			// The link opens GitHub in its sheet; the page waits for the sign-in, after the tap has done its work.
			setTimeout(() => waitForGitHub().catch(fail), 0);
			return;
		}
		const b = e.target.closest("[data-adm]");
		// Any click outside the person's menu closes it.
		if (s.menu && !e.target.closest(".adm-menu") && b?.dataset.adm !== "menu") { s.menu = false; refreshChrome(); }
		if (!b || b.dataset.adm === "search") return;
		try {
			switch (b.dataset.adm) {
				case "tab": await openSection(b.dataset.tab); break;
				case "find": find(); break;
				case "play": await playSong(Number(b.dataset.id)); break;
				case "preview": await previewToggle(b.dataset.url); break;
				case "req-genre-drop": {
					const v = b.querySelector("[name=gr]").value;
					const opt = b.parentElement.querySelector(`[data-adm-genre-add] option[value="${v}"]`);
					if (opt) opt.hidden = false;
					b.remove();
					break;
				}
				case "genre-drop": removeGenre(b.closest("[data-form]").dataset.id, Number(b.dataset.genre)); render(); break;
				case "requests-reload": s.requests = null; render(); await loadRequests(); break;
				case "req-filter": s.reqFilter = b.dataset.filter; s.reviewing = null; s.rejecting = null; render(); break;
				case "req-open": s.reviewing = Number(b.dataset.id); s.rejecting = null; previewStop(); render(); break;
				case "reject-open": s.rejecting = Number(b.dataset.id); render(); root.querySelector("[name=reason]")?.focus(); break;
				case "reject-cancel": s.rejecting = null; render(); break;
				case "req-merge": await mergePublished(b.dataset.url); break;
				case "suggestions": s.suggestions = null; render(); await loadSuggestions(); break;
				case "members-reload": s.members = null; render(); await loadMembers(); break;
				case "lyrics-reload": s.lyrics = null; render(); await loadLyrics(); break;
				case "proposal-decline": {
					const reason = await ctx.promptText("Why are these not the same song? The member sees it.", "", "Decline");
					if (!reason) break;
					await lyricsCall("POST", `/${b.dataset.track}/decline`, { proposal: Number(b.dataset.id), reason });
					ctx.notify("Declined");
					await loadLyrics();
					break;
				}
				case "member-open": s.memberOpen = s.memberOpen === Number(b.dataset.id) ? null : Number(b.dataset.id); s.memberUploads = null; render(); if (s.memberOpen) await loadMemberUploads(s.memberOpen); break;
				case "member-unblock": await setMember(Number(b.dataset.id), { blocked: false }, "Unblocked"); break;
				case "member-right": {
					const on = b.checked;
					const name = RIGHT_NAMES[b.dataset.right][0];
					await setMember(Number(b.dataset.id), { rights: { [b.dataset.right]: on } }, `${name} ${on ? "given" : "taken"}`);
					break;
				}
				case "upload-delete": await deleteMemberUpload(Number(b.dataset.id), b.dataset.title); break;
				case "menu": s.menu = !s.menu; refreshChrome(); break;
				case "open": s.open = { kind: b.dataset.kind, id: b.dataset.kind === "album" ? b.dataset.id : Number(b.dataset.id) }; await openSection("catalog"); break;
				case "fix": applyFixes(b.dataset.check); render(); break;
				case "reload": s.menu = false; s.health = null; await load(); break;
				case "close": s.open = null; render(); [...root.querySelectorAll("[data-adm=search]")].find((el) => el.offsetParent)?.focus(); break;
				case "undo": s.draft.changes.splice(Number(b.dataset.i), 1); saveDraft(); render(); break;
				case "discard": s.draft.changes = []; saveDraft(); render(); break;
				case "merge": await mergeAndRelease(); break;
				case "refresh": watch(); break;
				case "forget-pr": s.draft.pr = null; s.pr = null; saveDraft(); render(); break;
				case "totals": await loadTotals(); break;
				case "dismiss": s.error = ""; refreshChrome(); break;
				case "logout": await disconnect(); break;
				case "github": await signInWithGitHub(); break;
				default: break;
			}
		} catch (err) {
			fail(err);
		}
	});


	const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
	if (query.has("album")) s.jump = { kind: "album", id: query.get("album"), track: Number(query.get("track")) || null };
	else if (query.has("artist")) s.jump = { kind: "artist", id: Number(query.get("artist")) };
	if (query.has("review")) s.jumpReview = Number(query.get("review"));
	// The link has done its work; Back and reloads land on the plain admin page.
	if (s.jump || s.jumpReview) history.replaceState(history.state, "", "#/admin");
	const saved = store.get(TOKEN_KEY);
	if (ctx.analyticsOn() || ctx.desktop) render();
	else if (query.has("signin") || query.has("signin-error")) finishSignIn(query).catch(fail);
	else if (session.signedIn) connect("github");
	else if (saved) connect("token", saved);
	else prepareSignInLink().catch(fail).finally(render);
}
