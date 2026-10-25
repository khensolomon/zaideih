import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, sqlite } from "./helpers/fakes.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { handleSongbooks, TEXT_BASE } = await import("../worker/media/songbooks.js");
const { handleLyrics } = await import("../worker/media/lyrics.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = { "gh-owner": { id: 1, login: "khen" }, "gh-ann": { id: 42, login: "ann" }, "gh-ed": { id: 43, login: "ed" } };
const github = async (url, init) => {
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	return url.endsWith("/user") ? new Response(JSON.stringify(p)) : new Response("{}", { status: 403 });
};

function setup() {
	const env = { DB: fakeD1(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s" };
	const clock = 1_800_000_000_000;
	const sessions = {};
	const signIn = async (t) => (sessions[t] ??= (await (await handleAuth(new Request(`${W}/auth/session`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" }), env, { fetchImpl: github, now: () => clock })).json()));
	const request = async (handler, who, method, path, body) => {
		const headers = { Origin: ORIGIN };
		if (who) headers.Authorization = `Bearer ${(await signIn(who)).token}`;
		if (body) headers["Content-Type"] = "application/json";
		const res = await handler(new Request(`${W}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, null, { now: () => clock });
		return { status: res.status, body: await res.json() };
	};
	return {
		env, signIn,
		sb: (who, method, path, body) => request(handleSongbooks, who, method, path, body),
		ly: (who, method, path, body) => request(handleLyrics, who, method, path, body),
	};
}

test("songbooks: private until its rights are settled and the owner makes it public; texts are lyrics", { skip }, async () => {
	const { env, signIn, sb, ly } = setup();
	const ed = (await signIn("gh-ed")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'songbooks', 'khen', 0)").bind(ed).run();

	// Only the Songbooks right makes books.
	assert.equal((await sb("gh-ann", "POST", "/songbooks", { title: "Tedim Labu", short: "TL", lang: "tedim" })).status, 403);
	assert.equal((await sb("gh-ed", "POST", "/songbooks", { title: "Tedim Labu", short: "T L", lang: "tedim" })).status, 400);
	const book = await sb("gh-ed", "POST", "/songbooks", { title: "Tedim Labu", short: "TL", lang: "tedim", edition: "1995", year: 1995 });
	assert.equal(book.status, 201, JSON.stringify(book.body));
	assert.deepEqual([book.body.public, book.body.rights], [false, "unsettled"]);
	assert.equal((await sb("gh-ed", "POST", "/songbooks", { title: "Other", short: "tl", lang: "tedim" })).status, 409, "short names are unique");

	// People, a work with its credits, a text printed as hymn 145.
	const fanny = (await sb("gh-ed", "POST", "/songbooks/people", { name: "Fanny Crosby", born: 1820, died: 1915 })).body;
	const tr = (await sb("gh-ed", "POST", "/songbooks/people", { name: "A Tedim translator" })).body;
	const work = await sb("gh-ed", "POST", "/songbooks/works", { title: "Blessed Assurance", lang: "english", tune: "ASSURANCE", metre: "9.10.9.9", year: 1873, credits: [{ person: fanny.id, role: "words" }] });
	assert.equal(work.status, 201, JSON.stringify(work.body));
	assert.equal((await sb("gh-ed", "POST", "/songbooks/works", { title: "X", lang: "english", credits: [{ person: fanny.id, role: "translation" }] })).status, 400, "translation belongs to a text");
	const entry = await sb("gh-ed", "POST", `/songbooks/${book.body.id}/entries`, { number: 145, title: "Lungmuanna Ka Nei", firstLine: "Lungmuanna ka nei hi", work: work.body.id });
	assert.equal(entry.status, 201, JSON.stringify(entry.body));
	const text = entry.body.text;
	assert.equal(text, TEXT_BASE, "the first text id");
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.body.id}/entries`, { number: 145, title: "Again" })).status, 409);
	assert.equal((await sb("gh-ed", "POST", `/songbooks/texts/${text}`, { credits: [{ person: tr.id, role: "translation" }] })).status, 200);

	// The words are lyrics under the text's id, versioned as any lyrics.
	assert.equal((await ly("gh-ann", "POST", `/lyrics/${text}`, { text: "Lungmuanna ka nei hi", base: 0 })).status, 404, "a private text is not there for others");
	const saved = await ly("gh-ed", "POST", `/lyrics/${text}`, { text: "Lungmuanna ka nei hi\nJesu a ka hi", base: 0 });
	assert.equal(saved.status, 200, JSON.stringify(saved.body));
	assert.equal((await ly("gh-ed", "GET", `/lyrics/${text}/versions`)).status, 200, "the Songbooks right sees its versions");
	assert.equal((await ly("gh-ed", "POST", `/lyrics/${text}/link`, { to: 1 })).status, 400);

	// Private: no book, no text, no words, nothing in the index, for anyone else.
	assert.deepEqual((await sb(null, "GET", "/songbooks")).body.books, []);
	assert.equal((await sb("gh-ann", "GET", `/songbooks/${book.body.id}`)).status, 404);
	assert.equal((await sb(null, "GET", `/songbooks/texts/${text}`)).status, 404);
	assert.equal((await ly(null, "GET", `/lyrics/${text}`)).status, 404);
	assert.deepEqual((await ly(null, "GET", "/lyrics/index?since=0")).body.songs, []);
	const seen = (await sb("gh-ed", "GET", `/songbooks/texts/${text}`)).body;
	assert.deepEqual([seen.work.title, seen.work.credits[0].name, seen.credits[0].role, seen.books[0].short, seen.books[0].number, seen.lyrics[0].version], ["Blessed Assurance", "Fanny Crosby", "translation", "TL", 145, 1]);

	// Made public: by the owner, once the rights are settled.
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.body.id}`, { public: true })).status, 403, "the Songbooks right does not publish");
	assert.equal((await sb("gh-owner", "POST", `/songbooks/${book.body.id}`, { public: true })).status, 409, "rights unsettled");
	const pub = await sb("gh-owner", "POST", `/songbooks/${book.body.id}`, { rights: "permission", rightsNote: "Letter from the publisher, 2026", public: true });
	assert.equal(pub.status, 200, JSON.stringify(pub.body));
	assert.deepEqual((await sb(null, "GET", "/songbooks")).body.books.map((b) => [b.short, b.entries]), [["TL", 1]]);
	const index = (await sb(null, "GET", `/songbooks/${book.body.id}`)).body;
	assert.deepEqual(index.entries.map((e) => [e.number, e.title]), [[145, "Lungmuanna Ka Nei"]]);
	assert.equal((await ly(null, "GET", `/lyrics/${text}`)).body.text, "Lungmuanna ka nei hi\nJesu a ka hi");
	assert.equal((await sb(null, "GET", `/songbooks/texts/${text}`)).status, 200);
	assert.equal((await sb(null, "GET", "/songbooks/people")).status, 401, "people need the right for now");

	// An entry can print another text, or be taken out; the text stays.
	const second = (await sb("gh-ed", "POST", `/songbooks/${book.body.id}/entries`, { number: 146, title: "Second" })).body.text;
	assert.equal(second, TEXT_BASE + 1);
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.body.id}/entries/146`, { text: text })).status, 200);
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.body.id}/entries/146`, { remove: true })).status, 200);
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.body.id}/entries/146`, { remove: true })).status, 404);
});

test("songbooks: public texts in the index and on pages; recordings joined to a text; private again takes them out", { skip }, async () => {
	const { env, signIn, sb, ly } = setup();
	const ed = (await signIn("gh-ed")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'songbooks', 'khen', 0)").bind(ed).run();
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (101, 'a', 'b.mp3', 0), (102, 'a', 'c.mp3', 0)").run();
	const book = (await sb("gh-ed", "POST", "/songbooks", { title: "Tedim Labu", short: "TL", lang: "tedim" })).body;
	const fanny = (await sb("gh-ed", "POST", "/songbooks/people", { name: "Fanny Crosby" })).body;
	const work = (await sb("gh-ed", "POST", "/songbooks/works", { title: "Blessed Assurance", lang: "english", credits: [{ person: fanny.id, role: "words" }] })).body;
	const text = (await sb("gh-ed", "POST", `/songbooks/${book.id}/entries`, { number: 145, title: "Lungmuanna Ka Nei", work: work.id })).body.text;
	const english = (await sb("gh-ed", "POST", `/songbooks/${book.id}/entries`, { number: 900, title: "Blessed Assurance", lang: "english", work: work.id })).body.text;
	await ly("gh-ed", "POST", `/lyrics/${text}`, { text: "Lungmuanna ka nei hi", base: 0 });
	assert.deepEqual((await sb("gh-ed", "GET", "/songbooks/works?q=bless")).body.works.map((w) => w.id), [work.id]);

	// Private: the index, people and works show nothing of it to the public.
	assert.deepEqual((await sb(null, "GET", "/songbooks/index")).body, { books: [], entries: [] });
	assert.deepEqual((await sb("gh-ed", "GET", "/songbooks/index")).body.entries, [[text, book.id, 145, "Lungmuanna Ka Nei"], [english, book.id, 900, "Blessed Assurance"]]);
	assert.equal((await sb(null, "GET", `/songbooks/people/${fanny.id}`)).status, 404);
	assert.equal((await sb(null, "GET", `/songbooks/works/${work.id}`)).status, 404);

	// A recording joined to the private text, by the Songbooks right: its words are not shown either.
	const joined = await ly("gh-ed", "POST", "/lyrics/101/link", { to: text });
	assert.equal(joined.status, 200, JSON.stringify(joined.body));
	assert.equal((await ly(null, "GET", "/lyrics/101")).status, 404);
	assert.equal((await ly("gh-ann", "POST", "/lyrics/102/link", { to: text })).status, 404, "a private text is not there for a member without the right");
	const before = (await ly(null, "GET", "/lyrics/index?since=0")).body;
	assert.deepEqual(before.songs, []);

	// Public: the index, the recording, the person and the work.
	await sb("gh-owner", "POST", `/songbooks/${book.id}`, { rights: "public-domain", rightsNote: "Printed 1902", public: true });
	const after = (await ly(null, "GET", `/lyrics/index?since=${before.at}`)).body;
	assert.deepEqual(after.songs.map((s) => s[0]).sort(), [101, text].sort());
	assert.equal((await ly(null, "GET", "/lyrics/101")).body.text, "Lungmuanna ka nei hi");
	assert.deepEqual((await sb(null, "GET", `/songbooks/texts/${text}`)).body.recordings, [101]);
	assert.deepEqual((await sb(null, "GET", `/songbooks/texts/${text}`)).body.versions.map((v) => [v.id, v.label]), [[english, "TL 900"]]);
	const person = (await sb(null, "GET", `/songbooks/people/${fanny.id}`)).body;
	assert.deepEqual([person.name, person.works.map((w) => [w.title, w.role])], ["Fanny Crosby", [["Blessed Assurance", "words"]]]);
	assert.deepEqual((await sb(null, "GET", `/songbooks/works/${work.id}`)).body.texts.map((t) => t.label), ["TL 900", "TL 145"]);
	assert.deepEqual((await sb(null, "GET", "/songbooks/index")).body.books.map((b) => b.short), ["TL"]);

	// Private again: gone from the index for the app, and the recording shows nothing.
	const mid = (await ly(null, "GET", "/lyrics/index?since=0")).body.at;
	await sb("gh-owner", "POST", `/songbooks/${book.id}`, { public: false });
	const gone = (await ly(null, "GET", `/lyrics/index?since=${mid}`)).body;
	assert.deepEqual(gone.gone.map((g) => g[0]).sort(), [101, text].sort());
	assert.equal((await ly(null, "GET", "/lyrics/101")).status, 404);
	// The Songbooks right unjoins it.
	assert.equal((await ly("gh-ed", "POST", "/lyrics/101/unlink", {})).status, 200);
});

test("songbooks: a number changes; a song is deleted with its words, unless printed elsewhere or sung by a joined recording", { skip }, async () => {
	const { env, signIn, sb, ly } = setup();
	const ed = (await signIn("gh-ed")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'songbooks', 'khen', 0)").bind(ed).run();
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (101, 'a', 'b.mp3', 0)").run();
	const book = (await sb("gh-ed", "POST", "/songbooks", { title: "Galhiam", short: "GH", lang: "tedim" })).body;
	const other = (await sb("gh-ed", "POST", "/songbooks", { title: "Other", short: "OT", lang: "tedim" })).body;
	const text = (await sb("gh-ed", "POST", `/songbooks/${book.id}/entries`, { number: 5, title: "Five" })).body.text;
	await ly("gh-ed", "POST", `/lyrics/${text}`, { text: "Line", base: 0 });
	await sb("gh-ed", "POST", `/songbooks/${book.id}/entries`, { number: 6, title: "Six" });

	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.id}/entries/5`, { number: 6 })).status, 409, "the number is taken");
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.id}/entries/5`, { number: 7 })).status, 200);
	assert.deepEqual((await sb("gh-ed", "GET", `/songbooks/${book.id}`)).body.entries.map((e) => e.number), [6, 7]);

	// Printed in another book too: only this number goes.
	await sb("gh-ed", "POST", `/songbooks/${other.id}/entries`, { number: 1, text });
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${book.id}/entries/7`, { delete: true })).body.deleted, "number");
	// A recording joined: refused until it is unjoined.
	await ly("gh-ed", "POST", "/lyrics/101/link", { to: text });
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${other.id}/entries/1`, { delete: true })).status, 409);
	await ly("gh-ed", "POST", "/lyrics/101/unlink", {});
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${other.id}/entries/1`, { delete: true })).body.deleted, "text");
	assert.equal((await sb("gh-ed", "GET", `/songbooks/texts/${text}`)).status, 404);
	assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM lyrics_versions WHERE track = ?1").bind(text).first()).n, 0, "its words and history go with it");
});

test("songbooks: collaborators appointed to one book edit or read it, and nothing else", { skip }, async () => {
	const { env, signIn, sb, ly } = setup();
	const ed = (await signIn("gh-ed")).member.id;
	const ann = (await signIn("gh-ann")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'songbooks', 'khen', 0)").bind(ed).run();
	const tl = (await sb("gh-ed", "POST", "/songbooks", { title: "Tedim Labu", short: "TL", lang: "tedim" })).body.id;
	const ob = (await sb("gh-ed", "POST", "/songbooks", { title: "Other Book", short: "OB", lang: "tedim" })).body.id;
	const fanny = (await sb("gh-ed", "POST", "/songbooks/people", { name: "Fanny Crosby" })).body.id;
	const elsewhere = (await sb("gh-ed", "POST", "/songbooks/people", { name: "Only In OB" })).body.id;
	const work = (await sb("gh-ed", "POST", "/songbooks/works", { title: "Blessed Assurance", lang: "english", credits: [{ person: fanny, role: "words" }] })).body.id;
	const t1 = (await sb("gh-ed", "POST", `/songbooks/${tl}/entries`, { number: 1, title: "Lungmuanna", work })).body.text;
	const t2 = (await sb("gh-ed", "POST", `/songbooks/${ob}/entries`, { number: 1, title: "Other song" })).body.text;
	await sb("gh-ed", "POST", `/songbooks/texts/${t2}`, { credits: [{ person: elsewhere, role: "translation" }] });

	// Not appointed: the private books are not there.
	assert.equal((await sb("gh-ann", "GET", `/songbooks/${tl}`)).status, 404);
	assert.deepEqual((await sb("gh-ann", "GET", "/songbooks")).body.books, []);
	// Appointing is for the right.
	assert.equal((await sb("gh-ann", "GET", "/songbooks/members?q=ann")).status, 403);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${tl}/collaborators`, { member: ann, role: "editor" })).status, 404, "a private book is not there for them");
	const found = await sb("gh-ed", "GET", "/songbooks/members?q=ann");
	assert.deepEqual(found.body.members.map((x) => x.id), [ann]);
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${tl}/collaborators`, { member: ann, role: "owner" })).status, 400);

	// A reader sees the book and its songs, and changes nothing.
	assert.equal((await sb("gh-ed", "POST", `/songbooks/${tl}/collaborators`, { member: ann, role: "reader" })).status, 200);
	const read = await sb("gh-ann", "GET", `/songbooks/${tl}`);
	assert.deepEqual([read.status, read.body.may], [200, "read"]);
	assert.equal((await sb("gh-ann", "GET", `/songbooks/texts/${t1}`)).body.may, "read");
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${tl}/entries/1`, { number: 2 })).status, 403);
	assert.equal((await ly("gh-ann", "POST", `/lyrics/${t1}`, { text: "Lungmuanna ka nei hi", base: 0 })).status, 403);

	// An editor changes the book, its numbers, its songs and their words.
	const list = await sb("gh-ed", "POST", `/songbooks/${tl}/collaborators`, { member: ann, role: "editor" });
	assert.deepEqual(list.body.collaborators.map((c) => [c.member, c.role, c.addedBy]), [[ann, "editor", "ed"]]);
	assert.deepEqual((await sb("gh-ann", "GET", "/songbooks")).body.books.map((b) => [b.short, b.may]), [["TL", "edit"]]);
	assert.deepEqual((await sb("gh-ann", "GET", "/songbooks/index")).body.books.map((b) => b.short), ["TL"]);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${tl}/entries/1`, { number: 2 })).status, 200);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${tl}/entries`, { number: 3, title: "Pathian" })).status, 201);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/texts/${t1}`, { title: "Lungmuanna Ka Nei" })).status, 200);
	assert.equal((await ly("gh-ann", "POST", `/lyrics/${t1}`, { text: "Lungmuanna ka nei hi", base: 0 })).status, 200);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${tl}`, { edition: "1995" })).status, 200);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${tl}`, { public: true, rights: "public-domain", rightsNote: "old" })).status, 403, "public is for the owner and co-owners");
	// People and works: new ones, and those of their book's songs.
	assert.equal((await sb("gh-ann", "POST", "/songbooks/people", { name: "New Person" })).status, 201);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/people/${fanny}`, { name: "Fanny J. Crosby" })).status, 200);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/works/${work}`, { title: "Blessed Assurance", lang: "english", year: 1873 })).status, 200);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/people/${elsewhere}`, { name: "Renamed" })).status, 403);
	// Not the other book, its songs, or appointing.
	assert.equal((await sb("gh-ann", "GET", `/songbooks/${ob}`)).status, 404);
	assert.equal((await sb("gh-ann", "GET", `/songbooks/texts/${t2}`)).status, 404);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${ob}/entries`, { number: 5, title: "X" })).status, 404);
	assert.equal((await sb("gh-ann", "POST", `/songbooks/${tl}/entries`, { number: 9, text: t2 })).status, 404, "a text of a book not seen");
	assert.equal((await ly("gh-ann", "POST", `/lyrics/${t2}`, { text: "x", base: 0 })).status, 404);
	assert.equal((await sb("gh-ann", "GET", `/songbooks/${tl}/collaborators`)).status, 403);

	// Taken off: the book is gone again.
	assert.deepEqual((await sb("gh-ed", "POST", `/songbooks/${tl}/collaborators`, { member: ann, role: null })).body.collaborators, []);
	assert.equal((await sb("gh-ann", "GET", `/songbooks/${tl}`)).status, 404);
});
