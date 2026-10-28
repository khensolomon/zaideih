import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, sqlite, tokenCheck } from "./helpers/fakes.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { handleSongbooks, TEXT_BASE } = await import("../worker/media/songbooks.js");
const { handleLyrics } = await import("../worker/media/lyrics.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = { "gh-owner": { id: 1, login: "khen" }, "gh-ann": { id: 42, login: "ann" }, "gh-ed": { id: 43, login: "ed" } };
const github = async (url, init) => {
	const checked = tokenCheck(url, init);
	if (checked) return checked;
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
PEOPLE["gh-mod"] = { id: 44, login: "mod" };
test("lyrics: a recording joined to a private songbook text keeps the text private", { skip }, async () => {
	const { env, signIn, sb, ly } = setup();
	const ed = (await signIn("gh-ed")).member.id;
	const mod = (await signIn("gh-mod")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'songbooks', 'khen', 0)").bind(ed).run();
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'lyrics', 'khen', 0)").bind(mod).run();
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (101, 'a', 'b.mp3', 0), (102, 'a', 'c.mp3', 0), (103, 'a', 'd.mp3', 0)").run();
	const book = (await sb("gh-ed", "POST", "/songbooks", { title: "T", short: "TL", lang: "tedim" })).body;
	const text = (await sb("gh-ed", "POST", `/songbooks/${book.id}/entries`, { number: 1, title: "X" })).body.text;
	await ly("gh-ed", "POST", `/lyrics/${text}`, { text: "SECRET WORDS", base: 0 });
	assert.equal((await ly("gh-ed", "POST", "/lyrics/101/link", { to: text })).status, 200);

	assert.equal((await ly(null, "GET", "/lyrics/101")).status, 404, "not public");
	for (const base of [0, 1]) assert.equal((await ly("gh-ann", "POST", "/lyrics/101", { text: "overwritten", base })).status, 404, "a member without the book cannot write it, nor learn it exists");
	assert.equal((await ly("gh-mod", "GET", "/lyrics/101/versions")).status, 404, "the Lyrics right alone does not read it");
	const c = await ly("gh-mod", "GET", `/lyrics/102/compare?with=101`);
	assert.equal(c.body.b, null, "nor through a comparison");
	assert.equal((await ly("gh-mod", "POST", "/lyrics/103/link", { to: 101 })).status, 404, "nor by joining another recording to it");
	assert.equal((await ly("gh-mod", "POST", "/lyrics/101/hide", { reason: "x" })).status, 404);
	// Its book's editor still looks after it through the recording.
	const v = await ly("gh-ed", "GET", "/lyrics/101/versions");
	assert.equal(v.status, 200);
	assert.equal(v.body.versions[0].text, "SECRET WORDS");
	const w = await ly("gh-ed", "POST", "/lyrics/101", { text: "Better words", base: 1 });
	assert.equal(w.status, 200, `refused: ${JSON.stringify(w.body)}`);
});
