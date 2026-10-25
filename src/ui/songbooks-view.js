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
import { shadeOf } from "./art.js";
import { scriptClass } from "./parts.js";
import { own } from "./songbook-pages.js";

const notSignedIn = () => html`<div class="empty"><h2>Songbooks</h2><p>Hymn books and praise books, with every song's words, are coming to Zaideih. Those who add them sign in first.</p><p><a class="btn primary" href="#/account">Sign in</a></p></div>`;

/** #/songbooks: the books as covers, found and sorted; New songbook opens a dialog. */
export async function songbooksView() {
	let books, create;
	try {
		({ books, create } = await listBooks());
	} catch (err) {
		return { title: "Songbooks", body: html`<h1>Songbooks</h1><div class="empty"><h2>The songbooks could not be read</h2><p>${err.message}</p></div>` };
	}
	const songs = books.reduce((n, b) => n + b.entries, 0);
	const counts = { all: books.length, public: books.filter((b) => b.public).length, private: books.filter((b) => !b.public).length, yours: books.filter((b) => b.may === "edit" || b.may === "read").length };
	// Filters only when there is something to tell apart: private books, or books one is appointed to.
	const filters = [["all", "All"], ["public", "Public"], ["private", "Private"], ["yours", "Appointed"]].filter(([k]) => k === "all" || (counts[k] && counts[k] < books.length));
	const body = html`<header class="sb-top">
			<div class="sb-top-title"><h1>Songbooks</h1><p class="muted">${books.length ? `${books.length.toLocaleString()} ${books.length === 1 ? "book" : "books"} · ${songs.toLocaleString()} ${songs === 1 ? "song" : "songs"}` : "Hymn books and praise books, with every song's words"}</p></div>
			${create ? html`<button class="btn primary sb-new-btn" data-sb="new" aria-haspopup="dialog">${icon("plus")}<span>New songbook</span></button>` : ""}
		</header>
		${books.length > 1 ? html`<div class="sb-bar">
			<label class="sb-find">${icon("search")}<input type="search" data-sb="find" placeholder="Find a book" aria-label="Find a book by its title, short name or language" autocomplete="off"></label>
			${filters.length > 1 ? html`<div class="segmented sb-show" role="group" aria-label="Show">${filters.map(([k, l], i) => html`<button type="button" data-sb="show" data-show="${k}" aria-pressed="${i === 0}">${l}<span>${counts[k]}</span></button>`)}</div>` : ""}
			<label class="sb-sort"><span class="muted">Sort</span><select data-sb="sort" aria-label="Sort the books"><option value="title">Title</option><option value="songs">Most songs</option><option value="lang">Language</option></select></label>
		</div>` : ""}
		${books.length ? html`<ul class="sb-shelf">${books.map((b) => bookCard(b))}</ul><p class="muted sb-none" hidden>No book matches.</p>`
			: html`<div class="empty sb-empty"><h2>No songbooks yet</h2><p>${create ? "Start with the book's title; its pages come after." : "Hymn books and praise books, with every song's words, are coming to Zaideih."}</p>${create ? html`<p><button class="btn primary" data-sb="new">${icon("plus")} New songbook</button></p>` : ""}</div>`}
		${create ? newBookDialog(books) : ""}`;
	return { title: "Songbooks", ...own(body, (root) => mountList(root, books)) };
}

/** A book as a cover (its short name, a shade of its own) with its title and facts under it. */
function bookCard(b) {
	const role = b.may === "edit" ? "Editor" : b.may === "read" ? "Reader" : "";
	// The language is on the cover.
	const facts = [b.edition && `ed. ${b.edition}`, b.year].filter(Boolean).join(" · ");
	return html`<li class="sb-card" data-title="${b.title.toLowerCase()}" data-find="${`${b.title} ${b.short} ${b.lang} ${b.publisher ?? ""}`.toLowerCase()}" data-songs="${b.entries}" data-lang="${b.lang}" data-public="${b.public}" data-yours="${Boolean(role)}">
		<a class="sb-card-open" href="${href(`songbook/${b.id}`)}">
			${coverHtml(b)}
			<span class="sb-card-text">
				<b class="${scriptClass(b.title)}">${b.title}</b>
				<small>${facts}${facts ? " · " : ""}${b.entries.toLocaleString()} ${b.entries === 1 ? "song" : "songs"}</small>
				${!b.public || role ? html`<small class="sb-card-status">${b.public ? "" : html`<span>${icon("lock")} Private</span>`}${role ? html`<span class="sb-role">${role}</span>` : ""}</small>` : ""}
			</span>
		</a>
		${mayEdit(b.may) ? html`<a class="sb-card-act" href="${href("songbooks/import", { book: b.id })}" title="Add pages to ${b.title}" aria-label="Add pages to ${b.title}">${icon("upload")}</a>` : ""}
	</li>`;
}

/** The short name's size on the cover: smaller as it gets longer, so TL and T1995 both fit. */
export const shortSize = (short) => ({ 0: 24, 1: 26, 2: 26, 3: 22, 4: 19 })[String(short).length] ?? 15;

/** The cover: the short name large, a shade from the book's id, a spine, the language as an imprint; `b` may be a draft. */
export function coverHtml(b, cls = "") {
	return html`<span class="sb-cover p-grooves ${cls}" style="--g:${shadeOf(`sb${b.id ?? b.short}`)}%; --sz:${shortSize(b.short || "?")}cqi" aria-hidden="true"><span class="sb-cover-short">${b.short || "?"}</span><span class="mark"></span><span class="sb-cover-imprint">${b.lang ?? ""}</span></span>`;
}

/** Initials of a title, for its short name: "Tedim Labu" → "TL". */
const initials = (title) => title.normalize("NFC").split(/[\s\-–]+/u).map((w) => w.match(/[A-Za-z0-9]/)?.[0] ?? "").join("").toUpperCase().slice(0, 8);

function newBookDialog(books) {
	const langs = [...new Set(books.map((b) => b.lang))].sort();
	return html`<dialog class="sb-dialog" data-sb="dialog" aria-labelledby="sb-new-title">
		<form method="dialog" class="sb-create" data-sb="new-book" novalidate>
			<figure class="sb-create-preview">${coverHtml({ short: "", lang: "" }, "sb-cover-preview")}<figcaption></figcaption></figure>
			<div class="sb-create-main">
				<h2 id="sb-new-title">New songbook</h2>
				<p class="muted">One edition of a book. It stays private until its rights are settled and the owner makes it public.</p>
				<label class="sb-field"><span>Title</span><input name="title" required maxlength="200" placeholder="Tedim Labu" autocomplete="off"></label>
				<div class="sb-fields">
					<label class="sb-field"><span>Short name <small>for numbers, as TL 145</small></span><input name="short" required maxlength="8" pattern="[A-Za-z0-9]{1,8}" placeholder="TL" autocomplete="off" autocapitalize="characters"></label>
					<label class="sb-field"><span>Language</span><input name="lang" required maxlength="20" pattern="[a-z][a-z\\-]{1,19}" placeholder="tedim" list="sb-langs" autocomplete="off" autocapitalize="none"></label>
				</div>
				<datalist id="sb-langs">${langs.map((l) => html`<option value="${l}"></option>`)}</datalist>
				<details class="sb-more"><summary>Edition, year and publisher</summary>
					<div class="sb-fields">
						<label class="sb-field"><span>Edition</span><input name="edition" maxlength="200" placeholder="1995"></label>
						<label class="sb-field"><span>Year</span><input name="year" type="number" min="100" max="2100" inputmode="numeric"></label>
						<label class="sb-field sb-wide"><span>Publisher</span><input name="publisher" maxlength="200"></label>
					</div>
				</details>
				<p class="error" role="alert" hidden></p>
				<div class="sb-dialog-end">
					<button class="btn" type="button" data-sb="cancel">Cancel</button>
					<button class="btn primary" type="submit" value="create">Create songbook</button>
				</div>
			</div>
		</form>
	</dialog>`;
}

function mountList(root, books) {
	const shelf = root.querySelector(".sb-shelf");
	const dialog = root.querySelector("[data-sb=dialog]");
	const cards = shelf ? [...shelf.children] : [];
	let show = "all";
	const filter = () => {
		const q = (root.querySelector("[data-sb=find]")?.value ?? "").trim().toLowerCase();
		let shown = 0;
		for (const li of cards) {
			const d = li.dataset;
			const on = (!q || d.find.includes(q)) && (show === "all" || (show === "public" && d.public === "true") || (show === "private" && d.public === "false") || (show === "yours" && d.yours === "true"));
			li.hidden = !on;
			if (on) shown += 1;
		}
		const none = root.querySelector(".sb-none");
		if (none) none.hidden = shown > 0;
	};
	const sort = (by) => {
		const key = {
			title: (a, b) => a.dataset.title.localeCompare(b.dataset.title),
			songs: (a, b) => Number(b.dataset.songs) - Number(a.dataset.songs) || a.dataset.title.localeCompare(b.dataset.title),
			lang: (a, b) => a.dataset.lang.localeCompare(b.dataset.lang) || a.dataset.title.localeCompare(b.dataset.title),
		}[by];
		shelf.append(...cards.sort(key));
	};
	root.addEventListener("input", (e) => {
		if (e.target.dataset.sb === "find") filter();
	});
	root.addEventListener("change", (e) => {
		if (e.target.dataset.sb === "sort") sort(e.target.value);
	});

	const form = dialog?.querySelector("form");
	const taken = new Map(books.map((b) => [b.short.toLowerCase(), b.title]));
	let shortEdited = false;
	const preview = () => {
		const f = new FormData(form);
		const cover = form.querySelector(".sb-cover-preview");
		const short = String(f.get("short") || "?");
		cover.querySelector(".sb-cover-short").textContent = short;
		cover.style.setProperty("--sz", `${shortSize(short)}cqi`);
		cover.querySelector(".sb-cover-imprint").textContent = String(f.get("lang") ?? "");
		const title = form.querySelector(".sb-create-preview figcaption");
		title.textContent = String(f.get("title") || "");
		title.className = scriptClass(title.textContent);
	};
	const say = (message) => {
		const error = form.querySelector(".error");
		error.textContent = message;
		error.hidden = !message;
	};
	root.addEventListener("click", (e) => {
		const b = e.target.closest("[data-sb]");
		if (!b) return;
		if (b.dataset.sb === "show") {
			show = b.dataset.show;
			for (const x of root.querySelectorAll("[data-sb=show]")) x.setAttribute("aria-pressed", String(x === b));
			filter();
		} else if (b.dataset.sb === "new" && dialog) {
			dialog.showModal();
			form.querySelector("[name=title]").focus();
		} else if (b.dataset.sb === "cancel") {
			dialog.close();
		}
	});
	// A click on the backdrop closes the dialog, as Escape does.
	dialog?.addEventListener("click", (e) => {
		if (e.target === dialog) dialog.close();
	});
	form?.addEventListener("input", (e) => {
		const el = e.target;
		if (el.name === "short") {
			shortEdited = el.value !== "";
			el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
		}
		if (el.name === "lang") el.value = el.value.toLowerCase();
		if (el.name === "title" && !shortEdited) form.elements.short.value = initials(el.value);
		const short = form.elements.short.value.toLowerCase();
		say(taken.has(short) ? `${form.elements.short.value} is already the short name of ${taken.get(short)}.` : "");
		preview();
	});
	form?.addEventListener("submit", async (e) => {
		e.preventDefault();
		const f = new FormData(form);
		const missing = ["title", "short", "lang"].find((k) => !String(f.get(k) ?? "").trim());
		if (missing) {
			say(`${{ title: "The title", short: "A short name", lang: "The language" }[missing]} is needed.`);
			form.elements[missing].focus();
			return;
		}
		for (const el of [form.elements.short, form.elements.lang, form.elements.year]) {
			if (!el.checkValidity()) {
				say(el.name === "short" ? "The short name is 1 to 8 letters or digits." : el.name === "lang" ? "The language is its name in lower case, such as tedim or english." : "The year is a year, such as 1995.");
				el.focus();
				return;
			}
		}
		const fields = { title: f.get("title"), short: f.get("short"), lang: String(f.get("lang")).trim().toLowerCase(), edition: f.get("edition"), publisher: f.get("publisher") };
		if (f.get("year")) fields.year = Number(f.get("year"));
		const submit = form.querySelector("button[type=submit]");
		try {
			submit.disabled = true;
			const book = await createBook(fields);
			dialog.close();
			location.hash = href("songbooks/import", { book: book.id });
		} catch (err) {
			say(err.message);
			submit.disabled = false;
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
