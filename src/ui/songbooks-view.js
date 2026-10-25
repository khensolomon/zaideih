/**
 * Songbooks in the app (docs/songbooks.md): the books, a new book, and
 * importing a book's pages.
 *
 *   #/songbooks                  the books the person sees; the Songbooks right adds one
 *   #/songbooks/import?book=<id> pages of a book, as text, split into hymns
 *                                (core/songbook-import.js), checked, then added,
 *                                by those who edit the book (its `may`)
 */
import { html } from "../core/html.js";
import { splitHymns } from "../core/songbook-import.js";
import { addHymns, createBook, listBooks, mayEdit, readBook, SongbookError } from "../core/songbooks.js";
import { uploads } from "../core/uploads.js";
import { href } from "../core/router.js";
import { icon } from "./icons.js";
import { own } from "./songbook-pages.js";

const notSignedIn = () => html`<div class="empty"><h2>Songbooks</h2><p>Hymn books and praise books, with every song's words, are coming to Zaideih. Those who add them sign in first.</p><p><a class="btn primary" href="#/account">Sign in</a></p></div>`;

/** #/songbooks */
export async function songbooksView() {
	let books, editor;
	try {
		({ books, create: editor } = await listBooks());
	} catch (err) {
		return { title: "Songbooks", body: html`<h1>Songbooks</h1><div class="empty"><h2>The songbooks could not be read</h2><p>${err.message}</p></div>` };
	}
	const body = html`<h1>Songbooks</h1>
		${books.length ? html`<ul class="sb-books">${books.map((b) => html`<li class="sb-book">
			<a class="sb-book-open" href="${href(`songbook/${b.id}`)}" aria-label="Open ${b.title}">
				<span class="sb-short">${b.short}</span>
				<span class="sb-book-text"><b>${b.title}</b><small>${[b.lang, b.edition && `edition ${b.edition}`, b.year, `${b.entries.toLocaleString()} ${b.entries === 1 ? "song" : "songs"}`].filter(Boolean).join(" · ")}</small></span>
				${b.may === "edit" || b.may === "read" ? html`<span class="sb-private">${b.may === "edit" ? "Editor" : "Reader"}</span>` : ""}
				${b.public ? "" : html`<span class="sb-private" title="Seen only with the Songbooks right, or by those appointed to it, until its rights are settled">${icon("lock")} Private</span>`}
				${icon("chevron")}
			</a>
			${mayEdit(b.may) ? html`<a class="btn" href="${href("songbooks/import", { book: b.id })}">${icon("upload")} Add pages</a>` : ""}
		</li>`)}</ul>` : html`<div class="empty"><h2>No songbooks yet</h2><p>${editor ? "Add the first one below." : "Hymn books and praise books, with every song's words, are coming to Zaideih."}</p></div>`}
		${editor ? newBookForm() : ""}`;
	return { title: "Songbooks", ...own(body, editor ? mountList : null) };
}

function newBookForm() {
	return html`<form class="panel sb-new" data-sb="new-book">
		<h2>New songbook</h2>
		<p class="muted">A songbook is one edition of a book. It stays private, seen only with the Songbooks right, until its rights are settled and the owner makes it public.</p>
		<div class="sb-fields">
			<label class="sb-field sb-wide"><span>Title</span><input name="title" required maxlength="200" placeholder="Tedim Labu"></label>
			<label class="sb-field"><span>Short name</span><input name="short" required maxlength="8" pattern="[A-Za-z0-9]{1,8}" placeholder="TL" title="1 to 8 letters or digits"></label>
			<label class="sb-field"><span>Language</span><input name="lang" required maxlength="20" pattern="[a-z][a-z\\-]{1,19}" placeholder="tedim" title="The language's name in lower case"></label>
			<label class="sb-field"><span>Edition</span><input name="edition" maxlength="200" placeholder="1995"></label>
			<label class="sb-field"><span>Year</span><input name="year" type="number" min="100" max="2100" inputmode="numeric"></label>
			<label class="sb-field sb-wide"><span>Publisher</span><input name="publisher" maxlength="200"></label>
		</div>
		<p class="error" role="alert" hidden></p>
		<p><button class="btn primary" type="submit">${icon("plus")} Add the songbook</button></p>
	</form>`;
}

function mountList(root) {
	root.addEventListener("submit", async (e) => {
		const form = e.target.closest("[data-sb=new-book]");
		if (!form) return;
		e.preventDefault();
		const f = new FormData(form);
		const error = form.querySelector(".error");
		const fields = { title: f.get("title"), short: f.get("short"), lang: f.get("lang"), edition: f.get("edition"), publisher: f.get("publisher") };
		if (f.get("year")) fields.year = Number(f.get("year"));
		try {
			form.querySelector("button[type=submit]").disabled = true;
			const book = await createBook(fields);
			location.hash = href("songbooks/import", { book: book.id });
		} catch (err) {
			error.textContent = err.message;
			error.hidden = false;
			form.querySelector("button[type=submit]").disabled = false;
		}
	});
}

/* ------------------------------------------------------------ import ---- */

/** #/songbooks/import?book=<id> */
export async function songbookImportView(_c, _params, query) {
	if (!uploads.available) return { title: "Add pages", body: notSignedIn() };
	const id = Number(query.get("book"));
	let book;
	try {
		book = await readBook(id);
	} catch (err) {
		return { title: "Add pages", body: html`<div class="empty"><h2>This songbook could not be read</h2><p>${err.message}</p><p><a class="btn" href="#/songbooks">Songbooks</a></p></div>` };
	}
	if (!mayEdit(book.may)) return { title: "Add pages", body: html`<div class="empty"><h2>Adding pages to ${book.title} is for its editors</h2><p>The owner, a co-owner or someone with the Songbooks right appoints them, on the book's page, Collaborators.</p><p><a class="btn" href="${href(`songbook/${book.id}`)}">${book.title}</a></p></div>` };
	const have = new Set(book.entries.map((e) => e.number));
	const next = book.entries.length ? book.entries.at(-1).number + 1 : "";
	const body = html`<p class="kind"><a class="text-link" href="#/songbooks">Songbooks</a></p>
		<h1>${book.title}: add pages</h1>
		<div class="panel sb-how">
			<p>Photograph a page and copy its text: on an iPhone, open the photo and press on the text (Live Text); on Android, Google Lens, Text. Paste one page or many below. Each song starts at its number with its title under it, or beside it in capitals.</p>
			<p class="muted">${book.entries.length ? `${book.entries.length.toLocaleString()} ${book.entries.length === 1 ? "song is" : "songs are"} in the book; the last is ${book.entries.at(-1).number}.` : "The book has no songs yet."} Numbers already there are left as they are.</p>
		</div>
		<form class="sb-import" data-sb="split">
			<label class="sb-field"><span>Pages, as text</span><textarea name="pages" rows="14" spellcheck="false" placeholder="145&#10;LUNGMUANNA KA NEI&#10;1. Lungmuanna ka nei hi, …"></textarea></label>
			<label class="sb-field sb-from"><span>First song on these pages (optional)</span><input name="from" type="number" min="1" max="99999" inputmode="numeric" value="${next}"></label>
			<p><button class="btn primary" type="submit">Split into songs</button></p>
		</form>
		<div id="sb-preview" aria-live="polite"></div>`;
	return { title: `${book.title}: add pages`, ...own(body, (root) => mountImport(root, book, have)) };
}

function mountImport(root, book, have) {
	let draft = [];
	const preview = root.querySelector("#sb-preview");
	const draw = (status = "") => {
		const adding = draft.filter((h) => !have.has(h.number));
		preview.innerHTML = draft.length ? html`<h2>${adding.length} ${adding.length === 1 ? "song" : "songs"} to add</h2>
			${status}
			<ol class="sb-hymns">${draft.map((h, i) => html`<li class="sb-hymn${have.has(h.number) ? " sb-have" : ""}">
				<span class="sb-num">${book.short} ${h.number}</span>
				<span class="sb-hymn-text">
					<input data-i="${i}" value="${h.title}" aria-label="Title of ${book.short} ${h.number}" maxlength="200">
					<small>${have.has(h.number) ? "Already in the book: left as it is." : h.text ? `${h.text.split("\n").filter((l) => l.trim()).length} lines · ${h.firstLine}` : "No words: only its number and title are added."}</small>
				</span>
			</li>`)}</ol>
			<p><button class="btn primary" data-sb="add" ${adding.length ? "" : "disabled"}>${icon("plus")} Add ${adding.length} to ${book.short}</button></p>`.toString() : status.toString();
	};
	const notesHtml = (notes) => (notes.length ? html`<ul class="sb-notes">${notes.map((n) => html`<li>${icon("info")} ${n}</li>`)}</ul>` : "");

	root.addEventListener("submit", (e) => {
		if (!e.target.closest("[data-sb=split]")) return;
		e.preventDefault();
		const f = new FormData(e.target);
		const from = f.get("from") ? Number(f.get("from")) : null;
		try {
			const { entries, notes } = splitHymns(String(f.get("pages") ?? ""), { from });
			draft = entries;
			if (!entries.length) {
				draw(html`<p class="error" role="alert">No song number found${from ? ` starting at ${from}` : ""}. Each song starts at its number, with its title under it or beside it in capitals.</p>`);
				return;
			}
			draw(notesHtml(notes));
		} catch (err) {
			draw(html`<p class="error" role="alert">${err.message}</p>`);
		}
	});
	root.addEventListener("input", (e) => {
		const i = e.target.dataset?.i;
		if (i !== undefined) draft[Number(i)].title = e.target.value;
	});
	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-sb=add]");
		if (!b) return;
		const adding = draft.filter((h) => !have.has(h.number));
		const empty = adding.find((h) => !h.title.trim());
		if (empty) { draw(html`<p class="error" role="alert">${book.short} ${empty.number} needs a title.</p>`); return; }
		b.disabled = true;
		const progress = (done) => { b.textContent = `Adding… ${done} of ${adding.length}`; };
		progress(0);
		try {
			const added = await addHymns(book.id, adding.map((h) => ({ ...h, title: h.title.trim() })), { onStep: progress });
			for (const a of added) have.add(a.number);
			draft = [];
			draw(html`<p class="sb-done">${icon("check")} ${added.length} ${added.length === 1 ? "song" : "songs"} added to ${book.title}. Paste the next pages above.</p>`);
			root.querySelector("textarea[name=pages]").value = "";
			const from = root.querySelector("input[name=from]");
			from.value = String(Math.max(...have) + 1);
		} catch (err) {
			for (const a of err.added ?? []) have.add(a.number);
			draw(html`<p class="error" role="alert">${err instanceof SongbookError ? err.message : `Adding stopped: ${err.message}`}. Those added before it stay; the rest are below, to try again.</p>`);
		}
	});
}
