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
