/**
 * Library, Uploads: the signed-in person's own music (core/uploads.js,
 * docs/library.md). Music comes three ways:
 *
 *   Add music        files from the device, uploaded
 *   Add a folder     every audio file in a folder of the device (desktop
 *                    browsers), uploaded; the album defaults to the folder
 *   Add from storage files already in R2, wherever they are kept (the whole
 *                    bucket for the owner and co-owners, a member's folder
 *                    with the Storage right): added to the library where
 *                    they are, without copying. The last folder opened is
 *                    remembered on the device, and any folder can be typed.
 *
 * Every file is read in the browser first (length, tags); files that cannot
 * be added are listed with the reason and never sent. The rest can be
 * corrected (title, artist, album) before they are added.
 */
import { html } from "../core/html.js";
import { formatOf, megabytes } from "../core/upload-rules.js";
import { prepare, prepareStored, uploads } from "../core/uploads.js";
import { formatDuration } from "../core/text.js";
import { icon } from "./icons.js";
import { albumTile } from "./parts.js";
import { sharedSections } from "./share-view.js";

const ACCEPT = "audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus";
// State that survives re-renders of the page.
let review = []; // prepared files waiting to be added
let sending = false;
let browse = null; // { prefix, folders, files, others, cursor, selected: Set<key>, loading, error }

/** Folders can be picked in desktop browsers; phones offer files only. */
const canPickFolders = () => "webkitdirectory" in HTMLInputElement.prototype && matchMedia("(pointer: fine)").matches;

function space(st) {
	const s = st.space;
	if (!s) return "";
	const pct = s.quota ? Math.min(100, (s.used / s.quota) * 100) : 0;
	const used = s.quota === null ? `${megabytes(s.used)} uploaded, with no limit for you.` : `${megabytes(s.used)} used of ${megabytes(s.quota)}.`;
	return html`<div class="muted">${used} Up to ${megabytes(s.maxFile)} per file: MP3, M4A (AAC), FLAC, WAV or Ogg.</div>
		${s.quota ? html`<div class="meter" role="img" aria-label="${Math.round(pct)}% of your space used"><span style="width:${pct.toFixed(1)}%"></span></div>` : ""}`;
}

/* ------------------------------------------------------------- storage ---- */

const LAST_KEY = "zaideih.storage.last";
const lastFolder = () => { try { return localStorage.getItem(LAST_KEY) ?? ""; } catch { return ""; } };
const rememberFolder = (p) => { try { localStorage.setItem(LAST_KEY, p); } catch { /* this visit only */ } };

function crumbs(root, prefix) {
	const parts = prefix.slice(root.length).split("/").filter(Boolean);
	const out = [{ name: root ? root.replace(/\/$/, "") : "Storage", prefix: root }];
	parts.forEach((p, i) => out.push({ name: p, prefix: `${root}${parts.slice(0, i + 1).join("/")}/` }));
	return out;
}

function storagePanel() {
	if (!browse) return "";
	const root = uploads.storageRoot;
	const b = browse;
	const free = b.files?.filter((f) => !f.added) ?? [];
	return html`<section class="panel up-store" aria-label="Storage">
		<header class="up-store-head">
			<nav class="up-crumbs" aria-label="Folder">${crumbs(root, b.prefix).map((c, i, all) => i === all.length - 1
				? html`<b>${c.name}</b>`
				: html`<button class="link-btn" data-up="open" data-prefix="${c.prefix}">${c.name}</button><span aria-hidden="true">/</span>`)}</nav>
			<button class="icon-btn" data-up="store-close" aria-label="Close storage">${icon("close")}</button>
		</header>
		<form class="up-goto" data-up="goto"><input name="folder" value="${b.prefix}" placeholder="${root || "Folder/Album/"}" aria-label="Folder in storage" spellcheck="false" autocomplete="off"><button class="btn" type="submit">Open</button></form>
		${b.loading ? html`<p class="muted">Reading the folder…</p>` : ""}
		${b.error ? html`<p class="up-why">${b.error}</p>` : ""}
		${b.folders?.length ? html`<ul class="up-folders">${b.folders.map((f) => html`<li><button data-up="open" data-prefix="${f.prefix}">${icon("album")}<span>${f.name}</span>${icon("chevron")}</button></li>`)}</ul>` : ""}
		${b.files?.length ? html`<ul class="up-stored">${b.files.map((f) => html`<li>
				<label data-added="${f.added ? "true" : "false"}"><input type="checkbox" data-up="pick-stored" data-key="${f.key}" ${f.added ? "disabled" : ""} ${b.selected.has(f.key) ? "checked" : ""}>
				<span>${f.name}</span><small>${f.catalog ? "in the catalog: keep it where it is" : f.added ? "in a library" : `${f.format.toUpperCase()} · ${megabytes(f.size)}`}</small></label>
			</li>`)}</ul>` : ""}
		${!b.loading && !b.error && !b.folders?.length && !b.files?.length ? html`<p class="muted">This folder has no folders or audio files.${root ? ` Your storage is ${root}; files put there (with rclone, wrangler or the Cloudflare dashboard) appear here.` : ""}</p>` : ""}
		${b.others ? html`<p class="muted">${b.others === 1 ? "1 other file here is not audio and is not listed." : `${b.others} other files here are not audio and are not listed.`}</p>` : ""}
		${b.cursor ? html`<p><button class="btn" data-up="more-stored">Show more files</button></p>` : ""}
		<div class="actions">
			${free.length ? html`<button class="btn" data-up="all-stored">${b.selected.size === free.length ? "Select none" : "Select all"}</button>` : ""}
			${b.selected.size ? html`<button class="btn primary" data-up="read-stored">Read ${b.selected.size === 1 ? "1 file" : `${b.selected.size} files`}</button>` : ""}
		</div>
	</section>`;
}

/* -------------------------------------------------------------- review ---- */

function reviewList() {
	if (!review.length) return "";
	const ok = review.filter((r) => !r.error && r.state !== "done");
	const stored = ok.filter((r) => r.remote).length;
	const verb = stored === ok.length ? "Add" : "Upload";
	return html`<section class="panel up-review" aria-label="Files to add">
		<h3>${sending ? (verb === "Add" ? "Adding…" : "Uploading…") : ok.length ? `Ready to ${verb.toLowerCase()}: ${ok.length}` : "Nothing can be added"}</h3>
		${ok.length ? html`<p class="muted">Check the details read from the files; they can be changed later too.${stored ? " Files from storage are added where they are, without copying." : ""}</p>` : ""}
		<ol class="up-files">${review.map((r, i) => r.error
			? html`<li class="up-file refused"><span class="up-name">${r.name}</span><span class="up-why">${r.error}</span></li>`
			: html`<li class="up-file" data-i="${i}" data-state="${r.state ?? "ready"}">
				<div class="up-fields">
					<input name="title" value="${r.title}" aria-label="Title of ${r.name}" placeholder="Title" ${sending ? "disabled" : ""}>
					<input name="artist" value="${r.artist}" aria-label="Artist" placeholder="Artist" ${sending ? "disabled" : ""}>
					<input name="album" value="${r.album}" aria-label="Album" placeholder="Album" ${sending ? "disabled" : ""}>
				</div>
				<span class="up-meta">${r.remote ? "Storage · " : ""}${r.name} · ${megabytes(r.size)} · ${formatDuration(r.duration)}</span>
				${r.state === "sending" ? html`<span class="up-progress"><span style="width:${Math.round((r.progress ?? 0) * 100)}%"></span></span>` : ""}
				${r.state === "done" ? html`<span class="up-done">${icon("check")} ${r.remote ? "Added" : "Uploaded"}</span>` : ""}
				${r.failed ? html`<span class="up-why">${r.failed}</span>` : ""}
			</li>`)}</ol>
		<div class="actions">
			${ok.length && !sending ? html`<button class="btn primary" data-up="send">${icon("plus")} ${verb} ${ok.length === 1 ? "1 song" : `${ok.length} songs`}</button>` : ""}
			${ok.length > 1 && !sending ? html`<button class="btn" data-up="same-album">Same album for all</button>` : ""}
			${!sending ? html`<button class="btn" data-up="clear">${ok.length ? "Cancel" : "Close"}</button>` : ""}
		</div>
	</section>`;
}

/** The Uploads page of Library: { body, mount }. */
export function uploadsPanel() {
	const st = uploads.state;
	if (!uploads.available) {
		return { body: html`<div class="empty"><h2>Your own music</h2><p>Sign in with Google or GitHub to keep music of your own here. Only you can play it.</p><p><a class="btn primary" href="#/account">Sign in</a></p></div>` };
	}
	if (st.error && !st.space) {
		return { body: html`<div class="up-root"><div class="empty"><h2>Uploads could not be read</h2><p>${st.error}</p><p><button class="btn" data-up="retry">Try again</button></p></div></div>`, mount };
	}
	const body = html`<div class="up-root"><section class="panel up-head">
			<div><h3>Your own music</h3>${space(st)}</div>
			<div class="up-add">
				<label class="btn primary up-pick">${icon("plus")} Add music<input type="file" multiple accept="${ACCEPT}" class="sr" data-up="pick" ${sending ? "disabled" : ""}></label>
				${canPickFolders() ? html`<label class="btn up-pick">${icon("album")} Add a folder<input type="file" webkitdirectory multiple class="sr" data-up="pick-folder" ${sending ? "disabled" : ""}></label>` : ""}
				${uploads.storageRoot !== null ? html`<button class="btn" data-up="store-open" ${sending ? "disabled" : ""}>${icon("upload")} Add from storage</button>` : ""}
				${st.albums.length ? html`<a class="btn" href="#/share/all">${icon("people")} Share all</a>` : ""}
			</div>
		</section>
		<div id="up-store">${storagePanel()}</div>
		<div id="up-review">${reviewList()}</div>
		${st.albums.length
			? html`<div class="albums grid">${st.albums.map((a) => albumTile(a))}</div>`
			: st.loading ? html`<p class="muted">Reading your uploads…</p>` : html`<div class="empty"><h2>No uploads yet</h2><p>Add music you own to listen to it here, on any device you sign in on.</p></div>`}
		${sharedSections(albumTile)}</div>`;
	return { body, mount };
}

/** Listens on this render's own root, so a re-render never doubles the listeners. */
function mount(page) {
	const view = page.querySelector(".up-root");
	if (!view) return;
	const redraw = () => {
		const box = view.querySelector("#up-review");
		if (box) box.innerHTML = reviewList();
		const store = view.querySelector("#up-store");
		if (store) store.innerHTML = storagePanel();
	};
	const keep = () => {
		for (const li of view.querySelectorAll(".up-file[data-i]")) {
			const r = review[Number(li.dataset.i)];
			for (const f of ["title", "artist", "album"]) r[f] = li.querySelector(`[name=${f}]`).value;
		}
	};
	const waiting = () => review.filter((r) => r.state !== "done");
	const openFolder = async (prefix, cursor = "") => {
		const keepFiles = cursor ? browse.files : [];
		browse = { ...(browse ?? {}), prefix: prefix ?? uploads.storageRoot, loading: true, error: "", selected: cursor ? browse.selected : new Set() };
		if (!cursor) Object.assign(browse, { folders: [], files: [], others: 0, cursor: null });
		redraw();
		try {
			const r = await uploads.browse(prefix, cursor);
			browse = { ...browse, ...r, files: [...keepFiles, ...r.files], loading: false };
			rememberFolder(r.prefix);
		} catch (err) {
			browse = { ...browse, loading: false, error: err.message };
		}
		redraw();
	};

	view.addEventListener("change", async (e) => {
		const act = e.target.dataset?.up;
		if (act === "pick-stored") {
			const key = e.target.dataset.key;
			if (e.target.checked) browse.selected.add(key);
			else browse.selected.delete(key);
			redraw();
			return;
		}
		if (act !== "pick" && act !== "pick-folder") return;
		let files = [...e.target.files];
		e.target.value = "";
		// A folder brings covers and notes too; only its audio files are offered.
		if (act === "pick-folder") files = files.filter((f) => formatOf(f.name));
		if (!files.length) return;
		keep();
		const left = uploads.spaceLeft() - waiting().filter((r) => !r.error && !r.remote).reduce((n, r) => n + r.size, 0);
		review = [...waiting(), ...(await prepare(files, { maxBytes: uploads.state.space.maxFile, spaceLeft: left }))];
		redraw();
	});

	view.addEventListener("submit", async (e) => {
		if (e.target.dataset?.up !== "goto") return;
		e.preventDefault();
		// A typed folder: leading slashes dropped, a trailing one added.
		let p = new FormData(e.target).get("folder").trim().replace(/^\/+/, "");
		if (p && !p.endsWith("/")) p += "/";
		await openFolder(p || uploads.storageRoot);
	});
	view.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-up]");
		if (!b || b.matches("input")) return;
		const act = b.dataset.up;
		if (act === "retry") { uploads.refresh().catch(() => {}); return; }
		if (act === "store-open") {
			// Back where the last visit left off, when that is still inside this person's storage.
			const last = lastFolder();
			await openFolder(last.startsWith(uploads.storageRoot) ? last : uploads.storageRoot);
			return;
		}
		if (act === "store-close") { browse = null; redraw(); return; }
		if (act === "open") { await openFolder(b.dataset.prefix ?? ""); return; }
		if (act === "more-stored") { await openFolder(browse.prefix, browse.cursor); return; }
		if (act === "all-stored") {
			const free = browse.files.filter((f) => !f.added);
			browse.selected = browse.selected.size === free.length ? new Set() : new Set(free.map((f) => f.key));
			redraw();
			return;
		}
		if (act === "read-stored") {
			keep();
			const chosen = browse.files.filter((f) => browse.selected.has(f.key));
			const folderName = browse.prefix.split("/").filter(Boolean).pop() ?? "";
			browse = { ...browse, loading: true };
			redraw();
			const items = await prepareStored(chosen, folderName);
			review = [...waiting().filter((r) => !items.some((i) => i.key && i.key === r.key)), ...items];
			browse = null;
			redraw();
			return;
		}
		if (act === "clear") { review = []; redraw(); return; }
		keep();
		if (act === "same-album") {
			const first = review.find((r) => !r.error && r.album.trim());
			const name = first?.album ?? "";
			for (const r of review) if (!r.error) r.album = name;
			redraw();
			return;
		}
		if (act !== "send") return;
		sending = true;
		redraw();
		// Files from storage go in one request: all are added or none.
		const stored = review.filter((r) => r.remote && !r.error && r.state !== "done");
		if (stored.length) {
			for (const r of stored) { r.state = "sending"; r.failed = ""; }
			redraw();
			try {
				const untitled = stored.find((r) => !r.title.trim());
				if (untitled) throw new Error(`"${untitled.name}" needs a title`);
				await uploads.addFromStorage(stored);
				for (const r of stored) r.state = "done";
			} catch (err) {
				for (const r of stored) { r.state = "ready"; r.failed = err.message; }
			}
			redraw();
		}
		for (const r of review) {
			if (r.remote || r.error || r.state === "done") continue;
			r.state = "sending";
			r.failed = "";
			r.progress = 0;
			redraw();
			try {
				if (!r.title.trim()) throw new Error("a title is needed");
				await uploads.send(r, (p) => {
					r.progress = p;
					const bar = view.querySelector(`.up-file[data-i="${review.indexOf(r)}"] .up-progress span`);
					if (bar) bar.style.width = `${Math.round(p * 100)}%`;
				});
				r.state = "done";
			} catch (err) {
				r.state = "ready";
				r.failed = err.message;
			}
			redraw();
		}
		sending = false;
		const failed = review.filter((r) => r.failed);
		review = failed.length ? waiting() : [];
		await uploads.refresh().catch(() => {});
	});
}
