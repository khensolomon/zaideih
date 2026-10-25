/**
 * A songbook's pages (docs/songbooks.md, steps 3 to 5): a book and its hymns,
 * a hymn (a text, with its work, credits, other versions and the recordings
 * that sing it), a person and a work. Those with the Songbooks right also
 * edit here: a book's details, its rights and (owner and co-owners) whether
 * it is public; a hymn's details, its work and credits; joining recordings.
 *
 *   #/songbook/<book>              the book: its hymns, filtered; a number jumps
 *   #/songbook/<book>/<number>     a hymn of the book
 *   #/songbooks/text/<id>          a text wherever it is printed
 *   #/songbooks/person/<id>        what a person wrote, composed or translated
 *   #/songbooks/work/<id>          a work and its texts
 */
import { LYRICS_LANGS } from "../core/lyrics-index.js";
import { parseLyrics } from "../core/lyrics-format.js";
import { html } from "../core/html.js";
import { linkLyrics, unlinkLyrics } from "../core/lyrics.js";
import { href } from "../core/router.js";
import { search } from "../core/search.js";
import {
	createPerson, createWork, findPeople, findWorks, hymnHref, hymnOf, readBook, readPerson, readText, readWork,
	refreshHymnIndex, setEntry, updateBook, updateText, updateWork,
} from "../core/songbooks.js";
import { uploads } from "../core/uploads.js";
import { icon } from "./icons.js";
import { creditsHtml, detailChips, lyricsHtml } from "./lyrics-render.js";
import { registerList, scriptClass, trackRow } from "./parts.js";

const ROLE_NAMES = { words: "Words", music: "Music", arrangement: "Arrangement", translation: "Translation" };
const editor = () => uploads.canSongbooks;
const failed = (title, err) => ({ title, body: html`<div class="empty"><h2>${title}</h2><p>${err.message}</p><p><a class="btn" href="#/songbooks">Songbooks</a></p></div>` });
/**
 * The page in a wrapper of its own, its listeners on it: the view element
 * stays from page to page, so listeners put there would pile up.
 */
export const own = (body, mount) => ({ body: html`<div class="sb-root">${body}</div>`, mount: mount ? (view) => mount(view.querySelector(".sb-root")) : undefined });
const people = (credits, role) => credits.filter((c) => c.role === role);
const personLinks = (list) => list.map((c, i) => html`${i ? ", " : ""}<a class="text-link" href="${href(`songbooks/person/${c.person}`)}">${c.name}</a>`);

/* -------------------------------------------------------------- book ---- */

export async function bookView(_c, { id }) {
	let book;
	try {
		book = await readBook(Number(id));
	} catch (err) {
		return failed("This songbook could not be read", err);
	}
	const facts = [book.lang, book.edition && `edition ${book.edition}`, book.year, book.publisher].filter(Boolean).join(" · ");
	const body = html`<p class="kind"><a class="text-link" href="#/songbooks">Songbooks</a></p>
		<div class="sb-head">
			<span class="sb-short sb-short-big">${book.short}</span>
			<div><h1 class="${scriptClass(book.title)}">${book.title}</h1><p class="muted">${facts}${facts ? " · " : ""}${book.entries.length.toLocaleString()} ${book.entries.length === 1 ? "hymn" : "hymns"}</p></div>
		</div>
		${book.public ? "" : html`<p class="held-note">${icon("lock")} Private: seen only with the Songbooks right until its rights are settled and the owner makes it public.</p>`}
		${editor() ? html`<div class="actions"><a class="btn" href="${href("songbooks/import", { book: book.id })}">${icon("upload")} Add pages</a><button class="btn" data-hy="book-edit">${icon("edit")} Details and rights</button></div><div id="sb-book-edit"></div>` : ""}
		<label class="sb-filter">${icon("search")}<input type="search" data-hy="filter" placeholder="A number, a title or the first line" aria-label="Find a hymn in ${book.title}: a number, a title or the first line" autocomplete="off" enterkeyhint="go"></label>
		${book.entries.length ? html`<ol class="sb-index">${book.entries.map((e) => html`<li data-n="${e.number}" data-find="${`${e.number} ${e.title} ${e.firstLine}`.toLowerCase()}">
			<a href="${href(`songbook/${book.id}/${e.number}`)}"><span class="sb-num">${e.number}</span><span class="sb-hymn-text"><b class="${scriptClass(e.title)}">${e.title}</b>${e.firstLine && e.firstLine !== e.title ? html`<small class="${scriptClass(e.firstLine)}">${e.firstLine}</small>` : ""}</span></a>
		</li>`)}</ol><p class="muted sb-none" hidden>No hymn matches.</p>` : html`<div class="empty"><h2>No hymns yet</h2>${editor() ? html`<p><a class="btn primary" href="${href("songbooks/import", { book: book.id })}">Add pages</a></p>` : ""}</div>`}`;
	return { title: book.title, ...own(body, (root) => mountBook(root, book)) };
}

function bookForm(book) {
	const canPublish = uploads.canPublishBooks;
	return html`<form class="panel sb-new" data-hy="book-save">
		<h2>Details and rights</h2>
		<div class="sb-fields">
			<label class="sb-field sb-wide"><span>Title</span><input name="title" required maxlength="200" value="${book.title}"></label>
			<label class="sb-field"><span>Short name</span><input name="short" required maxlength="8" pattern="[A-Za-z0-9]{1,8}" value="${book.short}"></label>
			<label class="sb-field"><span>Language</span><input name="lang" required maxlength="20" pattern="[a-z][a-z\\-]{1,19}" value="${book.lang}"></label>
			<label class="sb-field"><span>Edition</span><input name="edition" maxlength="200" value="${book.edition}"></label>
			<label class="sb-field"><span>Year</span><input name="year" type="number" min="100" max="2100" value="${book.year ?? ""}"></label>
			<label class="sb-field sb-wide"><span>Publisher</span><input name="publisher" maxlength="200" value="${book.publisher}"></label>
			<label class="sb-field"><span>Rights</span><select name="rights">${[["unsettled", "Not settled yet"], ["permission", "Permission given"], ["public-domain", "Public domain"]].map(([v, l]) => html`<option value="${v}" ${v === book.rights ? "selected" : ""}>${l}</option>`)}</select></label>
			<label class="sb-field sb-wide"><span>How the rights are settled</span><input name="rightsNote" maxlength="500" value="${book.rightsNote}" placeholder="For example: letter from the publisher, 2026"></label>
			${canPublish ? html`<label class="check sb-wide"><input type="checkbox" name="public" ${book.public ? "checked" : ""}> Public: everyone sees this book and its hymns (needs the rights settled)</label>` : html`<p class="muted sb-wide">Only the owner and co-owners make a book public.</p>`}
		</div>
		<p class="error" role="alert" hidden></p>
		<p><button class="btn primary" type="submit">Save</button></p>
	</form>`;
}

function mountBook(root, book) {
	const list = [...root.querySelectorAll(".sb-index li")];
	root.addEventListener("input", (e) => {
		if (e.target.dataset.hy !== "filter") return;
		const q = e.target.value.trim().toLowerCase();
		let shown = 0;
		for (const li of list) {
			const on = !q || (/^\d+$/.test(q) ? li.dataset.n.startsWith(q) : li.dataset.find.includes(q));
			li.hidden = !on;
			if (on) shown += 1;
		}
		const none = root.querySelector(".sb-none");
		if (none) none.hidden = shown > 0;
	});
	root.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || e.target.dataset.hy !== "filter") return;
		const n = e.target.value.trim();
		if (/^\d+$/.test(n) && book.entries.some((x) => x.number === Number(n))) location.hash = href(`songbook/${book.id}/${n}`);
		else root.querySelector(".sb-index li:not([hidden]) a")?.click();
	});
	root.addEventListener("click", (e) => {
		if (!e.target.closest("[data-hy=book-edit]")) return;
		const box = root.querySelector("#sb-book-edit");
		box.innerHTML = box.innerHTML ? "" : bookForm(book).toString();
	});
	root.addEventListener("submit", async (e) => {
		const form = e.target.closest("[data-hy=book-save]");
		if (!form) return;
		e.preventDefault();
		const f = new FormData(form);
		const fields = Object.fromEntries(["title", "short", "lang", "edition", "publisher", "rights", "rightsNote"].map((k) => [k, String(f.get(k) ?? "")]));
		fields.year = f.get("year") ? Number(f.get("year")) : null;
		if (uploads.canPublishBooks) fields.public = f.get("public") === "on";
		try {
			await updateBook(book.id, fields);
			refreshHymnIndex({ force: true, editor: editor() }).catch(() => {});
			dispatchEvent(new HashChangeEvent("hashchange"));
		} catch (err) {
			const box = form.querySelector(".error");
			box.textContent = err.message;
			box.hidden = false;
		}
	});
}

/* -------------------------------------------------------------- hymn ---- */

/** #/songbook/<book>/<number> */
export async function hymnView(c, { id, n }, query, ctx) {
	let book;
	try {
		book = await readBook(Number(id));
	} catch (err) {
		return failed("This songbook could not be read", err);
	}
	const i = book.entries.findIndex((e) => e.number === Number(n));
	if (i < 0) return { title: book.title, body: html`<div class="empty"><h2>${book.short} ${n} is not in ${book.title}</h2><p><a class="btn" href="${href(`songbook/${book.id}`)}">${book.title}</a></p></div>` };
	return textPage(c, book.entries[i].text, query, { book, at: i }, ctx);
}

/** #/songbooks/text/<id> */
export const textView = (c, { id }, query, ctx) => textPage(c, Number(id), query, null, ctx);

/** `ctx`: { notify, confirmAction } from the app. */
async function textPage(c, textId, query, where, ctx) {
	let t;
	try {
		t = await readText(textId);
	} catch (err) {
		return failed("This hymn could not be read", err);
	}
	const lang = query?.get("lang") ?? "";
	const words = t.lyrics.find((l) => l.lang === lang) ?? null;
	const parsed = words ? parseLyrics(words.text) : null;
	const book = where?.book;
	const entry = book ? book.entries[where.at] : null;
	const prev = book ? book.entries[where.at - 1] : null;
	const next = book ? book.entries[where.at + 1] : null;
	const label = entry ? `${book.short} ${entry.number}` : t.books[0] ? `${t.books[0].short} ${t.books[0].number}` : "";
	const work = t.work;
	const recordings = t.recordings.map((r) => c.track(r)).filter(Boolean);
	const listKey = recordings.length ? registerList(recordings.map((r) => r.id), t.title) : "";
	const pagePath = book ? `songbook/${book.id}/${entry.number}` : `songbooks/text/${t.id}`;
	const ed = editor();
	const body = html`<p class="kind">${book ? html`<a class="text-link" href="${href(`songbook/${book.id}`)}">${book.title}</a>` : html`<a class="text-link" href="#/songbooks">Songbooks</a>`}</p>
		<div class="sb-head">
			${label ? html`<span class="sb-short sb-short-big sb-label">${label}</span>` : ""}
			<div><h1 class="${scriptClass(t.title)}">${t.title}</h1>
			<p class="muted">${[t.lang, ...t.books.filter((b) => !entry || b.book !== book.id || b.number !== entry.number).map((b) => `${b.short} ${b.number}`)].join(" · ")}</p></div>
		</div>
		${book && !book.public ? html`<p class="held-note">${icon("lock")} Private: seen only with the Songbooks right until the book's rights are settled.</p>` : ""}
		<div class="actions">
			${recordings.length ? html`<button class="btn primary" data-act="play-all" data-list="${listKey}">${icon("play")} Play</button>` : ""}
			${t.lyrics.length > 1 || lang ? html`<span class="sb-langs">${t.lyrics.map((l) => html`<a class="chip${l.lang === lang ? " on" : ""}" href="${href(pagePath, l.lang ? { lang: l.lang } : undefined)}">${LYRICS_LANGS[l.lang] ?? l.lang}</a>`)}</span>` : ""}
			${ed ? html`<a class="btn" href="${href(`songbooks/text/${t.id}/studio`, lang ? { lang } : undefined)}">${icon("edit")} Edit the words</a><button class="btn" data-hy="details">${icon("tools")} Details</button>` : ""}
		</div>
		${ed ? html`<div id="sb-details"></div>` : ""}
		${parsed ? html`${detailChips(parsed)}<div class="ly-text-wrap">${lyricsHtml(parsed)}</div>${creditsHtml(parsed)}` : html`<div class="empty"><h2>No words yet</h2>${ed ? html`<p><a class="btn primary" href="${href(`songbooks/text/${t.id}/studio`)}">Write them</a></p>` : ""}</div>`}
		${work || t.credits.length ? html`<section class="section sb-credits"><header><h2>About this hymn</h2></header><dl>
			${work ? html`<dt>Work</dt><dd><a class="text-link" href="${href(`songbooks/work/${work.id}`)}">${work.title}</a>${work.lang !== t.lang ? ` (${work.lang})` : ""}</dd>` : ""}
			${work ? ["words", "music", "arrangement"].map((r) => (people(work.credits, r).length ? html`<dt>${ROLE_NAMES[r]}</dt><dd>${personLinks(people(work.credits, r))}</dd>` : "")) : ""}
			${["translation", "words"].map((r) => (people(t.credits, r).length ? html`<dt>${r === "words" ? `Words in ${t.lang}` : "Translated by"}</dt><dd>${personLinks(people(t.credits, r))}</dd>` : ""))}
			${work?.tune ? html`<dt>Tune</dt><dd>${work.tune}</dd>` : ""}
			${work?.metre ? html`<dt>Metre</dt><dd>${work.metre}</dd>` : ""}
			${work?.year ? html`<dt>Year</dt><dd>${work.year}</dd>` : ""}
			${work?.scripture ? html`<dt>Scripture</dt><dd>${work.scripture}</dd>` : ""}
			${work?.topics ? html`<dt>Topics</dt><dd>${work.topics}</dd>` : ""}
		</dl></section>` : ""}
		${t.versions.length ? html`<section class="section"><header><h2>Other versions</h2></header><ul class="sb-list">${t.versions.map((v) => html`<li><a href="${href(`songbooks/text/${v.id}`)}"><b>${v.title}</b> <span class="muted">${[v.lang, v.label].filter(Boolean).join(" · ")}</span></a></li>`)}</ul></section>` : ""}
		<section class="section"><header><h2>Recordings</h2></header>
			${recordings.length ? html`<ol class="tracks">${recordings.map((r, k) => trackRow(r, listKey, k, { showAlbum: true, thumb: true }))}</ol>` : html`<p class="muted">No recording in Zaideih sings these words yet.</p>`}
			${ed ? html`<div class="sb-join"><label class="sb-filter">${icon("search")}<input type="search" data-hy="join-q" placeholder="Join a recording: its title" autocomplete="off"></label><ul class="sb-list" id="sb-join-results"></ul></div>` : ""}
		</section>
		${book ? html`<nav class="sb-prevnext" aria-label="Hymns">${prev ? html`<a class="btn" href="${href(`songbook/${book.id}/${prev.number}`)}">${icon("back")} ${prev.number}</a>` : html`<span></span>`}${next ? html`<a class="btn" href="${href(`songbook/${book.id}/${next.number}`)}">${next.number} ${icon("chevron")}</a>` : ""}</nav>` : ""}`;
	return { title: label ? `${label} ${t.title}` : t.title, ...own(body, ed ? (root) => mountHymn(root, c, t, where, ctx) : null) };
}

/* ---------------------------------------------------- editing a hymn ---- */

function detailsForm(t, where, c) {
	const work = t.work;
	return html`<div class="panel sb-details">
		<form data-hy="text-save" class="sb-fields">
			<label class="sb-field sb-wide"><span>Title</span><input name="title" required maxlength="200" value="${t.title}"></label>
			<label class="sb-field sb-wide"><span>First line</span><input name="firstLine" maxlength="300" value="${t.firstLine}"></label>
			<label class="sb-field"><span>Language</span><input name="lang" required maxlength="20" pattern="[a-z][a-z\\-]{1,19}" value="${t.lang}"></label>
			<p class="sb-wide"><button class="btn primary" type="submit">Save</button></p>
		</form>
		<div class="sb-credit-row"><b>Translated by</b>${creditChips(t.credits, "translation", "text")}${personPicker("translation", "text")}</div>
		<div class="sb-credit-row"><b>Words in ${t.lang} by</b>${creditChips(t.credits, "words", "text")}${personPicker("words", "text")}</div>
		<h3>Work</h3>
		${work ? html`<form data-hy="work-save" class="sb-fields">
			<label class="sb-field sb-wide"><span>Title</span><input name="title" required maxlength="200" value="${work.title}"></label>
			<label class="sb-field"><span>Language</span><input name="lang" required maxlength="20" pattern="[a-z][a-z\\-]{1,19}" value="${work.lang}"></label>
			<label class="sb-field"><span>Year</span><input name="year" type="number" min="100" max="2100" value="${work.year ?? ""}"></label>
			<label class="sb-field"><span>Tune</span><input name="tune" maxlength="200" value="${work.tune}"></label>
			<label class="sb-field"><span>Metre</span><input name="metre" maxlength="40" value="${work.metre}" placeholder="8.7.8.7"></label>
			<label class="sb-field sb-wide"><span>Scripture</span><input name="scripture" maxlength="300" value="${work.scripture}"></label>
			<label class="sb-field sb-wide"><span>Topics</span><input name="topics" maxlength="300" value="${work.topics}"></label>
			<p class="sb-wide"><button class="btn primary" type="submit">Save the work</button> <button class="link-btn" type="button" data-hy="work-drop">Not this work</button></p>
		</form>
		${["words", "music", "arrangement"].map((r) => html`<div class="sb-credit-row"><b>${ROLE_NAMES[r]}</b>${creditChips(work.credits, r, "work")}${personPicker(r, "work")}</div>`)}` : html`<p class="muted">The hymn as a work, whatever its language: its writers, composer, tune. Find it, or add it.</p>
		<div class="sb-pick"><input data-hy="work-q" placeholder="The work's title or tune" autocomplete="off"><span class="sb-pick-results" id="sb-work-results"></span></div>`}
		${t.recordings.length ? html`<h3>Joined recordings</h3><ul class="sb-list">${t.recordings.map((r) => html`<li><span>${c.track(r)?.title ?? `Song ${r}`} <span class="muted">${c.track(r)?.album.title ?? ""}</span></span><button type="button" class="btn" data-hy="unjoin" data-id="${r}">Unjoin</button></li>`)}</ul>` : ""}
		${where?.book ? html`<p class="sb-remove"><button class="link-btn danger" data-hy="entry-remove">Take ${where.book.short} ${where.book.entries[where.at].number} out of ${where.book.title}</button> <small class="muted">The text and its words stay.</small></p>` : ""}
		<p class="error" role="alert" hidden></p>
	</div>`;
}

const creditChips = (credits, role, subject) => html`${credits.filter((x) => x.role === role).map((x) => html`<span class="chip sb-chip">${x.name}<button type="button" data-hy="credit-drop" data-subject="${subject}" data-role="${role}" data-person="${x.person}" aria-label="Take ${x.name} out">${icon("close")}</button></span>`)}`;
const personPicker = (role, subject) => html`<span class="sb-pick"><input data-hy="person-q" data-role="${role}" data-subject="${subject}" placeholder="Add a person…" autocomplete="off"><span class="sb-pick-results"></span></span>`;

function mountHymn(root, c, t, where, ctx) {
	const reload = () => dispatchEvent(new HashChangeEvent("hashchange"));
	const fail = (err) => ctx.notify(err.message, { kind: "error" });
	const workFields = (w) => ({ title: w.title, lang: w.lang, tune: w.tune, metre: w.metre, year: w.year ?? null, scripture: w.scripture, topics: w.topics });
	const creditsWith = (list, add, drop) => [...list.filter((x) => !(drop && x.person === drop.person && x.role === drop.role)).map((x) => ({ person: x.person, role: x.role })), ...(add ? [add] : [])];
	const setCredits = async (subject, add, drop) => {
		if (subject === "text") await updateText(t.id, { credits: creditsWith(t.credits, add, drop) });
		else await updateWork(t.work.id, { ...workFields(t.work), credits: creditsWith(t.work.credits, add, drop) });
		reload();
	};
	let timer = 0;
	root.addEventListener("input", (e) => {
		const el = e.target;
		const hy = el.dataset.hy;
		if (hy !== "person-q" && hy !== "work-q" && hy !== "join-q") return;
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const q = el.value.trim();
			try {
				if (hy === "join-q") {
					const box = root.querySelector("#sb-join-results");
					const r = q.length >= 2 ? search(c, q, { tracks: 8, albums: 0, artists: 0 }) : null;
					box.innerHTML = r ? html`${r.tracks.items.filter((x) => !t.recordings.includes(x.id)).map((x) => html`<li><span><b>${x.title}</b> <span class="muted">${x.album.title}</span></span><button class="btn" data-hy="join" data-id="${x.id}">Join</button></li>`)}`.toString() : "";
					return;
				}
				const box = el.parentElement.querySelector(".sb-pick-results");
				if (q.length < 2) { box.innerHTML = ""; return; }
				if (hy === "person-q") {
					const found = await findPeople(q);
					box.innerHTML = html`${found.map((p) => html`<button type="button" class="chip" data-hy="person-pick" data-id="${p.id}">${p.name}${p.born ? ` (${p.born}${p.died ? `–${p.died}` : ""})` : ""}</button>`)}<button type="button" class="chip" data-hy="person-new">${icon("plus")} New: ${q}</button>`.toString();
				} else {
					const found = await findWorks(q);
					box.innerHTML = html`${found.map((w) => html`<button type="button" class="chip" data-hy="work-pick" data-id="${w.id}">${w.title}${w.tune ? ` · ${w.tune}` : ""}</button>`)}<button type="button" class="chip" data-hy="work-new">${icon("plus")} New work: ${q}</button>`.toString();
				}
			} catch (err) {
				fail(err);
			}
		}, 250);
	});
	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-hy]");
		if (!b) return;
		try {
			switch (b.dataset.hy) {
				case "details": {
					const box = root.querySelector("#sb-details");
					box.innerHTML = box.innerHTML ? "" : detailsForm(t, where, c).toString();
					break;
				}
				case "person-pick":
				case "person-new": {
					const input = b.closest(".sb-pick").querySelector("input");
					const person = b.dataset.hy === "person-new" ? (await createPerson({ name: input.value.trim() })).id : Number(b.dataset.id);
					await setCredits(input.dataset.subject, { person, role: input.dataset.role });
					break;
				}
				case "credit-drop":
					await setCredits(b.dataset.subject, null, { person: Number(b.dataset.person), role: b.dataset.role });
					break;
				case "work-pick":
					await updateText(t.id, { work: Number(b.dataset.id) });
					reload();
					break;
				case "work-new": {
					const title = root.querySelector("[data-hy=work-q]").value.trim();
					const w = await createWork({ title, lang: t.lang });
					await updateText(t.id, { work: w.id });
					reload();
					break;
				}
				case "work-drop":
					await updateText(t.id, { work: null });
					reload();
					break;
				case "entry-remove": {
					const n = where.book.entries[where.at].number;
					if (!(await ctx.confirmAction(`Take ${where.book.short} ${n} out of ${where.book.title}? Its text and words stay.`, "Take it out"))) return;
					await setEntry(where.book.id, n, { remove: true });
					refreshHymnIndex({ force: true, editor: true }).catch(() => {});
					location.hash = href(`songbook/${where.book.id}`);
					break;
				}
				case "join": {
					const track = Number(b.dataset.id);
					try {
						await linkLyrics(track, t.id);
					} catch (err) {
						// A recording with words of its own: merged, deliberately, the book's words kept.
						if (err.status !== 409 || !/merge/.test(err.message)) throw err;
						const r = c.track(track);
						if (!(await ctx.confirmAction(`“${r?.title ?? track}” has words of its own. Join it anyway, showing the book's words? Its own stay in its history.`, "Join"))) return;
						await linkLyrics(track, t.id, { merge: true, keep: "to" });
					}
					reload();
					break;
				}
				default:
					break;
			}
		} catch (err) {
			fail(err);
		}
	});
	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-hy=unjoin]");
		if (!b) return;
		try {
			if (!(await ctx.confirmAction("Unjoin this recording? It shows no words until it is joined again or given its own.", "Unjoin"))) return;
			await unlinkLyrics(Number(b.dataset.id), false);
			reload();
		} catch (err) {
			fail(err);
		}
	});
	root.addEventListener("submit", async (e) => {
		const form = e.target.closest("[data-hy=text-save], [data-hy=work-save]");
		if (!form) return;
		e.preventDefault();
		const f = Object.fromEntries(new FormData(form));
		try {
			if (form.dataset.hy === "text-save") await updateText(t.id, { title: f.title, firstLine: f.firstLine, lang: f.lang });
			else await updateWork(t.work.id, { title: f.title, lang: f.lang, tune: f.tune, metre: f.metre, year: f.year ? Number(f.year) : null, scripture: f.scripture, topics: f.topics });
			refreshHymnIndex({ force: true, editor: true }).catch(() => {});
			reload();
		} catch (err) {
			fail(err);
		}
	});
}

/* ------------------------------------------------------- person, work ---- */

const textLink = (x) => {
	const h = hymnOf(x.id);
	return html`<a href="${h ? hymnHref(h) : href(`songbooks/text/${x.id}`)}"><b>${x.title}</b> <span class="muted">${[x.lang, x.label].filter(Boolean).join(" · ")}</span></a>`;
};

export async function personView(_c, { id }) {
	let p;
	try {
		p = await readPerson(Number(id));
	} catch (err) {
		return failed("This person could not be found", err);
	}
	const years = p.born || p.died ? `${p.born ?? "?"}–${p.died ?? ""}` : "";
	return {
		title: p.name,
		body: html`<p class="kind"><a class="text-link" href="#/songbooks">Songbooks</a></p>
			<h1 class="${scriptClass(p.name)}">${p.name}</h1>
			<p class="muted">${[years, p.aka].filter(Boolean).join(" · ")}</p>
			${p.note ? html`<p>${p.note}</p>` : ""}
			${p.works.length ? html`<section class="section"><header><h2>Wrote or composed</h2></header><ul class="sb-list">${p.works.map((w) => html`<li><a href="${href(`songbooks/work/${w.id}`)}"><b>${w.title}</b> <span class="muted">${ROLE_NAMES[w.role]}</span></a></li>`)}</ul></section>` : ""}
			${p.texts.length ? html`<section class="section"><header><h2>Translated</h2></header><ul class="sb-list">${p.texts.map((x) => html`<li>${textLink(x)}</li>`)}</ul></section>` : ""}`,
	};
}

export async function workView(_c, { id }) {
	let w;
	try {
		w = await readWork(Number(id));
	} catch (err) {
		return failed("This work could not be found", err);
	}
	return {
		title: w.title,
		body: html`<p class="kind"><a class="text-link" href="#/songbooks">Songbooks</a></p>
			<h1 class="${scriptClass(w.title)}">${w.title}</h1>
			<p class="muted">${[w.lang, w.year, w.tune && `tune ${w.tune}`, w.metre].filter(Boolean).join(" · ")}</p>
			${w.credits.length ? html`<dl class="sb-credits-dl">${["words", "music", "arrangement"].map((r) => (people(w.credits, r).length ? html`<dt>${ROLE_NAMES[r]}</dt><dd>${personLinks(people(w.credits, r))}</dd>` : ""))}</dl>` : ""}
			${w.scripture ? html`<p class="muted">Scripture: ${w.scripture}</p>` : ""}
			<section class="section"><header><h2>Versions</h2></header><ul class="sb-list">${w.texts.map((x) => html`<li>${textLink(x)}</li>`)}</ul></section>`,
	};
}
