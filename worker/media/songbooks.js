/**
 * Songbooks (docs/songbooks.md): hymnals and praise books as lyrics
 * collections, with the works, people and credits behind their texts.
 *
 * A book is one edition; its entries are hymn numbers, each printing one
 * text. A text is one singable version of a work in one language; its words
 * are lyrics rows under the text's id (lyrics.js), so they are versioned,
 * reported and restored like any lyrics. Text ids start at TEXT_BASE, far
 * above any track id, so the lyrics routes take either.
 *
 * A book is private until its rights are settled and the owner or a co-owner
 * makes it public: until then its entries and texts are seen only with the
 * Songbooks right, or by those appointed to the book (songbook_members): an
 * editor changes the book, its numbers and its songs (words, details,
 * credits, recordings joined); a reader sees it. The owner, co-owners and
 * the Songbooks right appoint them, on any book. A book's `may` says what
 * the signed-in person may do with it: manage (everything, appointing too),
 * edit, read, or null (a listener of a public book). A person or a work is public once one of their texts is.
 * Recordings join a text as shared lyrics (lyrics.js, link): the text is the
 * source; a recording joined to a private text shows nothing. Making a book
 * public or private touches its texts and their links, so the app's lyrics
 * index takes them in or drops them.
 *
 *   GET  /songbooks                        public books, and the private ones the person may see
 *   GET  /songbooks/index                  every hymn of those books, [text, book, number, title],
 *                                          for the app's search (cached 5 minutes when public)
 *   POST /songbooks {title, short, lang, edition, year, publisher}
 *                                          Songbooks right: a new book, private
 *   GET  /songbooks/:book                  the book and its entries (private: the right or appointed)
 *   GET  /songbooks/:book/collaborators    those appointed to it (the right)
 *   POST /songbooks/:book/collaborators {member, role}
 *                                          the right: appoints a member as editor or
 *                                          reader; role null takes them off
 *   GET  /songbooks/members?q=             the right: members by name, to appoint
 *   POST /songbooks/:book {...the fields above, rights, rightsNote, public}
 *                                          the right or an editor; making a book public is for
 *                                          the owner and co-owners, with its rights settled
 *   POST /songbooks/:book/entries {number, text | title, lang, firstLine, work}
 *                                          the right or an editor: hymn `number` prints text
 *                                          `text`, or a new text made from the rest
 *   POST /songbooks/:book/entries/:number {number | text | remove | delete}
 *                                          the right or an editor: another number; another
 *                                          text; taken out (the text stays); deleted:
 *                                          the number, and the text with its words and
 *                                          history when no other book prints it (refused
 *                                          while recordings are joined to it; in a
 *                                          public book, the owner and co-owners only)
 *   GET  /songbooks/texts/:id              a text: its work and credits, the books
 *                                          printing it, its words (private: the right)
 *   POST /songbooks/texts/:id {title, lang, firstLine, work, from, credits}
 *                                          the right, or an editor of a book printing it
 *   GET  /songbooks/people/:id             what a person wrote, composed or translated (public
 *                                          texts only, without the right)
 *   GET  /songbooks/people?q=              Songbooks right: people by name
 *   POST /songbooks/people {name, aka, born, died, note}
 *   POST /songbooks/people/:id {...}
 *   GET  /songbooks/works/:id              a work, its credits and texts (public texts only, without the right)
 *   GET  /songbooks/works?q=               Songbooks right: works by title or tune
 *   POST /songbooks/works {title, lang, tune, metre, year, scripture, topics, note, credits}
 *   POST /songbooks/works/:id {...}
 *
 * People and works are shared by every book: the right finds, adds and
 * changes them; an editor of a book finds and adds them, and changes those
 * credited on (or the works of) the texts of their books.
 *
 * Credits are [{ person, role }]: on a work, words, music or arrangement; on
 * a text, translation or words (words adapted in that language).
 */
import { MemberError, can, memberRow } from "./members.js";
import { sessionMember } from "./accounts.js";

/** Text ids start here: far above any track id, so the lyrics routes tell them apart. */
export const TEXT_BASE = 10_000_000_000;
export const isText = (id) => id >= TEXT_BASE;

const RIGHTS_STATES = ["unsettled", "permission", "public-domain"];
const WORK_ROLES = ["words", "music", "arrangement"];
const TEXT_ROLES = ["translation", "words"];
const LANG = /^[a-z][a-z-]{1,19}$/;
const SHORT = /^[A-Za-z0-9]{1,8}$/;
const MAX_NUMBER = 99_999;
const PEOPLE_LIMIT = 50;
/** Roles on one book (songbook_members). */
export const BOOK_ROLES = Object.freeze(["editor", "reader"]);
const RANK = { read: 1, edit: 2, manage: 3 };

function answer(status, body, cors, extra = {}) {
	const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
	if (cors) headers.set("Access-Control-Allow-Origin", cors);
	if (cors && cors !== "*") headers.set("Vary", "Origin");
	return new Response(JSON.stringify(body), { status, headers });
}

async function readBody(request) {
	const text = await request.text();
	if (text.length > 64 * 1024) throw new MemberError("request body too large", 413);
	try {
		const v = JSON.parse(text || "{}");
		if (v && typeof v === "object" && !Array.isArray(v)) return v;
	} catch { /* below */ }
	throw new MemberError("body must be a JSON object");
}

/* ------------------------------------------------------------ fields ---- */

/** A text field: trimmed, one line, at most `max` characters; `required` refuses empty. */
function str(body, name, { max = 200, required = false, fallback = "" } = {}) {
	const v = body[name];
	if (v === undefined || v === null) {
		// Not sent: the value it has (an update), or needed (a new record).
		if (required && !fallback) throw new MemberError(`${name} is needed`);
		return fallback;
	}
	if (typeof v !== "string") throw new MemberError(`${name} must be text`);
	const clean = v.normalize("NFC").replace(/\s+/g, " ").trim();
	if (required && !clean) throw new MemberError(`${name} is needed`);
	if (clean.length > max) throw new MemberError(`${name} may be at most ${max} characters`);
	return clean;
}

function year(body, name) {
	const v = body[name];
	if (v === undefined || v === null || v === "") return null;
	if (!Number.isSafeInteger(v) || v < 100 || v > 2100) throw new MemberError(`${name} must be a year, or none`);
	return v;
}

function lang(body, { required = true, fallback = "" } = {}) {
	const v = str(body, "lang", { max: 20, required, fallback });
	if (v && !LANG.test(v)) throw new MemberError("lang must be a language name in lower case, such as tedim or english");
	return v;
}

function id(v, what) {
	if (!Number.isSafeInteger(v) || v <= 0) throw new MemberError(`${what} must be an id`);
	return v;
}

/* ------------------------------------------------------------- reads ---- */

/** True when a text is printed in a public book. */
/**
 * Texts whose place in a public book changed (added, taken out, replaced):
 * they, and the recordings showing them, count as changed in the app's
 * lyrics index, which then adds or drops them (lyrics.js index).
 */
async function touchTexts(env, ids, nowSeconds) {
	const list = [...new Set(ids)];
	const marks = list.map((_, i) => `?${i + 2}`).join(", ");
	await env.DB.batch([
		env.DB.prepare(`UPDATE lyrics SET changed_at = ?1 WHERE track IN (${marks})`).bind(nowSeconds, ...list),
		env.DB.prepare(`UPDATE lyrics_links SET at = ?1 WHERE unlinked_at IS NULL AND source IN (${marks})`).bind(nowSeconds, ...list),
	]);
}

export async function textIsPublic(env, textId) {
	const row = await env.DB.prepare("SELECT 1 AS yes FROM songbook_entries e JOIN songbooks b ON b.id = e.book_id WHERE e.text_id = ?1 AND b.public = 1 LIMIT 1").bind(textId).first();
	return Boolean(row);
}

export async function textExists(env, textId) {
	return Boolean(await env.DB.prepare("SELECT 1 AS yes FROM song_texts WHERE id = ?1").bind(textId).first());
}

/* ------------------------------------------------------------ access ---- */

const NOBODY = Object.freeze({ me: null, all: false, publish: false, books: new Map() });

/**
 * What a person may do with the songbooks: `all` (the Songbooks right: every
 * book, appointing too), `publish` (owner and co-owners: public or private),
 * `books` (Map<book id, "editor" | "reader">, those appointed to). A blocked
 * member, or nobody signed in, sees what the public sees.
 */
async function accessOf(env, me) {
	if (!me || me.blocked) return NOBODY;
	const all = can(me, "songbooks");
	const rows = all ? [] : (await env.DB.prepare("SELECT book_id, role FROM songbook_members WHERE member_id = ?1").bind(me.id).all()).results ?? [];
	return { me, all, publish: me.role === "owner" || me.rights.has("manage"), books: new Map(rows.map((r) => [r.book_id, r.role])) };
}

/** What `acc` may do with book `b`: "manage", "edit", "read", or null. */
function mayOn(acc, b) {
	if (acc.all) return "manage";
	const role = acc.books.get(b.id);
	return role === "editor" ? "edit" : role === "reader" ? "read" : null;
}

/** The ids of the books `acc` is appointed to as an editor. */
const editsOf = (acc) => [...acc.books].filter(([, r]) => r === "editor").map(([b]) => b);
const ids = (list) => (list.length ? list.map(Number).join(", ") : "0");

/** SQL: book alias `b` is seen by `acc` (public, or the right, or appointed). */
const SEEN_SQL = (b, acc) => (acc.all ? "1 = 1" : `(${b}.public = 1 OR ${b}.id IN (${ids([...acc.books.keys()])}))`);

/** What `acc` may do with text `textId`: the most it may do with a book printing it. */
async function textMay(env, acc, textId) {
	if (acc.all) return "manage";
	if (!acc.books.size) return null;
	const rows = (await env.DB.prepare("SELECT book_id FROM songbook_entries WHERE text_id = ?1").bind(textId).all()).results ?? [];
	let best = null;
	for (const r of rows) {
		const may = mayOn(acc, { id: r.book_id });
		if (may && (!best || RANK[may] > RANK[best])) best = may;
	}
	return best;
}

/**
 * What member `me` may do with songbook text `textId`, for the lyrics routes
 * (lyrics.js): "manage", "edit", "read", or null.
 */
export async function textAccess(env, me, textId) {
	return textMay(env, await accessOf(env, me), textId);
}

const atLeast = (may, want) => Boolean(may) && RANK[may] >= RANK[want];

const bookShape = (b, may = null) => ({
	id: b.id, title: b.title, short: b.short, lang: b.lang, edition: b.edition, year: b.year, publisher: b.publisher,
	rights: b.rights, rightsNote: b.rights_note, public: Boolean(b.public), entries: b.entries ?? 0, may,
});

/** Book `bookId` as `acc` may see it; a private book is not there for others: no hint that it exists. */
async function bookRow(env, bookId, acc) {
	const b = await env.DB.prepare("SELECT * FROM songbooks WHERE id = ?1").bind(bookId).first();
	if (!b || (!b.public && !mayOn(acc, b))) throw new MemberError(`there is no songbook ${bookId}`, 404);
	return b;
}

async function creditsOf(env, subject, subjectId) {
	const rows = (await env.DB.prepare(`SELECT c.person_id, c.role, p.name FROM song_credits c JOIN song_people p ON p.id = c.person_id
		WHERE c.subject = ?1 AND c.subject_id = ?2 ORDER BY c.role, p.name`).bind(subject, subjectId).all()).results ?? [];
	return rows.map((r) => ({ person: r.person_id, name: r.name, role: r.role }));
}

/** Credits from the body, checked: every person exists, every role fits the subject. */
async function readCredits(env, body, roles) {
	if (body.credits === undefined) return null;
	if (!Array.isArray(body.credits) || body.credits.length > 30) throw new MemberError("credits must be a list of { person, role }, at most 30");
	const out = [];
	for (const c of body.credits) {
		if (!c || typeof c !== "object") throw new MemberError("each credit is { person, role }");
		const person = id(c.person, "a credit's person");
		if (!roles.includes(c.role)) throw new MemberError(`a credit's role must be one of ${roles.join(", ")}`);
		if (!(await env.DB.prepare("SELECT 1 AS yes FROM song_people WHERE id = ?1").bind(person).first())) throw new MemberError(`there is no person ${person}`, 404);
		out.push({ person, role: c.role });
	}
	return out;
}

const writeCredits = (env, subject, subjectId, credits) => [
	env.DB.prepare("DELETE FROM song_credits WHERE subject = ?1 AND subject_id = ?2").bind(subject, subjectId),
	...credits.map((c) => env.DB.prepare("INSERT OR IGNORE INTO song_credits (subject, subject_id, person_id, role) VALUES (?1, ?2, ?3, ?4)").bind(subject, subjectId, c.person, c.role)),
];

/** SQL: text `col` is printed in a book `acc` sees. */
const SEEN_TEXT_SQL = (col, acc) => (acc.all ? "1 = 1" : `EXISTS (SELECT 1 FROM songbook_entries pe JOIN songbooks pb ON pb.id = pe.book_id WHERE pe.text_id = ${col} AND ${SEEN_SQL("pb", acc)})`);
/** SQL: where text `col` is printed first ("TL 145") among the books `acc` sees, in title order. */
const LABEL_SQL = (col, acc) => `(SELECT lb.short || ' ' || le.number FROM songbook_entries le JOIN songbooks lb ON lb.id = le.book_id
	WHERE le.text_id = ${col} AND ${SEEN_SQL("lb", acc)} ORDER BY lb.title, le.number LIMIT 1)`;

async function textShape(env, t, acc) {
	const may = await textMay(env, acc, t.id);
	const editor = atLeast(may, "edit");
	const entries = (await env.DB.prepare(`SELECT e.number, b.id, b.short, b.title, b.public FROM songbook_entries e JOIN songbooks b ON b.id = e.book_id
		WHERE e.text_id = ?1 ORDER BY b.title, e.number`).bind(t.id).all()).results ?? [];
	const work = t.work_id ? await env.DB.prepare("SELECT id, title, lang, tune, metre, year, scripture, topics FROM song_works WHERE id = ?1").bind(t.work_id).first() : null;
	const words = (await env.DB.prepare("SELECT lang, version, text, hidden_at FROM lyrics WHERE track = ?1 ORDER BY lang").bind(t.id).all()).results ?? [];
	return {
		id: t.id, title: t.title, lang: t.lang, firstLine: t.first_line, from: t.from_text,
		credits: await creditsOf(env, "text", t.id),
		work: work ? { ...work, credits: await creditsOf(env, "work", work.id) } : null,
		may,
		books: entries.filter((e) => e.public || mayOn(acc, e)).map((e) => ({ book: e.id, short: e.short, title: e.title, number: e.number, may: mayOn(acc, e) })),
		lyrics: words.filter((w) => editor || !w.hidden_at).map((w) => ({ lang: w.lang, version: w.version, text: w.text, hidden: Boolean(w.hidden_at) })),
		// The recordings that show this text (lyrics_links, as shared lyrics).
		recordings: ((await env.DB.prepare("SELECT track FROM lyrics_links WHERE source = ?1 AND unlinked_at IS NULL ORDER BY track").bind(t.id).all()).results ?? []).map((r) => r.track),
		// Other versions of the same work: the original, other translations.
		versions: work ? ((await env.DB.prepare(`SELECT t.id, t.title, t.lang, ${LABEL_SQL("t.id", acc)} AS label FROM song_texts t
			WHERE t.work_id = ?1 AND t.id <> ?2 AND ${SEEN_TEXT_SQL("t.id", acc)} ORDER BY t.lang, t.title`).bind(work.id, t.id).all()).results ?? []) : [],
	};
}

/** Person `pid` is credited on a text of a book `acc` edits, or on the work of one. */
async function personEditable(env, acc, pid) {
	const books = editsOf(acc);
	if (!books.length) return false;
	return Boolean(await env.DB.prepare(`SELECT 1 AS yes FROM song_credits c JOIN songbook_entries e ON e.book_id IN (${ids(books)})
		JOIN song_texts t ON t.id = e.text_id
		WHERE c.person_id = ?1 AND ((c.subject = 'text' AND c.subject_id = t.id) OR (c.subject = 'work' AND c.subject_id = t.work_id)) LIMIT 1`).bind(pid).first());
}

/** Work `wid` has a text in a book `acc` edits. */
async function workEditable(env, acc, wid) {
	const books = editsOf(acc);
	if (!books.length) return false;
	return Boolean(await env.DB.prepare(`SELECT 1 AS yes FROM songbook_entries e JOIN song_texts t ON t.id = e.text_id
		WHERE e.book_id IN (${ids(books)}) AND t.work_id = ?1 LIMIT 1`).bind(wid).first());
}

/** Text `textId` exists and `acc` may see it (public, or in a book it sees): one to print in a book. */
async function seenText(env, acc, textId) {
	if (!isText(textId) || !(await textExists(env, textId)) || (!(await textMay(env, acc, textId)) && !(await textIsPublic(env, textId)))) throw new MemberError(`there is no text ${textId}`, 404);
}

async function collaboratorsOf(env, bookId) {
	const rows = (await env.DB.prepare(`SELECT s.member_id, s.role, s.added_by, s.at, m.name FROM songbook_members s JOIN members m ON m.id = s.member_id
		WHERE s.book_id = ?1 ORDER BY s.role, m.name`).bind(bookId).all()).results ?? [];
	return rows.map((r) => ({ member: r.member_id, name: r.name, role: r.role, addedBy: r.added_by, at: r.at }));
}

/* ----------------------------------------------------------- writes ---- */

/** A new text (and its id, the next from TEXT_BASE). */
async function newText(env, { title, textLang, firstLine, work }, me, nowSeconds) {
	if (work !== null && !(await env.DB.prepare("SELECT 1 AS yes FROM song_works WHERE id = ?1").bind(work).first())) throw new MemberError(`there is no work ${work}`, 404);
	const row = await env.DB.prepare(`INSERT INTO song_texts (id, work_id, lang, title, first_line, created_by, at)
		SELECT COALESCE(MAX(id), ?1 - 1) + 1, ?2, ?3, ?4, ?5, ?6, ?7 FROM song_texts RETURNING id`).bind(TEXT_BASE, work, textLang, title, firstLine, me.login, nowSeconds).first();
	return row.id;
}

/** The signed-in member, not blocked, and what they may do (accessOf). */
async function writer(env, request, nowSeconds) {
	const me = await memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds);
	if (me.blocked) throw new MemberError(`blocked by ${me.blocked.by}: ${me.blocked.reason}`, 403);
	return accessOf(env, me);
}

const needAll = (acc) => {
	if (!acc.all) throw new MemberError("this needs the Songbooks right", 403);
};
/** The right, or an editor of at least one book: finding and adding people and works. */
const needSomeEdit = (acc) => {
	if (!acc.all && !editsOf(acc).length) throw new MemberError("this needs the Songbooks right, or to be an editor of a songbook", 403);
};
const needOn = (may, want, what) => {
	if (!atLeast(may, want)) throw new MemberError(`${what} needs the Songbooks right, or to be appointed to the book as an editor`, 403);
};

/** What the person may do when a session is sent, else what the public may; a session that is sent and fails is refused. */
async function viewer(env, request, nowSeconds) {
	if (!request.headers.get("authorization")) return NOBODY;
	return accessOf(env, await memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds));
}

export async function handleSongbooks(request, env, ctx, { now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const parts = url.pathname.replace(/^\/songbooks\/?/, "").split("/").filter(Boolean);
	const origin = request.headers.get("origin");
	const origins = new Set((env.AUTH_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
	const cors = origin && origins.has(origin) ? origin : null;
	const m = request.method;
	if (m === "OPTIONS") {
		if (!cors) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } });
	}
	const nowSeconds = Math.floor(now() / 1000);
	try {
		if (!env.DB) throw new MemberError("songbooks are not set up on this Worker: missing DB", 503);
		if (m !== "GET" && m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 405);
		if (m === "POST" && !cors) throw new MemberError("this origin may not change songbooks (AUTH_ORIGINS)", 403);
		const reply = (status, body) => answer(status, body, cors ?? "*");

		// GET /songbooks
		if (!parts.length && m === "GET") {
			const acc = await viewer(env, request, nowSeconds);
			const rows = (await env.DB.prepare(`SELECT b.*, (SELECT COUNT(*) FROM songbook_entries e WHERE e.book_id = b.id) AS entries FROM songbooks b
				WHERE ${SEEN_SQL("b", acc)} ORDER BY b.title`).all()).results ?? [];
			return reply(200, { books: rows.map((b) => bookShape(b, mayOn(acc, b))), create: acc.all, publish: acc.publish });
		}
		// GET /songbooks/index: every hymn of the books, for the app's search and lookups.
		if (parts[0] === "index" && parts.length === 1 && m === "GET") {
			const acc = await viewer(env, request, nowSeconds);
			const books = (await env.DB.prepare(`SELECT id, short, title, lang, public FROM songbooks b WHERE ${SEEN_SQL("b", acc)} ORDER BY title`).all()).results ?? [];
			const entries = (await env.DB.prepare(`SELECT e.text_id, e.book_id, e.number, t.title FROM songbook_entries e JOIN songbooks b ON b.id = e.book_id JOIN song_texts t ON t.id = e.text_id
				WHERE ${SEEN_SQL("b", acc)} ORDER BY e.book_id, e.number`).all()).results ?? [];
			const signed = acc !== NOBODY;
			return answer(200, {
				books: books.map((b) => ({ id: b.id, short: b.short, title: b.title, lang: b.lang, public: Boolean(b.public), may: mayOn(acc, b) })),
				entries: entries.map((e) => [e.text_id, e.book_id, e.number, e.title]),
			}, cors ?? "*", signed ? {} : { "Cache-Control": "public, max-age=300" });
		}
		// GET /songbooks/members?q=: members by name, for appointing to a book.
		if (parts[0] === "members" && parts.length === 1 && m === "GET") {
			needAll(await writer(env, request, nowSeconds));
			const q = (url.searchParams.get("q") ?? "").trim();
			if (q.length < 2) throw new MemberError("q must be at least 2 letters of a name");
			const rows = (await env.DB.prepare(`SELECT m.id, m.name, (SELECT GROUP_CONCAT(COALESCE(l.login, l.email), ', ') FROM member_logins l WHERE l.member_id = m.id) AS logins
				FROM members m WHERE m.blocked_at IS NULL AND (m.name LIKE '%' || ?1 || '%' OR EXISTS (SELECT 1 FROM member_logins l WHERE l.member_id = m.id AND (l.login LIKE '%' || ?1 || '%' OR l.email LIKE '%' || ?1 || '%')))
				ORDER BY m.name LIMIT ?2`).bind(q, PEOPLE_LIMIT).all()).results ?? [];
			return reply(200, { members: rows.map((r) => ({ id: r.id, name: r.name, logins: r.logins ?? "" })) });
		}
		// POST /songbooks
		if (!parts.length) {
			const acc = await writer(env, request, nowSeconds);
			needAll(acc);
			const me = acc.me;
			const body = await readBody(request);
			const title = str(body, "title", { required: true });
			const short = str(body, "short", { max: 8, required: true });
			if (!SHORT.test(short)) throw new MemberError("short must be 1 to 8 letters or digits, such as TL");
			if (await env.DB.prepare("SELECT 1 AS yes FROM songbooks WHERE short = ?1 COLLATE NOCASE").bind(short).first()) throw new MemberError(`another songbook is already called ${short}`, 409);
			const row = await env.DB.prepare(`INSERT INTO songbooks (title, short, lang, edition, year, publisher, created_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING *`)
				.bind(title, short, lang(body), str(body, "edition"), year(body, "year"), str(body, "publisher"), me.login, nowSeconds).first();
			return reply(201, bookShape(row, "manage"));
		}

		// /songbooks/people
		if (parts[0] === "people") {
			// A person's page: what they wrote, composed or translated (public texts only, without the right).
			if (parts.length === 2 && m === "GET") {
				const pid = id(Number(parts[1]), "the person");
				const acc = await viewer(env, request, nowSeconds);
				const p = await env.DB.prepare("SELECT id, name, aka, born, died, note FROM song_people WHERE id = ?1").bind(pid).first();
				if (!p) throw new MemberError(`there is no person ${pid}`, 404);
				const works = (await env.DB.prepare(`SELECT w.id, w.title, w.lang, c.role FROM song_credits c JOIN song_works w ON w.id = c.subject_id
					WHERE c.subject = 'work' AND c.person_id = ?1 ${acc.all ? "" : `AND EXISTS (SELECT 1 FROM song_texts vt WHERE vt.work_id = w.id AND ${SEEN_TEXT_SQL("vt.id", acc)})`} ORDER BY w.title`).bind(pid).all()).results ?? [];
				const texts = (await env.DB.prepare(`SELECT t.id, t.title, t.lang, c.role, ${LABEL_SQL("t.id", acc)} AS label FROM song_credits c JOIN song_texts t ON t.id = c.subject_id
					WHERE c.subject = 'text' AND c.person_id = ?1 AND ${SEEN_TEXT_SQL("t.id", acc)} ORDER BY t.title`).bind(pid).all()).results ?? [];
				if (!acc.all && !works.length && !texts.length) throw new MemberError(`there is no person ${pid}`, 404);
				return reply(200, { ...p, works, texts, may: acc.all || await personEditable(env, acc, pid) ? "edit" : null });
			}
			const acc = await writer(env, request, nowSeconds);
			needSomeEdit(acc);
			const me = acc.me;
			if (parts.length === 1 && m === "GET") {
				const q = (url.searchParams.get("q") ?? "").trim();
				const rows = (await env.DB.prepare("SELECT id, name, aka, born, died, note FROM song_people WHERE ?1 = '' OR name LIKE '%' || ?1 || '%' OR aka LIKE '%' || ?1 || '%' ORDER BY name LIMIT ?2").bind(q, PEOPLE_LIMIT).all()).results ?? [];
				return reply(200, { people: rows });
			}
			if (m !== "POST" || parts.length > 2) throw new MemberError(`no route ${m} ${url.pathname}`, 404);
			const body = await readBody(request);
			const fields = [str(body, "name", { required: true }), str(body, "aka"), year(body, "born"), year(body, "died"), str(body, "note", { max: 1000 })];
			if (parts.length === 1) {
				const row = await env.DB.prepare("INSERT INTO song_people (name, aka, born, died, note, created_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id, name, aka, born, died, note").bind(...fields, me.login, nowSeconds).first();
				return reply(201, row);
			}
			const pid = id(Number(parts[1]), "the person");
			if (!acc.all && !(await personEditable(env, acc, pid))) throw new MemberError("changing this person needs the Songbooks right: they are credited only outside the books you edit", 403);
			const row = await env.DB.prepare("UPDATE song_people SET name = ?2, aka = ?3, born = ?4, died = ?5, note = ?6 WHERE id = ?1 RETURNING id, name, aka, born, died, note").bind(pid, ...fields).first();
			if (!row) throw new MemberError(`there is no person ${pid}`, 404);
			return reply(200, row);
		}

		// /songbooks/works
		if (parts[0] === "works") {
			const wid = parts[1] === undefined ? null : id(Number(parts[1]), "the work");
			// A work: its credits and its texts (public ones only, without the right).
			if (wid !== null && m === "GET" && parts.length === 2) {
				const acc = await viewer(env, request, nowSeconds);
				const w = await env.DB.prepare("SELECT * FROM song_works WHERE id = ?1").bind(wid).first();
				const texts = w ? (await env.DB.prepare(`SELECT t.id, t.title, t.lang, ${LABEL_SQL("t.id", acc)} AS label FROM song_texts t
					WHERE t.work_id = ?1 AND ${SEEN_TEXT_SQL("t.id", acc)} ORDER BY t.lang, t.title`).bind(wid).all()).results ?? [] : [];
				if (!w || (!acc.all && !texts.length)) throw new MemberError(`there is no work ${wid}`, 404);
				return reply(200, { id: w.id, title: w.title, lang: w.lang, tune: w.tune, metre: w.metre, year: w.year, scripture: w.scripture, topics: w.topics, note: w.note, credits: await creditsOf(env, "work", wid), texts, may: acc.all || await workEditable(env, acc, wid) ? "edit" : null });
			}
			const acc = await writer(env, request, nowSeconds);
			needSomeEdit(acc);
			const me = acc.me;
			if (wid === null && m === "GET" && parts.length === 1) {
				const q = (url.searchParams.get("q") ?? "").trim();
				const rows = (await env.DB.prepare("SELECT id, title, lang, tune, year FROM song_works WHERE ?1 = '' OR title LIKE '%' || ?1 || '%' OR tune LIKE '%' || ?1 || '%' ORDER BY title LIMIT ?2").bind(q, PEOPLE_LIMIT).all()).results ?? [];
				return reply(200, { works: rows });
			}
			if (m !== "POST" || parts.length > 2) throw new MemberError(`no route ${m} ${url.pathname}`, 404);
			const body = await readBody(request);
			const fields = [str(body, "title", { required: true }), lang(body), str(body, "tune"), str(body, "metre", { max: 40 }), year(body, "year"), str(body, "scripture", { max: 300 }), str(body, "topics", { max: 300 }), str(body, "note", { max: 1000 })];
			if (wid !== null && !acc.all && !(await workEditable(env, acc, wid))) throw new MemberError("changing this work needs the Songbooks right: none of its texts is in a book you edit", 403);
			const credits = await readCredits(env, body, WORK_ROLES);
			let workId = wid;
			if (workId === null) {
				workId = (await env.DB.prepare("INSERT INTO song_works (title, lang, tune, metre, year, scripture, topics, note, created_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id").bind(...fields, me.login, nowSeconds).first()).id;
			} else if (!(await env.DB.prepare("UPDATE song_works SET title = ?2, lang = ?3, tune = ?4, metre = ?5, year = ?6, scripture = ?7, topics = ?8, note = ?9 WHERE id = ?1").bind(workId, ...fields).run()).meta?.changes) {
				throw new MemberError(`there is no work ${workId}`, 404);
			}
			if (credits) await env.DB.batch(writeCredits(env, "work", workId, credits));
			return reply(wid === null ? 201 : 200, { id: workId, credits: await creditsOf(env, "work", workId) });
		}

		// /songbooks/texts/:id
		if (parts[0] === "texts") {
			if (parts.length !== 2) throw new MemberError(`no route ${m} ${url.pathname}`, 404);
			const tid = id(Number(parts[1]), "the text");
			const t = isText(tid) ? await env.DB.prepare("SELECT * FROM song_texts WHERE id = ?1").bind(tid).first() : null;
			if (m === "GET") {
				const acc = await viewer(env, request, nowSeconds);
				if (!t || (!(await textMay(env, acc, tid)) && !(await textIsPublic(env, tid)))) throw new MemberError(`there is no text ${tid}`, 404);
				return reply(200, await textShape(env, t, acc));
			}
			const acc = await writer(env, request, nowSeconds);
			if (!t) throw new MemberError(`there is no text ${tid}`, 404);
			needOn(await textMay(env, acc, tid), "edit", "changing a song");
			const body = await readBody(request);
			const work = body.work === undefined ? t.work_id : body.work === null ? null : id(body.work, "work");
			if (work !== null && !(await env.DB.prepare("SELECT 1 AS yes FROM song_works WHERE id = ?1").bind(work).first())) throw new MemberError(`there is no work ${work}`, 404);
			const from = body.from === undefined ? t.from_text : body.from === null ? null : id(body.from, "from");
			if (from !== null && (from === tid || !(await textExists(env, from)))) throw new MemberError("from must be another text", 404);
			const credits = await readCredits(env, body, TEXT_ROLES);
			await env.DB.batch([
				env.DB.prepare("UPDATE song_texts SET title = ?2, lang = ?3, first_line = ?4, work_id = ?5, from_text = ?6 WHERE id = ?1")
					.bind(tid, str(body, "title", { required: true, fallback: t.title }), lang(body, { fallback: t.lang }), str(body, "firstLine", { max: 300, fallback: t.first_line }), work, from),
				...(credits ? writeCredits(env, "text", tid, credits) : []),
			]);
			return reply(200, await textShape(env, await env.DB.prepare("SELECT * FROM song_texts WHERE id = ?1").bind(tid).first(), acc));
		}

		// /songbooks/:book …
		const bookId = id(Number(parts[0]), "the songbook");
		if (parts.length === 1 && m === "GET") {
			const acc = await viewer(env, request, nowSeconds);
			const b = await bookRow(env, bookId, acc);
			const entries = (await env.DB.prepare(`SELECT e.number, t.id, t.title, t.lang, t.first_line FROM songbook_entries e JOIN song_texts t ON t.id = e.text_id
				WHERE e.book_id = ?1 ORDER BY e.number`).bind(bookId).all()).results ?? [];
			return reply(200, { ...bookShape({ ...b, entries: entries.length }, mayOn(acc, b)), publish: acc.publish, entries: entries.map((e) => ({ number: e.number, text: e.id, title: e.title, lang: e.lang, firstLine: e.first_line })) });
		}
		// GET /songbooks/:book/collaborators: those appointed to the book.
		if (parts[1] === "collaborators" && parts.length === 2 && m === "GET") {
			const acc = await writer(env, request, nowSeconds);
			needAll(acc);
			await bookRow(env, bookId, acc);
			return reply(200, { collaborators: await collaboratorsOf(env, bookId) });
		}
		if (m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		const acc = await writer(env, request, nowSeconds);
		const me = acc.me;
		const b = await bookRow(env, bookId, acc);
		const may = mayOn(acc, b);
		const body = await readBody(request);

		// POST /songbooks/:book/collaborators {member, role}: appointed as editor or reader, or (role null) taken off.
		if (parts[1] === "collaborators" && parts.length === 2) {
			needAll(acc);
			const member = id(body.member, "member");
			const role = body.role ?? null;
			if (role !== null && !BOOK_ROLES.includes(role)) throw new MemberError(`role must be one of ${BOOK_ROLES.join(", ")}, or null to take them off`);
			const row = await env.DB.prepare("SELECT id, name, blocked_at FROM members WHERE id = ?1").bind(member).first();
			if (!row) throw new MemberError(`there is no member ${member}`, 404);
			if (role === null) {
				await env.DB.prepare("DELETE FROM songbook_members WHERE book_id = ?1 AND member_id = ?2").bind(bookId, member).run();
			} else {
				if (row.blocked_at) throw new MemberError(`${row.name} is blocked; unblock them first`, 409);
				await env.DB.prepare(`INSERT INTO songbook_members (book_id, member_id, role, added_by, at) VALUES (?1, ?2, ?3, ?4, ?5)
					ON CONFLICT (book_id, member_id) DO UPDATE SET role = excluded.role, added_by = excluded.added_by, at = excluded.at`).bind(bookId, member, role, me.login, nowSeconds).run();
			}
			return answer(200, { collaborators: await collaboratorsOf(env, bookId) }, cors);
		}
		needOn(may, "edit", `changing ${b.short}`);

		// POST /songbooks/:book: its details, its rights, and whether it is public.
		if (parts.length === 1) {
			const short = body.short === undefined ? b.short : str(body, "short", { max: 8, required: true });
			if (!SHORT.test(short)) throw new MemberError("short must be 1 to 8 letters or digits, such as TL");
			if (short.toLowerCase() !== b.short.toLowerCase() && await env.DB.prepare("SELECT 1 AS yes FROM songbooks WHERE short = ?1 COLLATE NOCASE").bind(short).first()) throw new MemberError(`another songbook is already called ${short}`, 409);
			const rights = body.rights === undefined ? b.rights : body.rights;
			if (!RIGHTS_STATES.includes(rights)) throw new MemberError(`rights must be one of ${RIGHTS_STATES.join(", ")}`);
			const rightsNote = body.rightsNote === undefined ? b.rights_note : str(body, "rightsNote", { max: 500 });
			const pub = body.public === undefined ? Boolean(b.public) : body.public;
			if (typeof pub !== "boolean") throw new MemberError("public must be true or false");
			if (pub !== Boolean(b.public) && !acc.publish) throw new MemberError("making a songbook public, or private again, is for the owner and co-owners", 403);
			if (pub && (rights === "unsettled" || !rightsNote)) throw new MemberError("a songbook is made public once its rights are settled: set rights to permission or public-domain, with a note saying how", 409);
			const row = await env.DB.prepare(`UPDATE songbooks SET title = ?2, short = ?3, lang = ?4, edition = ?5, year = ?6, publisher = ?7, rights = ?8, rights_note = ?9, public = ?10 WHERE id = ?1 RETURNING *`)
				.bind(bookId, str(body, "title", { required: true, fallback: b.title }), short, lang(body, { fallback: b.lang }), str(body, "edition", { fallback: b.edition }),
					body.year === undefined ? b.year : year(body, "year"), str(body, "publisher", { fallback: b.publisher }), rights, rightsNote, Number(pub)).first();
			// Made public or private: its texts, and the recordings showing them, change in the app's index (lyrics.js).
			if (pub !== Boolean(b.public)) {
				await env.DB.batch([
					env.DB.prepare("UPDATE lyrics SET changed_at = ?2 WHERE track IN (SELECT text_id FROM songbook_entries WHERE book_id = ?1)").bind(bookId, nowSeconds),
					env.DB.prepare("UPDATE lyrics_links SET at = ?2 WHERE unlinked_at IS NULL AND source IN (SELECT text_id FROM songbook_entries WHERE book_id = ?1)").bind(bookId, nowSeconds),
				]);
			}
			return answer(200, bookShape(row, may), cors);
		}

		if (parts[1] !== "entries" || parts.length > 3) throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		// POST /songbooks/:book/entries: a hymn number, printing a text (a new one, or one that exists).
		if (parts.length === 2) {
			const number = body.number;
			if (!Number.isSafeInteger(number) || number < 1 || number > MAX_NUMBER) throw new MemberError(`number must be the hymn number, 1 to ${MAX_NUMBER}`);
			if (await env.DB.prepare("SELECT 1 AS yes FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, number).first()) throw new MemberError(`${b.short} ${number} is already there`, 409);
			let textId;
			if (body.text !== undefined) {
				textId = id(body.text, "text");
				await seenText(env, acc, textId);
			} else {
				textId = await newText(env, {
					title: str(body, "title", { required: true }),
					textLang: lang(body, { required: false, fallback: b.lang }),
					firstLine: str(body, "firstLine", { max: 300 }),
					work: body.work === undefined || body.work === null ? null : id(body.work, "work"),
				}, me, nowSeconds);
			}
			await env.DB.prepare("INSERT INTO songbook_entries (book_id, number, text_id, at) VALUES (?1, ?2, ?3, ?4)").bind(bookId, number, textId, nowSeconds).run();
			if (b.public) await touchTexts(env, [textId], nowSeconds);
			return answer(201, { book: bookId, number, text: textId }, cors);
		}
		// POST /songbooks/:book/entries/:number: another number, another text, taken out, or deleted.
		const number = Number(parts[2]);
		const entry = await env.DB.prepare("SELECT text_id FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, number).first();
		if (!entry) throw new MemberError(`there is no ${b.short} ${parts[2]}`, 404);
		if (body.number !== undefined) {
			const to = body.number;
			if (!Number.isSafeInteger(to) || to < 1 || to > MAX_NUMBER) throw new MemberError(`number must be 1 to ${MAX_NUMBER}`);
			if (to !== number && await env.DB.prepare("SELECT 1 AS yes FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, to).first()) throw new MemberError(`${b.short} ${to} is already there`, 409);
			await env.DB.prepare("UPDATE songbook_entries SET number = ?3, at = ?4 WHERE book_id = ?1 AND number = ?2").bind(bookId, number, to, nowSeconds).run();
			return answer(200, { book: bookId, number: to, text: entry.text_id }, cors);
		}
		if (body.delete === true) {
			// Deleting from a public book is for the owner and co-owners; a recording joined to the text is unjoined first.
			if (b.public && !acc.publish) throw new MemberError("deleting from a public songbook is for the owner and co-owners", 403);
			const textId = entry.text_id;
			const others = (await env.DB.prepare("SELECT COUNT(*) AS n FROM songbook_entries WHERE text_id = ?1 AND NOT (book_id = ?2 AND number = ?3)").bind(textId, bookId, number).first())?.n ?? 0;
			if (others) {
				// Printed elsewhere too: only this number goes.
				await env.DB.prepare("DELETE FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, number).run();
				if (b.public) await touchTexts(env, [textId], nowSeconds);
				return answer(200, { book: bookId, number, deleted: "number" }, cors);
			}
			const joined = (await env.DB.prepare("SELECT COUNT(*) AS n FROM lyrics_links WHERE source = ?1 AND unlinked_at IS NULL").bind(textId).first())?.n ?? 0;
			if (joined) throw new MemberError(`${joined} recording${joined === 1 ? " shows" : "s show"} these words; unjoin ${joined === 1 ? "it" : "them"} first`, 409);
			await env.DB.batch([
				env.DB.prepare("DELETE FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, number),
				env.DB.prepare("DELETE FROM song_credits WHERE subject = 'text' AND subject_id = ?1").bind(textId),
				env.DB.prepare("UPDATE song_texts SET from_text = NULL WHERE from_text = ?1").bind(textId),
				env.DB.prepare("DELETE FROM song_texts WHERE id = ?1").bind(textId),
				// The words go; the row stays, hidden and empty, so devices that had them in their
				// lyrics index learn they are gone (lyrics.js index: changed since they last asked).
				env.DB.prepare("UPDATE lyrics SET text = '', words = '', hidden_at = ?2, hidden_by = ?3, hidden_reason = 'deleted with its songbook entry', changed_at = ?2 WHERE track = ?1").bind(textId, nowSeconds, me.login),
				env.DB.prepare("DELETE FROM lyrics_versions WHERE track = ?1").bind(textId),
				env.DB.prepare("DELETE FROM lyrics_reports WHERE track = ?1").bind(textId),
				env.DB.prepare("DELETE FROM lyrics_links WHERE source = ?1 OR track = ?1").bind(textId),
			]);
			return answer(200, { book: bookId, number, deleted: "text" }, cors);
		}
		if (body.remove === true) {
			await env.DB.prepare("DELETE FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, number).run();
			// Taken out of a public book, the text may be in no public book now.
			if (b.public) await touchTexts(env, [entry.text_id], nowSeconds);
			return answer(200, { book: bookId, number, removed: true }, cors);
		}
		const textId = id(body.text, "text");
		await seenText(env, acc, textId);
		await env.DB.prepare("UPDATE songbook_entries SET text_id = ?3, at = ?4 WHERE book_id = ?1 AND number = ?2").bind(bookId, number, textId, nowSeconds).run();
		if (b.public) await touchTexts(env, [entry.text_id, textId], nowSeconds);
		return answer(200, { book: bookId, number, text: textId }, cors);
	} catch (err) {
		if (err instanceof MemberError) return answer(err.status, { error: err.message }, cors ?? "*");
		console.error("songbooks request failed", err);
		return answer(500, { error: "the songbooks request failed on the Worker" }, cors ?? "*");
	}
}
