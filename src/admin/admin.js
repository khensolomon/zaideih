/**
 * The hidden admin page (#/admin): edit the catalog through GitHub.
 *
 *   Connect      a fine-grained GitHub token for khensolomon/zaideih, kept on
 *                this device only (localStorage). Refused while Google
 *                Analytics is on here, since a third-party script on the page
 *                could read the token.
 *   Edit         find an album or artist; change titles, year, language,
 *                genres, song credits, hide songs, artist names and spellings.
 *                Changes collect in a draft on this device (src/admin/draft.js).
 *   Draft        the changes, one line each; publish them as one pull request
 *                with the next version and a changelog section; the checks
 *                run; "Merge and release" squash-merges it with the release
 *                line, so the release workflow deploys it.
 *   Statistics   counted plays from the audio Worker (GET /plays).
 *
 * Loaded as its own bundle only when the page is opened (tools/build.mjs).
 */
import { html } from "../core/html.js";
import { normalize } from "../core/text.js";
import { nextVersion, parseVersion, releaseFiles, VERSION_FILES } from "../../tools/lib/version.mjs";
import { applyChanges, cleanValue, describe, DraftError, indexData, setChange, sourceText } from "./draft.js";
import { BASE, createGitHub, GitHubError, REPO } from "./github.js";

const TOKEN_KEY = "zaideih.admin.token";
const DRAFT_KEY = "zaideih.admin.draft";
const DATA = { albums: "assets/data/albums.json", artists: "assets/data/artist.name.json", category: "assets/data/category.json" };
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
		gh: null,
		user: null,
		data: null,       // { head, albums, artists, category, index }
		draft: store.get(DRAFT_KEY) ?? { changes: [], pr: null },
		query: "",
		open: null,       // { kind: "album" | "artist", id }
		busy: "",
		error: "",
		pr: null,         // live status of the open pull request
		totals: null,
	};
	let poll = 0;

	const saveDraft = () => store.set(DRAFT_KEY, s.draft);
	const fail = (err) => {
		s.busy = "";
		s.error = err instanceof GitHubError || err instanceof DraftError ? err.message : `${err.name}: ${err.message}`;
		// A refused value is the listener's to fix and is shown on the page; anything else also goes to the console.
		if (!(err instanceof DraftError)) console.error(err);
		render();
	};

	const names = () => ({
		artist: (id) => s.data?.index.artist.get(id)?.name,
		lang: (id) => s.data?.category.lang.find((l) => l.id === id)?.name,
		genre: (id) => s.data?.category.genre.find((g) => g.id === id)?.name,
		type: (id) => s.data?.category.artist.find((t) => t.id === id)?.name,
	});

	async function connect(token) {
		s.busy = "Checking the token…";
		s.error = "";
		render();
		try {
			const gh = createGitHub(token);
			const who = await gh.whoami();
			if (!who.canWrite) throw new Error(`${who.login} cannot write to ${REPO}; give the token Contents and Pull requests (read and write) on that repository`);
			store.set(TOKEN_KEY, token);
			s.gh = gh;
			s.user = who.login;
			await load();
		} catch (err) {
			fail(err);
		}
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
		render();
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
				return html`<li data-track="${t.i}">
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

	function watch() {
		clearTimeout(poll);
		const tick = async () => {
			if (!s.draft.pr || !root.isConnected) return;
			try {
				s.pr = await s.gh.status(s.draft.pr.number);
				if (s.pr.merged || s.pr.state === "closed") {
					// Merged (here or on GitHub) or closed: the draft is done.
					if (s.pr.merged) { s.draft = { changes: [], pr: null }; saveDraft(); ctx.notify("Merged: the release deploys in a few minutes"); await load(); }
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

	/* ------------------------------------------------------------- views ---- */

	function draftTab() {
		const n = s.draft.changes.length;
		const pr = s.draft.pr;
		if (pr) {
			const st = s.pr;
			const checks = st?.checks ?? [];
			const done = checks.length && checks.every((c) => c.status === "completed");
			const green = done && checks.every((c) => ["success", "skipped", "neutral"].includes(c.conclusion));
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
			${n ? html`<form class="adm-publish" data-form="publish">
				<label>Note for the changelog and the release<input name="note" required maxlength="120" placeholder="Corrected titles and credits"></label>
				<div class="adm-actions"><button class="btn primary" type="submit">Publish as a pull request</button><button class="btn danger" type="button" data-adm="discard">Discard the draft</button></div>
			</form>` : ""}`;
	}

	function editTab() {
		const r = results();
		const open = s.open && (s.open.kind === "album" ? s.data.index.album.get(s.open.id) : s.data.index.artist.get(s.open.id));
		return html`
			<input class="adm-search" type="search" data-adm="search" value="${s.query}" placeholder="Find an album or an artist (2 letters or more, or an album id)" aria-label="Find an album or an artist">
			${open ? (s.open.kind === "album" ? albumEditor(open) : artistEditor(open)) : html`
				${r.albums.length ? html`<h3>Albums</h3><ul class="adm-results">${r.albums.map((a) => html`<li><button data-adm="open" data-kind="album" data-id="${a.ui}">${a.ab}<small>${a.yr?.[0] ?? ""} · ${a.tk.length} songs</small></button></li>`)}</ul>` : ""}
				${r.artists.length ? html`<h3>Artists</h3><ul class="adm-results">${r.artists.map((a) => html`<li><button data-adm="open" data-kind="artist" data-id="${a.id}">${a.name}<small>${a.aka ?? ""}</small></button></li>`)}</ul>` : ""}`}`;
	}

	function render() {
		if (!root.isConnected) return;
		const focusName = document.activeElement?.closest?.(".admin") ? document.activeElement.dataset.adm : null;
		const head = html`<h1>Admin</h1>`;
		if (ctx.desktop) { root.innerHTML = html`${head}<p>The admin page works in the web app only.</p>`; return; }
		if (ctx.analyticsOn()) {
			root.innerHTML = html`${head}<div class="panel"><h3>Turn off usage statistics first</h3><p>The GitHub token is kept on this device, and Google's statistics script on the page could read it. Turn statistics off on the <a class="text-link" href="#/about">About</a> page, then come back.</p></div>`;
			return;
		}
		if (!s.gh) {
			root.innerHTML = html`${head}
				${s.busy ? html`<p class="muted">${s.busy}</p>` : ""}
				${s.error ? html`<p class="adm-error" role="alert">${s.error}</p>` : ""}
				<form class="panel adm-token" data-form="token">
					<h3>Connect to GitHub</h3>
					<p>Create a <a class="text-link" href="${TOKEN_URL}" target="_blank" rel="noopener">fine-grained token</a> for the repository <b>${REPO}</b> only, with <b>Contents</b> and <b>Pull requests</b> set to read and write and <b>Checks</b> to read, and an expiry date. It stays on this device.</p>
					<label>Token<input name="token" type="password" autocomplete="off" required></label>
					<div class="adm-actions"><button class="btn primary" type="submit">Connect</button></div>
				</form>`;
			return;
		}
		const n = s.draft.changes.length;
		root.innerHTML = html`${head}
			<p class="muted">${s.user} · ${REPO} · ${s.data ? html`loaded ${BASE} at <code>${s.data.head.slice(0, 7)}</code>` : "loading…"} · <button class="link-btn" data-adm="logout">Disconnect</button></p>
			<div class="segmented adm-tabs" role="tablist">
				<button role="tab" data-adm="tab" data-tab="edit" aria-selected="${String(s.tab === "edit")}">Edit</button>
				<button role="tab" data-adm="tab" data-tab="draft" aria-selected="${String(s.tab === "draft")}">Draft${n ? ` (${n})` : ""}${s.draft.pr ? " · PR" : ""}</button>
				<button role="tab" data-adm="tab" data-tab="stats" aria-selected="${String(s.tab === "stats")}">Statistics</button>
			</div>
			${s.busy ? html`<p class="muted adm-busy">${s.busy}</p>` : ""}
			${s.error ? html`<p class="adm-error" role="alert">${s.error} <button class="link-btn" data-adm="dismiss">Dismiss</button></p>` : ""}
			${!s.data ? "" : s.tab === "edit" ? editTab() : s.tab === "draft" ? draftTab() : statistics()}`;
		if (focusName === "search") {
			const el = root.querySelector("[data-adm=search]");
			el?.focus();
			el?.setSelectionRange(el.value.length, el.value.length);
		}
	}

	/* ------------------------------------------------------------ events ---- */

	root.addEventListener("input", (e) => {
		if (e.target.dataset.adm === "search") { s.query = e.target.value; s.open = null; render(); }
	});
	root.addEventListener("submit", async (e) => {
		e.preventDefault();
		const form = e.target;
		try {
			if (form.dataset.form === "token") await connect(new FormData(form).get("token").trim());
			else if (form.dataset.form === "album" || form.dataset.form === "artist") { keepForm(form); s.error = ""; render(); }
			else if (form.dataset.form === "publish") await publish(new FormData(form).get("note"));
		} catch (err) {
			fail(err);
		}
	});
	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-adm]");
		if (!b || b.dataset.adm === "search") return;
		try {
			switch (b.dataset.adm) {
				case "tab": s.tab = b.dataset.tab; s.error = ""; if (s.tab === "draft" && s.draft.pr) watch(); render(); break;
				case "open": s.open = { kind: b.dataset.kind, id: b.dataset.kind === "album" ? b.dataset.id : Number(b.dataset.id) }; render(); break;
				case "close": s.open = null; render(); break;
				case "undo": s.draft.changes.splice(Number(b.dataset.i), 1); saveDraft(); render(); break;
				case "discard": s.draft.changes = []; saveDraft(); render(); break;
				case "merge": await mergeAndRelease(); break;
				case "refresh": watch(); break;
				case "forget-pr": s.draft.pr = null; s.pr = null; saveDraft(); render(); break;
				case "totals": await loadTotals(); break;
				case "dismiss": s.error = ""; render(); break;
				case "logout": store.set(TOKEN_KEY, null); s.gh = null; s.user = null; s.data = null; render(); break;
				default: break;
			}
		} catch (err) {
			fail(err);
		}
	});

	const saved = store.get(TOKEN_KEY);
	if (saved && !ctx.analyticsOn() && !ctx.desktop) connect(saved);
	else render();
}
