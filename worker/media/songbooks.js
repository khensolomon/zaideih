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
 * makes it public: its entries and texts are then seen only with the
 * Songbooks right. People and works are read with the right only, until their
 * public pages come (a later step).
 *
 *   GET  /songbooks                        public books; with the right, private ones too
 *   POST /songbooks {title, short, lang, edition, year, publisher}
 *                                          Songbooks right: a new book, private
 *   GET  /songbooks/:book                  the book and its entries (private: the right)
 *   POST /songbooks/:book {...the fields above, rights, rightsNote, public}
 *                                          Songbooks right; making a book public is for
 *                                          the owner and co-owners, with its rights settled
 *   POST /songbooks/:book/entries {number, text | title, lang, firstLine, work}
 *                                          Songbooks right: hymn `number` prints text
 *                                          `text`, or a new text made from the rest
 *   POST /songbooks/:book/entries/:number {text | remove}
 *                                          Songbooks right: the number prints another
 *                                          text, or is taken out (the text stays)
 *   GET  /songbooks/texts/:id              a text: its work and credits, the books
 *                                          printing it, its words (private: the right)
 *   POST /songbooks/texts/:id {title, lang, firstLine, work, from, credits}
 *   GET  /songbooks/people?q=              Songbooks right: people by name
 *   POST /songbooks/people {name, aka, born, died, note}
 *   POST /songbooks/people/:id {...}
 *   GET  /songbooks/works/:id              Songbooks right: a work, its credits and texts
 *   POST /songbooks/works {title, lang, tune, metre, year, scripture, topics, note, credits}
 *   POST /songbooks/works/:id {...}
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
export async function textIsPublic(env, textId) {
	const row = await env.DB.prepare("SELECT 1 AS yes FROM songbook_entries e JOIN songbooks b ON b.id = e.book_id WHERE e.text_id = ?1 AND b.public = 1 LIMIT 1").bind(textId).first();
	return Boolean(row);
}

export async function textExists(env, textId) {
	return Boolean(await env.DB.prepare("SELECT 1 AS yes FROM song_texts WHERE id = ?1").bind(textId).first());
}

const bookShape = (b) => ({
	id: b.id, title: b.title, short: b.short, lang: b.lang, edition: b.edition, year: b.year, publisher: b.publisher,
	rights: b.rights, rightsNote: b.rights_note, public: Boolean(b.public), entries: b.entries ?? 0,
});

async function bookRow(env, bookId, editor) {
	const b = await env.DB.prepare("SELECT * FROM songbooks WHERE id = ?1").bind(bookId).first();
	// A private book is not there for those without the right: no hint that it exists.
	if (!b || (!b.public && !editor)) throw new MemberError(`there is no songbook ${bookId}`, 404);
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

async function textShape(env, t, editor) {
	const entries = (await env.DB.prepare(`SELECT e.number, b.id, b.short, b.title, b.public FROM songbook_entries e JOIN songbooks b ON b.id = e.book_id
		WHERE e.text_id = ?1 ORDER BY b.title, e.number`).bind(t.id).all()).results ?? [];
	const work = t.work_id ? await env.DB.prepare("SELECT id, title, lang, tune, metre, year, scripture, topics FROM song_works WHERE id = ?1").bind(t.work_id).first() : null;
	const words = (await env.DB.prepare("SELECT lang, version, text, hidden_at FROM lyrics WHERE track = ?1 ORDER BY lang").bind(t.id).all()).results ?? [];
	return {
		id: t.id, title: t.title, lang: t.lang, firstLine: t.first_line, from: t.from_text,
		credits: await creditsOf(env, "text", t.id),
		work: work ? { ...work, credits: await creditsOf(env, "work", work.id) } : null,
		books: entries.filter((e) => editor || e.public).map((e) => ({ book: e.id, short: e.short, title: e.title, number: e.number })),
		lyrics: words.filter((w) => editor || !w.hidden_at).map((w) => ({ lang: w.lang, version: w.version, text: w.text, hidden: Boolean(w.hidden_at) })),
	};
}

/* ----------------------------------------------------------- writes ---- */

/** A new text (and its id, the next from TEXT_BASE). */
async function newText(env, { title, textLang, firstLine, work }, me, nowSeconds) {
	if (work !== null && !(await env.DB.prepare("SELECT 1 AS yes FROM song_works WHERE id = ?1").bind(work).first())) throw new MemberError(`there is no work ${work}`, 404);
	const row = await env.DB.prepare(`INSERT INTO song_texts (id, work_id, lang, title, first_line, created_by, at)
		SELECT COALESCE(MAX(id), ?1 - 1) + 1, ?2, ?3, ?4, ?5, ?6, ?7 FROM song_texts RETURNING id`).bind(TEXT_BASE, work, textLang, title, firstLine, me.login, nowSeconds).first();
	return row.id;
}

async function editor(env, request, nowSeconds) {
	const me = await memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds);
	if (me.blocked) throw new MemberError(`blocked by ${me.blocked.by}: ${me.blocked.reason}`, 403);
	if (!can(me, "songbooks")) throw new MemberError("this needs the Songbooks right", 403);
	return me;
}

/** The signed-in person when a session is sent, else null; a session that is sent and fails is refused. */
async function maybeMember(env, request, nowSeconds) {
	if (!request.headers.get("authorization")) return null;
	return memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds);
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
			const me = await maybeMember(env, request, nowSeconds);
			const all = Boolean(me && can(me, "songbooks"));
			const rows = (await env.DB.prepare(`SELECT b.*, (SELECT COUNT(*) FROM songbook_entries e WHERE e.book_id = b.id) AS entries FROM songbooks b
				${all ? "" : "WHERE b.public = 1"} ORDER BY b.title`).all()).results ?? [];
			return reply(200, { books: rows.map(bookShape) });
		}
		// POST /songbooks
		if (!parts.length) {
			const me = await editor(env, request, nowSeconds);
			const body = await readBody(request);
			const title = str(body, "title", { required: true });
			const short = str(body, "short", { max: 8, required: true });
			if (!SHORT.test(short)) throw new MemberError("short must be 1 to 8 letters or digits, such as TL");
			if (await env.DB.prepare("SELECT 1 AS yes FROM songbooks WHERE short = ?1 COLLATE NOCASE").bind(short).first()) throw new MemberError(`another songbook is already called ${short}`, 409);
			const row = await env.DB.prepare(`INSERT INTO songbooks (title, short, lang, edition, year, publisher, created_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING *`)
				.bind(title, short, lang(body), str(body, "edition"), year(body, "year"), str(body, "publisher"), me.login, nowSeconds).first();
			return reply(201, bookShape(row));
		}

		// /songbooks/people
		if (parts[0] === "people") {
			const me = await editor(env, request, nowSeconds);
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
			const row = await env.DB.prepare("UPDATE song_people SET name = ?2, aka = ?3, born = ?4, died = ?5, note = ?6 WHERE id = ?1 RETURNING id, name, aka, born, died, note").bind(pid, ...fields).first();
			if (!row) throw new MemberError(`there is no person ${pid}`, 404);
			return reply(200, row);
		}

		// /songbooks/works
		if (parts[0] === "works") {
			const me = await editor(env, request, nowSeconds);
			const wid = parts[1] === undefined ? null : id(Number(parts[1]), "the work");
			if (wid !== null && m === "GET" && parts.length === 2) {
				const w = await env.DB.prepare("SELECT * FROM song_works WHERE id = ?1").bind(wid).first();
				if (!w) throw new MemberError(`there is no work ${wid}`, 404);
				const texts = (await env.DB.prepare("SELECT id, title, lang FROM song_texts WHERE work_id = ?1 ORDER BY lang, title").bind(wid).all()).results ?? [];
				return reply(200, { id: w.id, title: w.title, lang: w.lang, tune: w.tune, metre: w.metre, year: w.year, scripture: w.scripture, topics: w.topics, note: w.note, credits: await creditsOf(env, "work", wid), texts });
			}
			if (m !== "POST" || parts.length > 2) throw new MemberError(`no route ${m} ${url.pathname}`, 404);
			const body = await readBody(request);
			const fields = [str(body, "title", { required: true }), lang(body), str(body, "tune"), str(body, "metre", { max: 40 }), year(body, "year"), str(body, "scripture", { max: 300 }), str(body, "topics", { max: 300 }), str(body, "note", { max: 1000 })];
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
				const me = await maybeMember(env, request, nowSeconds);
				const isEditor = Boolean(me && can(me, "songbooks"));
				if (!t || (!isEditor && !(await textIsPublic(env, tid)))) throw new MemberError(`there is no text ${tid}`, 404);
				return reply(200, await textShape(env, t, isEditor));
			}
			await editor(env, request, nowSeconds);
			if (!t) throw new MemberError(`there is no text ${tid}`, 404);
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
			return reply(200, await textShape(env, await env.DB.prepare("SELECT * FROM song_texts WHERE id = ?1").bind(tid).first(), true));
		}

		// /songbooks/:book …
		const bookId = id(Number(parts[0]), "the songbook");
		if (parts.length === 1 && m === "GET") {
			const me = await maybeMember(env, request, nowSeconds);
			const isEditor = Boolean(me && can(me, "songbooks"));
			const b = await bookRow(env, bookId, isEditor);
			const entries = (await env.DB.prepare(`SELECT e.number, t.id, t.title, t.lang, t.first_line FROM songbook_entries e JOIN song_texts t ON t.id = e.text_id
				WHERE e.book_id = ?1 ORDER BY e.number`).bind(bookId).all()).results ?? [];
			return reply(200, { ...bookShape({ ...b, entries: entries.length }), entries: entries.map((e) => ({ number: e.number, text: e.id, title: e.title, lang: e.lang, firstLine: e.first_line })) });
		}
		if (m !== "POST") throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		const me = await editor(env, request, nowSeconds);
		const b = await bookRow(env, bookId, true);
		const body = await readBody(request);

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
			if (pub !== Boolean(b.public) && me.role !== "owner" && !me.rights.has("manage")) throw new MemberError("making a songbook public, or private again, is for the owner and co-owners", 403);
			if (pub && (rights === "unsettled" || !rightsNote)) throw new MemberError("a songbook is made public once its rights are settled: set rights to permission or public-domain, with a note saying how", 409);
			const row = await env.DB.prepare(`UPDATE songbooks SET title = ?2, short = ?3, lang = ?4, edition = ?5, year = ?6, publisher = ?7, rights = ?8, rights_note = ?9, public = ?10 WHERE id = ?1 RETURNING *`)
				.bind(bookId, str(body, "title", { required: true, fallback: b.title }), short, lang(body, { fallback: b.lang }), str(body, "edition", { fallback: b.edition }),
					body.year === undefined ? b.year : year(body, "year"), str(body, "publisher", { fallback: b.publisher }), rights, rightsNote, Number(pub)).first();
			return answer(200, bookShape(row), cors);
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
				if (!isText(textId) || !(await textExists(env, textId))) throw new MemberError(`there is no text ${textId}`, 404);
			} else {
				textId = await newText(env, {
					title: str(body, "title", { required: true }),
					textLang: lang(body, { required: false, fallback: b.lang }),
					firstLine: str(body, "firstLine", { max: 300 }),
					work: body.work === undefined || body.work === null ? null : id(body.work, "work"),
				}, me, nowSeconds);
			}
			await env.DB.prepare("INSERT INTO songbook_entries (book_id, number, text_id, at) VALUES (?1, ?2, ?3, ?4)").bind(bookId, number, textId, nowSeconds).run();
			return answer(201, { book: bookId, number, text: textId }, cors);
		}
		// POST /songbooks/:book/entries/:number: another text, or taken out.
		const number = Number(parts[2]);
		if (!(await env.DB.prepare("SELECT 1 AS yes FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, number).first())) throw new MemberError(`there is no ${b.short} ${parts[2]}`, 404);
		if (body.remove === true) {
			await env.DB.prepare("DELETE FROM songbook_entries WHERE book_id = ?1 AND number = ?2").bind(bookId, number).run();
			return answer(200, { book: bookId, number, removed: true }, cors);
		}
		const textId = id(body.text, "text");
		if (!isText(textId) || !(await textExists(env, textId))) throw new MemberError(`there is no text ${textId}`, 404);
		await env.DB.prepare("UPDATE songbook_entries SET text_id = ?3, at = ?4 WHERE book_id = ?1 AND number = ?2").bind(bookId, number, textId, nowSeconds).run();
		return answer(200, { book: bookId, number, text: textId }, cors);
	} catch (err) {
		if (err instanceof MemberError) return answer(err.status, { error: err.message }, cors ?? "*");
		console.error("songbooks request failed", err);
		return answer(500, { error: "the songbooks request failed on the Worker" }, cors ?? "*");
	}
}
