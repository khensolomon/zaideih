/**
 * The hidden admin page (#/admin): edit the catalog through GitHub.
 *
 *   Connect      Sign in with GitHub (src/admin/session.js, finished by the
 *                audio Worker), or a fine-grained GitHub token for
 *                khensolomon/zaideih; either is kept on this device only
 *                (localStorage). Refused while Google Analytics is on here,
 *                since a third-party script on the page could read it.
 *   Edit         find an album or artist; change titles, year, language,
 *                genres, song credits, hide songs, artist names and spellings.
 *                Changes collect in a draft on this device (src/admin/draft.js).
 *   Draft        the changes, one line each; publish them as one pull request
 *                with the next version and a changelog section; the checks
 *                run; "Merge and release" squash-merges it with the release
 *                line, so the release workflow deploys it.
 *   Suggestions  people without write access (contributors, guests) send
 *                their draft as a suggestion: the audio Worker opens the pull
 *                request for them (worker/media/suggest.js); editors see the
 *                open ones listed and review them on GitHub.
 *   Requests     members' albums asked to be published (worker/media/requests.js),
 *                for Review publishing: listen, then approve (the Worker copies
 *                the songs into music/, and a pull request adds the album to
 *                the catalog, src/admin/publish.js) or reject with a reason.
 *   Tools        catalog checks (src/admin/health.js).
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
		tab: "edit",
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
	const fail = (err) => {
		s.busy = "";
		s.error = err instanceof GitHubError || err instanceof DraftError || err instanceof SignInError ? err.message : `${err.name}: ${err.message}`;
		// A refused value is the listener's to fix and is shown on the page; anything else also goes to the console.
		if (!(err instanceof DraftError || err instanceof SignInError)) console.error(err);
		render();
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
		s.tab = "edit";
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
		// Editors: the number of open suggestions on the header's Suggestions button.
		if (s.canWrite) loadSuggestions().catch(fail);
	}

	/* ---------------------------------------------------------- editing ---- */

	/** The value as the draft has it (the change, or the source). */
	function draftValue(kind, id, field, source) {
		const c = s.draft.changes.find((x) => x.kind === kind && x.id === id && x.field === field);
		return c ? c.value : source;
	}

	function results() {
		const q = normalize(s.query);
		if (q.length < 2) return { albums: [], artists: [] };
		const albums = s.data.albums.filter((a) => normalize(a.ab).includes(q) || a.ui === s.query.trim()).slice(0, 30);
		const artists = s.data.artists.filter((a) => normalize(a.name).includes(q) || (a.aka && normalize(a.aka).includes(q))).slice(0, 20);
		return { albums, artists };
	}

	function albumEditor(al) {
		const cat = s.data.category;
		const yr = draftValue("album", al.ui, "yr", al.yr?.[0] ?? null);
		const lg = draftValue("album", al.ui, "lg", al.lg);
		const gr = draftValue("album", al.ui, "gr", al.gr);
		return html`<form class="adm-edit" data-form="album" data-id="${al.ui}">
			<h2>Album <small>${al.ui}</small></h2>
			<label>Title<input name="ab" value="${draftValue("album", al.ui, "ab", al.ab)}" required></label>
			<div class="adm-row">
				<label>Year<input name="yr" type="number" min="1900" max="2100" value="${yr ?? ""}" placeholder="none"></label>
				<label>Language<select name="lg">${cat.lang.map((l) => html`<option value="${l.id}" ${l.id === lg ? "selected" : ""}>${l.name}</option>`)}</select></label>
			</div>
			<fieldset><legend>Genres</legend><div class="adm-chips">${cat.genre.map((g) => html`<label class="adm-chip"><input type="checkbox" name="gr" value="${g.id}" ${gr.includes(g.id) ? "checked" : ""}>${g.name}</label>`)}</div></fieldset>
			<h3>Songs</h3>
			<ol class="adm-tracks">${al.tk.map((t) => {
				const artists = draftValue("track", t.i, "a", t.a);
				return html`<li data-track="${t.i}" class="${s.flash === t.i ? "adm-flash" : ""}">
					<input name="t" value="${draftValue("track", t.i, "t", t.t)}" aria-label="Title of song ${t.i}">
					<input name="a" value="${artists.map((a) => s.data.index.artist.get(a)?.name ?? `#${a}`).join(", ")}" list="adm-artists" aria-label="Artists of song ${t.i}" title="Artist names, separated by commas">
					<label class="adm-hide"><input type="checkbox" name="h" ${draftValue("track", t.i, "h", t.h === true) ? "checked" : ""}>Hidden</label>
					<small>#${t.i} · ${t.p.toLocaleString()} plays</small>
				</li>`;
			})}</ol>
			<datalist id="adm-artists">${s.data.artists.map((a) => html`<option value="${a.name}">`)}</datalist>
			<div class="adm-actions"><button class="btn primary" type="submit">Keep in the draft</button><button class="btn" type="button" data-adm="close">Close</button></div>
		</form>`;
	}

	function artistEditor(a) {
		const cat = s.data.category;
		const type = draftValue("artist", a.id, "type", a.type);
		return html`<form class="adm-edit" data-form="artist" data-id="${a.id}">
			<h2>Artist <small>#${a.id}</small></h2>
			<label>Name<input name="name" value="${draftValue("artist", a.id, "name", a.name)}" required></label>
			<label>Also known as<input name="aka" value="${draftValue("artist", a.id, "aka", a.aka ?? "")}"></label>
			<label>Type<select name="type">${cat.artist.map((t) => html`<option value="${t.id}" ${t.id === type ? "selected" : ""}>${t.name}</option>`)}</select></label>
			<label>Other spellings (for search), separated by commas<textarea name="thesaurus" rows="3">${draftValue("artist", a.id, "thesaurus", a.thesaurus ?? []).join(", ")}</textarea></label>
			<div class="adm-actions"><button class="btn primary" type="submit">Keep in the draft</button><button class="btn" type="button" data-adm="close">Close</button></div>
		</form>`;
	}

	/** Keeps a form's fields in the draft; every value is checked first, so a mistake changes nothing. */
	function keepForm(form) {
		const pending = [];
		const change = (kind, id, field, raw) => pending.push({ kind, id, field, value: cleanValue({ kind, field }, raw, s.data.category) });
		const kind = form.dataset.form;
		const f = new FormData(form);
		if (kind === "album") {
			const id = form.dataset.id;
			change("album", id, "ab", f.get("ab"));
			change("album", id, "yr", f.get("yr"));
			change("album", id, "lg", f.get("lg"));
			change("album", id, "gr", f.getAll("gr"));
			for (const li of form.querySelectorAll("[data-track]")) {
				const tid = Number(li.dataset.track);
				change("track", tid, "t", li.querySelector("[name=t]").value);
				const typed = li.querySelector("[name=a]").value.split(",").map((x) => x.trim()).filter(Boolean);
				const ids = typed.map((n) => {
					const m = /^#(\d+)$/.exec(n);
					if (m) return Number(m[1]);
					const hit = s.data.artists.find((a) => a.name === n) ?? s.data.artists.find((a) => normalize(a.name) === normalize(n));
					if (!hit) throw new DraftError(`no artist named "${n}" (song ${tid}); add the artist first or pick a name from the list`);
					return hit.id;
				});
				change("track", tid, "a", ids);
				change("track", tid, "h", li.querySelector("[name=h]").checked);
			}
		} else {
			const id = Number(form.dataset.id);
			change("artist", id, "name", f.get("name"));
			change("artist", id, "aka", f.get("aka"));
			change("artist", id, "type", f.get("type"));
			change("artist", id, "thesaurus", f.get("thesaurus"));
		}
		for (const c of pending) s.draft.changes = setChange(s.draft.changes, s.data.index, c);
		saveDraft();
		ctx.notify(`The draft has ${s.draft.changes.length} change(s)`);
	}

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
		s.busy = "Reading the counted plays…";
		render();
		const res = await fetch(ctx.totalsUrl, { cache: "no-store" });
		if (!res.ok) throw new Error(`GET ${ctx.totalsUrl}: HTTP ${res.status}`);
		s.totals = await res.json();
		s.busy = "";
		render();
	}

	function statistics() {
		if (!s.totals) return html`<p><button class="btn" data-adm="totals">Load the counted plays</button></p>`;
		const rows = s.totals.tracks.map(([id, total, recent]) => ({ id, total, recent, t: ctx.catalog.tracks.get(id) }));
		const sum = rows.reduce((a, r) => a + r.total, 0);
		const recentSum = rows.reduce((a, r) => a + r.recent, 0);
		const list = (sorted, key) => html`<ol class="adm-stats">${sorted.slice(0, 25).map((r) => html`<li><span>${r.t ? r.t.title : `#${r.id} (not in the catalog)`}</span><small>${r.t ? r.t.album.title : ""}</small><b>${r[key].toLocaleString()}</b></li>`)}</ol>`;
		return html`
			<p>${sum.toLocaleString()} plays counted on ${rows.length.toLocaleString()} songs; ${recentSum.toLocaleString()} in the last ${s.totals.recentDays} days. Updated ${new Date(s.totals.updated * 1000).toLocaleString()} (the Worker caches 5 minutes).</p>
			<div class="adm-cols"><section><h3>Last ${s.totals.recentDays} days</h3>${list([...rows].sort((a, b) => b.recent - a.recent), "recent")}</section>
			<section><h3>Since counting began</h3>${list([...rows].sort((a, b) => b.total - a.total), "total")}</section></div>
			<p><button class="btn" data-adm="totals">Refresh</button></p>`;
	}

	/* -------------------------------------------------------- suggestions ---- */

	function suggestionsTab() {
		if (!s.suggestions) return html`<p class="muted">Reading the open suggestions…</p>`;
		return html`<p class="muted">Changes sent by people without write access, as pull requests. Review each on GitHub; merging adds it to master, and it ships with the next release.</p>
			${s.suggestions.length ? html`<ul class="adm-results">${s.suggestions.map((p) => html`<li><a class="adm-sugg" href="${p.url}" target="_blank" rel="noopener"><span>#${p.number} ${p.title.replace(/^Suggestion: /, "")}</span><small>by @${p.by} · ${new Date(p.created).toLocaleDateString()}</small></a></li>`)}</ul>` : html`<p class="muted">No open suggestions.</p>`}
			<p><button class="btn" data-adm="suggestions">Check again</button></p>`;
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
	};

	/**
	 * Members of personal libraries, for anyone the owner has given a right:
	 * space and uploads; blocking and deleting with Moderate members; giving
	 * and taking rights for the owner and co-owners.
	 */
	function membersTab() {
		if (!s.members) return html`<p class="muted">Reading the members…</p>`;
		return html`<p class="muted">People who have used their own library. Blocking stops their uploads playing at once and is reversible; deleting an upload is permanent. The owner's library is private and cannot be opened here; nobody can block the owner or change the owner's rights.</p>
			<ul class="adm-members">${s.members.map((m) => html`<li data-blocked="${String(Boolean(m.blocked))}">
				<div class="adm-member">
					<span><b>${m.login}</b>${m.owner ? html` <span class="adm-tag">owner</span>` : m.rights.map((r) => html` <span class="adm-tag">${RIGHT_NAMES[r]?.[0] ?? r}</span>`)}${m.blocked ? html` <span class="adm-tag danger">blocked</span>` : ""}</span>
					<small>${m.uploads.toLocaleString()} upload${m.uploads === 1 ? "" : "s"} · ${mb(m.used)} · last seen ${ago(m.lastSeen)}${m.blocked ? ` · blocked by ${m.blocked.by}: ${m.blocked.reason}` : ""}</small>
				</div>
				${m.owner ? "" : html`<div class="adm-actions">
					${m.uploads && may("moderate") ? html`<button class="btn" data-adm="member-open" data-id="${m.id}" aria-expanded="${String(s.memberOpen === m.id)}">${s.memberOpen === m.id ? "Hide uploads" : "Uploads"}</button>` : ""}
					${!may("moderate") ? "" : m.blocked
						? html`<button class="btn" data-adm="member-unblock" data-id="${m.id}">Unblock</button>`
						: html`<form class="adm-block" data-form="block" data-id="${m.id}"><input name="reason" required maxlength="200" placeholder="Reason, e.g. spam" aria-label="Reason for blocking ${m.login}"><button class="btn danger" type="submit">Block</button></form>`}
				</div>`}
				${!m.owner && may("manage") ? html`<fieldset class="adm-rights"><legend>Rights of ${m.login}</legend>${Object.entries(RIGHT_NAMES).map(([r, [name, what]]) => html`<label title="${what}"><input type="checkbox" data-adm="member-right" data-id="${m.id}" data-right="${r}" ${m.rights.includes(r) ? "checked" : ""}>${name}</label>`)}</fieldset>` : ""}
				${!m.owner && may("manage") && m.rights.includes("storage") && !m.rights.includes("manage") ? html`<form class="adm-folder" data-form="folder" data-id="${m.id}"><label>Storage folder<input name="folder" value="${m.folder}" spellcheck="false" autocomplete="off" aria-describedby="folder-help-${m.id}"></label><button class="btn" type="submit">Save</button><small id="folder-help-${m.id}">Where in R2 ${m.login} adds files from, e.g. <code>shared/${m.login}/</code>. Empty: <code>private/${m.id}/</code>.</small></form>` : ""}
				${s.memberOpen === m.id ? (s.memberUploads ? html`<ol class="adm-member-uploads">${s.memberUploads.map((u) => html`<li><span>${u.title}<small>${[u.artist, u.album, u.fileName, mb(u.size)].filter(Boolean).join(" · ")}</small></span><button class="link-btn danger" data-adm="upload-delete" data-id="${u.id}" data-title="${u.title}">Delete</button></li>`)}</ol>` : html`<p class="muted">Reading…</p>`) : ""}
			</li>`)}</ul>
			<p><button class="btn" data-adm="members-reload">Check again</button></p>`;
	}

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
		s.reviewing = null;
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

	function approvalForm(r) {
		const cat = s.data.category;
		const years = r.songs.map((u) => u.year).filter(Boolean);
		const lang = r.lang || 0;
		return html`<form class="adm-edit" data-form="approve" data-id="${r.id}">
			<h3>${r.status === "approved" ? "Open the pull request again" : "Approve and publish"}</h3>
			<label>Title<input name="ab" value="${r.album}" required></label>
			<div class="adm-row">
				<label>Year<input name="yr" type="number" min="1900" max="2100" value="${years[0] ?? ""}" placeholder="none"></label>
				<label>Language<select name="lg" required>${lang ? "" : html`<option value="" selected disabled>Choose…</option>`}${cat.lang.filter((l) => l.id).map((l) => html`<option value="${l.id}" ${l.id === lang ? "selected" : ""}>${l.name}</option>`)}</select></label>
			</div>
			<fieldset><legend>Genres</legend><div class="adm-chips">${cat.genre.map((g) => html`<label class="adm-chip"><input type="checkbox" name="gr" value="${g.id}">${g.name}</label>`)}</div></fieldset>
			<ol class="adm-tracks">${r.songs.map((u) => html`<li data-upload="${u.upload}">
				<input name="t" value="${u.title}" required aria-label="Title of ${u.fileName}">
				<input name="a" value="${u.artist}" list="adm-artists" aria-label="Artists of ${u.fileName}" title="Artist names, separated by commas; a new name is added to the catalog">
				<small>${u.fileName} · ${Math.floor(u.duration / 60)}:${String(Math.round(u.duration % 60)).padStart(2, "0")}</small>
			</li>`)}</ol>
			<datalist id="adm-artists">${s.data.artists.map((a) => html`<option value="${a.name}">`)}</datalist>
			<p class="muted">The songs are copied into the catalog's storage under music/, and ${s.canWrite ? "a pull request adds the album; merging it releases the site and the track paths" : "the album goes to the editors as a suggestion"}. The member stays credited in their library.</p>
			<div class="adm-actions"><button class="btn primary" type="submit">${r.status === "approved" ? "Open the pull request" : "Approve and publish"}</button><button class="btn" type="button" data-adm="req-close">Close</button></div>
		</form>`;
	}

	function requestsTab() {
		if (!s.requests) return html`<p class="muted">Reading the requests…</p>`;
		const list = s.requests.requests;
		const open = list.filter((r) => r.status === "open");
		const rest = list.filter((r) => r.status !== "open");
		const item = (r) => html`<li class="adm-request" data-status="${r.status}">
			<div class="adm-member">
				<span><b>${r.album}</b> <span class="adm-tag">${STATUS_NAMES[r.status]}</span></span>
				<small>@${r.login ?? r.owner} · asked ${ago(r.created)}${r.songs ? ` · ${r.songs.length} song${r.songs.length === 1 ? "" : "s"}` : ""}${r.reviewer && r.status !== "open" ? ` · ${r.status} by ${r.reviewer}` : ""}</small>
				${r.note ? html`<p class="adm-note">“${r.note}”</p>` : ""}
				${r.reason ? html`<p class="adm-note">Reason: ${r.reason}</p>` : ""}
				${r.pr ? html`<p><a class="text-link" href="${r.pr}" target="_blank" rel="noopener">${r.pr.replace("https://github.com/", "")}</a></p>` : ""}
			</div>
			${r.songs && (r.status === "open" || r.status === "approved") && s.reviewing !== r.id ? html`<ol class="adm-listen">${r.songs.map((u) => html`<li><span>${u.title}<small>${[u.artist, u.fileName].filter(Boolean).join(" · ")}</small></span><audio controls preload="none" src="${u.url}"></audio></li>`)}</ol>` : ""}
			${s.reviewing === r.id ? approvalForm(r) : html`<div class="adm-actions">
				${r.status === "open" ? html`<button class="btn primary" data-adm="req-review" data-id="${r.id}">Approve…</button>
					<form class="adm-block" data-form="reject" data-id="${r.id}"><input name="reason" required maxlength="200" placeholder="Reason, e.g. not their recording" aria-label="Reason for rejecting ${r.album}"><button class="btn danger" type="submit">Reject</button></form>` : ""}
				${r.status === "approved" && !r.pr ? html`<button class="btn primary" data-adm="req-review" data-id="${r.id}">Open the pull request</button>` : ""}
				${r.status === "approved" && r.pr && s.canWrite && r.pr.includes(`/${REPO}/pull/`) ? html`<button class="btn" data-adm="req-merge" data-url="${r.pr}">Merge and release</button>` : ""}
			</div>`}
		</li>`;
		return html`<p class="muted">Members ask to publish an album of their own uploads. Listen first: approve only music they may share. Approving copies the songs into the catalog; rejecting gives them back to the member with your reason.</p>
			${open.length ? html`<ul class="adm-members">${open.map(item)}</ul>` : html`<p class="muted">No requests waiting.</p>`}
			${rest.length ? html`<h3>Decided</h3><ul class="adm-members">${rest.map(item)}</ul>` : ""}
			<p><button class="btn" data-adm="requests-reload">Check again</button></p>`;
	}

	/* -------------------------------------------------------------- tools ---- */

	function tools() {
		s.health ??= healthChecks(s.data);
		return html`<p class="muted">Checks of the source data on ${BASE}. Open an item to edit it; some checks can add all their fixes to the draft at once.</p>
			${s.health.map((c) => html`<details class="adm-check" ${s.openChecks.has(c.id) ? "open" : ""} data-check="${c.id}">
				<summary><b>${c.title}</b><span class="adm-count" data-zero="${String(!c.total)}">${c.total.toLocaleString()}</span></summary>
				<p class="muted">${c.help}</p>
				${c.fixes ? html`<p><button class="btn" data-adm="fix" data-check="${c.id}">Add all ${c.fixes.length.toLocaleString()} fixes to the draft</button></p>` : ""}
				${c.total ? html`<ul class="adm-results">${c.items.map((it) => html`<li><button data-adm="open" data-kind="${it.open.kind}" data-id="${it.open.id}">${it.label}</button></li>`)}</ul>${c.total > c.items.length ? html`<p class="muted">and ${(c.total - c.items.length).toLocaleString()} more</p>` : ""}` : html`<p class="muted">Nothing to look at.</p>`}
			</details>`)}`;
	}

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

	function draftTab() {
		const n = s.draft.changes.length;
		const pr = s.draft.pr;
		if (pr) {
			const st = s.pr;
			const checks = st?.checks ?? [];
			const done = checks.length && checks.every((c) => c.status === "completed");
			const green = done && checks.every((c) => ["success", "skipped", "neutral"].includes(c.conclusion));
			if (pr.suggestion) {
				return html`<div class="panel">
					<h3>Suggestion #${pr.number}</h3>
					<p><a class="text-link" href="${pr.url}" target="_blank" rel="noopener">${pr.url}</a></p>
					<p class="muted">${st?.state === "closed" ? "Closed without merging. Read the comments on GitHub; the draft is kept." : "Waiting for an editor to review it. You can follow and discuss it on GitHub."}</p>
					<ul class="adm-checks">${checks.map((c) => html`<li data-state="${c.status === "completed" ? c.conclusion : "running"}"><a href="${c.url}" target="_blank" rel="noopener">${c.name}</a>: ${c.status === "completed" ? c.conclusion : "running…"}</li>`)}</ul>
					<div class="adm-actions"><button class="btn" data-adm="refresh">Check again</button><button class="btn danger" data-adm="forget-pr">Forget this suggestion</button></div>
				</div>`;
			}
			return html`<div class="panel">
				<h3>Pull request #${pr.number}</h3>
				<p><a class="text-link" href="${pr.url}" target="_blank" rel="noopener">${pr.url}</a> · will release v${pr.version}</p>
				<ul class="adm-checks">${checks.length ? checks.map((c) => html`<li data-state="${c.status === "completed" ? c.conclusion : "running"}"><a href="${c.url}" target="_blank" rel="noopener">${c.name}</a>: ${c.status === "completed" ? c.conclusion : "running…"}</li>`) : html`<li data-state="running">Waiting for the checks to start…</li>`}</ul>
				${done && !green ? html`<p class="adm-error">A check failed: open it on GitHub, then fix the draft there or close the pull request.</p>` : ""}
				<div class="adm-actions"><button class="btn primary" data-adm="merge" ${green ? "" : "disabled"}>Merge and release v${pr.version}</button><button class="btn" data-adm="refresh">Check again</button><button class="btn danger" data-adm="forget-pr">Forget this pull request</button></div>
			</div>`;
		}
		const index = s.data.index;
		return html`
			${n ? html`<ol class="adm-draft">${s.draft.changes.map((c, i) => html`<li><span>${describe(c, index, names())}</span><button class="link-btn" data-adm="undo" data-i="${i}">Undo</button></li>`)}</ol>` : html`<p class="muted">No changes yet. Find an album or an artist on the Edit tab.</p>`}
			${n && s.canWrite ? html`<form class="adm-publish" data-form="publish">
				<label>Note for the changelog and the release<input name="note" required maxlength="120" placeholder="Corrected titles and credits"></label>
				<div class="adm-actions"><button class="btn primary" type="submit">Publish as a pull request</button><button class="btn danger" type="button" data-adm="discard">Discard the draft</button></div>
			</form>` : ""}
			${n && !s.canWrite ? html`<form class="adm-publish" data-form="suggest">
				<p class="muted">As a ${LEVELS[s.level].name.toLowerCase()}, your changes go to the editors as a suggestion: a pull request in your name that they review before it is released.</p>
				<label>What does it correct?<input name="note" required maxlength="120" placeholder="Corrected titles and credits"></label>
				<div class="adm-actions"><button class="btn primary" type="submit">Send as a suggestion</button><button class="btn danger" type="button" data-adm="discard">Discard the draft</button></div>
			</form>` : ""}`;
	}

	function editTab() {
		const r = results();
		const open = s.open && (s.open.kind === "album" ? s.data.index.album.get(s.open.id) : s.data.index.artist.get(s.open.id));
		return html`
			${open ? (s.open.kind === "album" ? albumEditor(open) : artistEditor(open)) : html`
				${r.albums.length ? html`<h3>Albums</h3><ul class="adm-results">${r.albums.map((a) => html`<li><button data-adm="open" data-kind="album" data-id="${a.ui}">${a.ab}<small>${a.yr?.[0] ?? ""} · ${a.tk.length} songs</small></button></li>`)}</ul>` : ""}
				${r.artists.length ? html`<h3>Artists</h3><ul class="adm-results">${r.artists.map((a) => html`<li><button data-adm="open" data-kind="artist" data-id="${a.id}">${a.name}<small>${a.aka ?? ""}</small></button></li>`)}</ul>` : ""}`}`;
	}

	/** The sign-in card, centred on the page: the only thing shown before connecting. */
	function signIn(message = null) {
		return html`<div class="adm-gate"><div class="adm-card">
			<span class="adm-logo logo-tile">${raw(logoMark())}</span>
			<h1>Zaideih admin</h1>
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

	/** The floating header: who is connected, where the data comes from, and the sections. */
	/** GitHub's avatar address at twice the shown size, for sharp photos. */
	const sized = (url) => {
		try { const u = new URL(url); u.searchParams.set("s", "96"); return u.href; } catch { return ""; }
	};

	const TABS = { edit: "Edit", draft: "Draft", suggestions: "Suggestions", requests: "Requests", members: "Members", tools: "Tools", stats: "Statistics" };

	/** One line about the person: their level and what they have had released. */
	function status() {
		// The repository's owner is Zaideih's owner (docs/library.md).
		const level = s.isOwner ? "Owner" : LEVELS[s.level]?.name ?? "";
		const d = s.done;
		const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
		if (!d) return html`<strong>${level}</strong>`;
		if (s.canWrite) {
			const n = d.edits + d.suggestions;
			return html`<strong>${level}</strong> · ${n ? `${plural(n, "catalog edit", "catalog edits")} released` : "ready for a first edit"}`;
		}
		return html`<strong>${level}</strong> · ${d.suggestions ? `${plural(d.suggestions, "suggestion", "suggestions")} accepted, thank you` : "every correction helps"}`;
	}

	/**
	 * The header: the person (photo, name, status), the search on Edit, and
	 * the sections as text tabs. The photo opens the person's menu.
	 */
	function header() {
		const n = s.draft.changes.length;
		const sugg = s.suggestions?.length ?? 0;
		const tab = (id, count = "") => html`<button role="tab" data-adm="tab" data-tab="${id}" aria-selected="${String(s.tab === id)}">${TABS[id]}${count ? html`<span class="n">${count}</span>` : ""}</button>`;
		const initials = (s.name || s.user || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
		return html`<header class="adm-head">
			<div class="adm-me">
				<button class="adm-me-btn" data-adm="menu" aria-expanded="${String(s.menu)}" aria-label="Account and catalog">
					${s.avatar ? html`<img class="adm-photo" src="${sized(s.avatar)}" alt="" width="48" height="48">` : html`<span class="adm-photo blank">${initials}</span>`}
				</button>
				<div class="adm-name"><b>${s.name || s.user}</b><span class="adm-status">${status()}</span></div>
				${s.menu ? html`<div class="adm-menu" role="dialog" aria-label="Account and catalog">
					<p><b style="color:var(--ink)">@${s.user}</b><br>${s.via === "github" ? "Signed in with GitHub" : "Connected with a token"} on this device.</p>
					<p>Catalog from ${BASE}${s.data ? html` at <code>${s.data.head.slice(0, 7)}</code>` : ""}, ${REPO}.</p>
					<div class="adm-actions">
						<button class="btn" data-adm="reload">Load the newest</button>
						<button class="btn danger" data-adm="logout">${s.via === "github" ? "Sign out" : "Disconnect"}</button>
					</div>
				</div>` : ""}
			</div>
			${s.tab === "edit" ? html`<input class="adm-search" type="search" data-adm="search" value="${s.query}" placeholder="Find an album or an artist" aria-label="Find an album or an artist (2 letters or more, or an album id)">` : ""}
			<nav class="adm-tabs" role="tablist" aria-label="Admin sections">
				${tab("edit")}
				${tab("draft", s.draft.pr ? "#" + s.draft.pr.number : n ? String(n) : "")}
				${s.canWrite ? tab("suggestions", sugg ? String(sugg) : "") : ""}
				${may("review") ? tab("requests", s.requests ? String(s.requests.requests.filter((r) => r.status === "open").length || "") : "") : ""}
				${s.rights.size ? tab("members", s.members ? String(s.members.length) : "") : ""}
				${tab("tools")}
				${tab("stats")}
			</nav>
		</header>`;
	}

	function render() {
		if (!root.isConnected) return;
		// A render replaces the page; the field being typed in keeps the focus.
		const active = document.activeElement?.closest?.(".admin") ? document.activeElement : null;
		const focusName = active?.dataset.adm ?? null;
		const focusField = active?.name ? { name: active.name, track: active.closest("[data-track]")?.dataset.track } : null;
		if (ctx.desktop) { root.innerHTML = signIn(html`<p>The admin page works in the web app only.</p>`); return; }
		if (ctx.analyticsOn()) {
			root.innerHTML = signIn(html`<p><b>Turn off usage statistics first.</b></p><p class="muted">The GitHub token is kept on this device, and Google's statistics script on the page could read it. Turn statistics off on the <a class="text-link" href="#/about">About</a> page, then come back.</p>`);
			return;
		}
		if (!s.gh || !s.data) { root.innerHTML = signIn(); return; }
		root.innerHTML = html`${header()}
			${s.busy ? html`<p class="muted adm-busy">${s.busy}</p>` : ""}
			${s.error ? html`<p class="adm-error" role="alert">${s.error} <button class="link-btn" data-adm="dismiss">Dismiss</button></p>` : ""}
			<section class="adm-body">${s.tab === "edit" ? editTab() : s.tab === "draft" ? draftTab() : s.tab === "suggestions" ? suggestionsTab() : s.tab === "members" ? membersTab() : s.tab === "requests" ? requestsTab() : s.tab === "tools" ? tools() : statistics()}</section>`;
		if (focusName === "search") {
			const el = root.querySelector("[data-adm=search]");
			el?.focus();
			el?.setSelectionRange(el.value.length, el.value.length);
		} else if (focusField) {
			const scope = focusField.track ? root.querySelector(`[data-track="${focusField.track}"]`) : root;
			scope?.querySelector(`[name="${focusField.name}"]`)?.focus({ preventScroll: true });
		}
	}

	/* ------------------------------------------------------------ events ---- */

	// Escape closes the person's menu wherever the focus is; the listener ends with the page.
	const onKey = (e) => {
		if (!root.isConnected) { removeEventListener("keydown", onKey); return; }
		if (e.key === "Escape" && s.menu) { s.menu = false; render(); root.querySelector("[data-adm=menu]")?.focus(); }
	};
	addEventListener("keydown", onKey);
	// Keep the Tools checks open or closed across renders (toggle does not bubble).
	root.addEventListener("toggle", (e) => {
		const id = e.target.dataset?.check;
		if (id) e.target.open ? s.openChecks.add(id) : s.openChecks.delete(id);
		if (e.target.dataset?.keep === "token") s.tokenOpen = e.target.open;
	}, true);
	root.addEventListener("input", (e) => {
		if (e.target.dataset.adm === "search") { s.query = e.target.value; s.open = null; render(); }
	});
	root.addEventListener("submit", async (e) => {
		e.preventDefault();
		const form = e.target;
		try {
			if (form.dataset.form === "token") await connect("token", new FormData(form).get("token").trim());
			else if (form.dataset.form === "album" || form.dataset.form === "artist") { keepForm(form); s.error = ""; render(); }
			else if (form.dataset.form === "publish") await publish(new FormData(form).get("note"));
			else if (form.dataset.form === "suggest") await sendSuggestion(new FormData(form).get("note"));
			else if (form.dataset.form === "folder") await setMember(Number(form.dataset.id), { folder: String(new FormData(form).get("folder")).trim() }, "Storage folder saved");
			else if (form.dataset.form === "approve") await publishRequest(Number(form.dataset.id), form);
			else if (form.dataset.form === "reject") {
				await libraryCall("POST", `/requests/${form.dataset.id}/reject`, { reason: new FormData(form).get("reason") });
				ctx.notify("Rejected; the member sees your reason");
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
		if (s.menu && !e.target.closest(".adm-menu") && b?.dataset.adm !== "menu") { s.menu = false; render(); }
		if (!b || b.dataset.adm === "search") return;
		try {
			switch (b.dataset.adm) {
				case "tab":
					s.tab = b.dataset.tab; s.error = "";
					if (s.tab === "draft" && s.draft.pr) watch();
					render();
					if (s.tab === "suggestions") await loadSuggestions();
					if (s.tab === "members") await loadMembers();
					if (s.tab === "requests") await loadRequests();
					break;
				case "requests-reload": s.requests = null; render(); await loadRequests(); break;
				case "req-review": s.reviewing = Number(b.dataset.id); render(); root.querySelector("[data-form=approve]")?.scrollIntoView({ block: "start" }); break;
				case "req-close": s.reviewing = null; render(); break;
				case "req-merge": await mergePublished(b.dataset.url); break;
				case "suggestions": s.suggestions = null; render(); await loadSuggestions(); break;
				case "members-reload": s.members = null; render(); await loadMembers(); break;
				case "member-open": s.memberOpen = s.memberOpen === Number(b.dataset.id) ? null : Number(b.dataset.id); s.memberUploads = null; render(); if (s.memberOpen) await loadMemberUploads(s.memberOpen); break;
				case "member-unblock": await setMember(Number(b.dataset.id), { blocked: false }, "Unblocked"); break;
				case "member-right": {
					const on = b.checked;
					const name = RIGHT_NAMES[b.dataset.right][0];
					await setMember(Number(b.dataset.id), { rights: { [b.dataset.right]: on } }, `${name} ${on ? "given" : "taken"}`);
					break;
				}
				case "upload-delete": await deleteMemberUpload(Number(b.dataset.id), b.dataset.title); break;
				case "menu": s.menu = !s.menu; render(); break;
				case "open": s.tab = "edit"; s.open = { kind: b.dataset.kind, id: b.dataset.kind === "album" ? b.dataset.id : Number(b.dataset.id) }; render(); scrollTo(0, 0); break;
				case "fix": applyFixes(b.dataset.check); render(); break;
				case "reload": s.menu = false; s.health = null; await load(); break;
				case "close": s.open = null; render(); break;
				case "undo": s.draft.changes.splice(Number(b.dataset.i), 1); saveDraft(); render(); break;
				case "discard": s.draft.changes = []; saveDraft(); render(); break;
				case "merge": await mergeAndRelease(); break;
				case "refresh": watch(); break;
				case "forget-pr": s.draft.pr = null; s.pr = null; saveDraft(); render(); break;
				case "totals": await loadTotals(); break;
				case "dismiss": s.error = ""; render(); break;
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
