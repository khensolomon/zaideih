/**
 * Library, My uploads: the signed-in person's own music (core/uploads.js,
 * docs/library.md). Choosing files reads them in the browser first; files
 * that cannot be uploaded are listed with the reason and never sent. The
 * rest can be corrected (title, artist, album) and are uploaded one after
 * another with progress.
 */
import { html } from "../core/html.js";
import { megabytes } from "../core/upload-rules.js";
import { prepare, uploads } from "../core/uploads.js";
import { formatDuration } from "../core/text.js";
import { icon } from "./icons.js";
import { albumTile } from "./parts.js";

const ACCEPT = "audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus";
let review = []; // prepared files waiting to be sent: survives re-renders of the page
let sending = false;

function space(st) {
	const s = st.space;
	if (!s) return "";
	const quota = s.quota === null ? "no limit" : megabytes(s.quota);
	const pct = s.quota ? Math.min(100, (s.used / s.quota) * 100) : 0;
	return html`<div class="muted">${megabytes(s.used)} used of ${quota}. Up to ${megabytes(s.maxFile)} per file: MP3, M4A (AAC), FLAC, WAV or Ogg.</div>
		${s.quota ? html`<div class="meter" role="img" aria-label="${Math.round(pct)}% of your space used"><span style="width:${pct.toFixed(1)}%"></span></div>` : ""}`;
}

function reviewList() {
	if (!review.length) return "";
	const ok = review.filter((r) => !r.error && r.state !== "done");
	const refused = review.filter((r) => r.error && r.state !== "done");
	return html`<section class="panel up-review" aria-label="Files to upload">
		<h3>${sending ? "Uploading…" : ok.length ? `Ready to upload: ${ok.length}` : "Nothing can be uploaded"}</h3>
		${ok.length ? html`<p class="muted">Check the details read from the files; they can be changed later too.</p>` : ""}
		<ol class="up-files">${review.map((r, i) => r.error
			? html`<li class="up-file refused"><span class="up-name">${r.file.name}</span><span class="up-why">${r.error}</span></li>`
			: html`<li class="up-file" data-i="${i}" data-state="${r.state ?? "ready"}">
				<div class="up-fields">
					<input name="title" value="${r.title}" aria-label="Title of ${r.file.name}" placeholder="Title" ${sending ? "disabled" : ""}>
					<input name="artist" value="${r.artist}" aria-label="Artist" placeholder="Artist" ${sending ? "disabled" : ""}>
					<input name="album" value="${r.album}" aria-label="Album" placeholder="Album" ${sending ? "disabled" : ""}>
				</div>
				<span class="up-meta">${r.file.name} · ${megabytes(r.file.size)} · ${formatDuration(r.duration)}</span>
				${r.state === "sending" ? html`<span class="up-progress"><span style="width:${Math.round((r.progress ?? 0) * 100)}%"></span></span>` : ""}
				${r.state === "done" ? html`<span class="up-done">${icon("check")} Uploaded</span>` : ""}
				${r.failed ? html`<span class="up-why">${r.failed}</span>` : ""}
			</li>`)}</ol>
		<div class="actions">
			${ok.length && !sending ? html`<button class="btn primary" data-up="send">${icon("plus")} Upload ${ok.length === 1 ? "1 song" : `${ok.length} songs`}</button>` : ""}
			${ok.length > 1 && !sending ? html`<button class="btn" data-up="same-album">Same album for all</button>` : ""}
			${!sending ? html`<button class="btn" data-up="clear">${ok.length ? "Cancel" : "Close"}</button>` : ""}
		</div>
	</section>`;
}

/** The My uploads tab of the Library page: { body, mount }. */
export function uploadsPanel() {
	const st = uploads.state;
	if (!uploads.available) {
		return { body: html`<div class="empty"><h2>Your own music</h2><p>Sign in with GitHub to keep music of your own here. Only you can play it.</p><p><a class="btn primary" href="#/admin">${icon("github")} Sign in with GitHub</a></p></div>` };
	}
	if (st.error && !st.space) {
		return { body: html`<div class="up-root"><div class="empty"><h2>Your uploads could not be read</h2><p>${st.error}</p><p><button class="btn" data-up="retry">Try again</button></p></div></div>`, mount };
	}
	const body = html`<div class="up-root"><section class="panel up-head">
			<div><h3>Your own music</h3>${space(st)}</div>
			<label class="btn primary up-pick">${icon("plus")} Add music<input type="file" multiple accept="${ACCEPT}" class="sr" data-up="pick" ${sending ? "disabled" : ""}></label>
		</section>
		<div id="up-review">${reviewList()}</div>
		${st.albums.length
			? html`<div class="albums grid">${st.albums.map((a) => albumTile(a))}</div>`
			: st.loading ? html`<p class="muted">Reading your uploads…</p>` : html`<div class="empty"><h2>No uploads yet</h2><p>Add music you own to listen to it here, on any device you sign in on.</p></div>`}</div>`;
	return { body, mount };
}

/** Listens on this render's own root, so a re-render never doubles the listeners. */
function mount(page) {
	const view = page.querySelector(".up-root");
	if (!view) return;
	const redraw = () => {
		const box = view.querySelector("#up-review");
		if (box) box.innerHTML = reviewList();
	};
	const keep = () => {
		for (const li of view.querySelectorAll(".up-file[data-i]")) {
			const r = review[Number(li.dataset.i)];
			for (const f of ["title", "artist", "album"]) r[f] = li.querySelector(`[name=${f}]`).value;
		}
	};
	view.addEventListener("change", async (e) => {
		if (e.target.dataset?.up !== "pick") return;
		const files = [...e.target.files];
		e.target.value = "";
		if (!files.length) return;
		keep();
		const left = uploads.spaceLeft() - review.filter((r) => !r.error && r.state !== "done").reduce((n, r) => n + r.file.size, 0);
		review = [...review.filter((r) => r.state !== "done"), ...(await prepare(files, { maxBytes: uploads.state.space.maxFile, spaceLeft: left }))];
		redraw();
	});
	view.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-up]");
		if (!b) return;
		const act = b.dataset.up;
		if (act === "retry") { uploads.refresh().catch(() => {}); return; }
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
		for (const r of review) {
			if (r.error || r.state === "done") continue;
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
		review = failed.length ? review.filter((r) => r.state !== "done") : [];
		await uploads.refresh().catch(() => {});
	});
}
