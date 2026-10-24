import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeD1, sqlite } from "./helpers/fakes.mjs";

const { handleAuth } = await import("../worker/media/auth.js");
const { handleLyrics, cleanLyrics } = await import("../worker/media/lyrics.js");
const { mergeMembers } = await import("../worker/media/accounts.js");

const skip = !sqlite && "node:sqlite needs Node 22.13 or later";
const W = "https://media.zaideih.com";
const ORIGIN = "https://zaideih.com";
const PEOPLE = { "gh-ann": { id: 42, login: "ann" }, "gh-bo": { id: 43, login: "bo" }, "gh-mod": { id: 44, login: "mod" } };
const github = async (url, init) => {
	const p = PEOPLE[init.headers.Authorization.replace("Bearer ", "")];
	if (!p) return new Response("{}", { status: 401 });
	return url.endsWith("/user") ? new Response(JSON.stringify(p)) : new Response("{}", { status: 403 });
};

function setup() {
	const env = { DB: fakeD1(), GITHUB_REPO: "khensolomon/zaideih", OWNER_GITHUB_ID: "1", AUTH_ORIGINS: ORIGIN, GITHUB_CLIENT_ID: "c", GITHUB_CLIENT_SECRET: "s" };
	let clock = 1_800_000_000_000;
	const sessions = {};
	const signIn = async (t) => (sessions[t] ??= (await (await handleAuth(new Request(`${W}/auth/session`, { method: "POST", headers: { Origin: ORIGIN, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" }), env, { fetchImpl: github, now: () => clock })).json()));
	const call = async (who, method, path, body) => {
		const headers = { Origin: ORIGIN };
		if (who) headers.Authorization = `Bearer ${(await signIn(who)).token}`;
		if (body) headers["Content-Type"] = "application/json";
		const res = await handleLyrics(new Request(`${W}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, null, { now: () => clock });
		return { status: res.status, body: await res.json(), headers: res.headers };
	};
	const read = async (track) => {
		const res = await handleLyrics(new Request(`${W}/lyrics/${track}`), env, null);
		return { status: res.status, body: await res.json(), headers: res.headers };
	};
	return { env, call, read, signIn, tick: (s) => { clock += s * 1000; } };
}

async function seed(env) {
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (101, 'a', 'b.mp3', 0), (102, 'a', 'c.mp3', 0)").run();
}

test("cleanLyrics keeps the words and tidies the edges", () => {
	assert.equal(cleanLyrics("\r\n\n  Line one  \r\nLine two\t\n\n\n\nVerse two\n\n"), "  Line one\nLine two\n\nVerse two");
	assert.throws(() => cleanLyrics(" \n "), /empty/);
	assert.throws(() => cleanLyrics("x".repeat(20_001)), /at most/);
	assert.throws(() => cleanLyrics(5), /must be the lyrics/);
});

test("anyone signed in adds lyrics, which appear at once; editing needs the latest version", { skip }, async () => {
	const { env, call, read, tick } = setup();
	await seed(env);
	assert.equal((await read(101)).status, 404);
	assert.equal((await call(null, "POST", "/lyrics/101", { text: "hi", base: 0 })).status, 401, "signing in first");
	const made = await call("gh-ann", "POST", "/lyrics/101", { text: "Verse one\nChorus", base: 0 });
	assert.equal(made.status, 200, JSON.stringify(made.body));
	assert.deepEqual([made.body.version, made.body.text], [1, "Verse one\nChorus"]);
	const pub = await read(101);
	assert.deepEqual([pub.status, pub.body.text, pub.headers.get("access-control-allow-origin")], [200, "Verse one\nChorus", "*"]);
	assert.match(pub.headers.get("cache-control"), /public/);
	// Bo corrects it from version 1.
	tick(60);
	const fixed = await call("gh-bo", "POST", "/lyrics/101", { text: "Verse one\nChorus, twice", base: 1 });
	assert.equal(fixed.body.version, 2);
	// Ann, still at version 1, saves too: refused, with the current lyrics to compare.
	const late = await call("gh-ann", "POST", "/lyrics/101", { text: "Verse one!", base: 1 });
	assert.equal(late.status, 409);
	assert.deepEqual([late.body.current.version, late.body.current.text], [2, "Verse one\nChorus, twice"]);
	// The same text again keeps the version.
	assert.equal((await call("gh-bo", "POST", "/lyrics/101", { text: "Verse one\nChorus, twice\n", base: 2 })).body.version, 2);
	// Only catalog songs; never a starting version that is not there.
	assert.equal((await call("gh-ann", "POST", "/lyrics/999", { text: "x", base: 0 })).status, 404);
	assert.equal((await call("gh-ann", "POST", "/lyrics/102", { text: "x", base: 3 })).status, 409);
	assert.equal((await call("gh-ann", "POST", "/lyrics/102", { text: "x" })).status, 400);
});

test("the Lyrics right sees every version, hides, shows and restores", { skip }, async () => {
	const { env, call, read, signIn } = setup();
	await seed(env);
	await call("gh-ann", "POST", "/lyrics/101", { text: "Good words", base: 0 });
	await call("gh-bo", "POST", "/lyrics/101", { text: "Spam spam", base: 1 });
	assert.equal((await call("gh-ann", "GET", "/lyrics/101/versions")).status, 403, "versions need the right");
	assert.equal((await call("gh-bo", "POST", "/lyrics/101/hide", { reason: "x" })).status, 403);
	const mod = (await signIn("gh-mod")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'lyrics', 'owner', 0)").bind(mod).run();

	const history = await call("gh-mod", "GET", "/lyrics/101/versions");
	assert.equal(history.status, 200, JSON.stringify(history.body));
	assert.deepEqual(history.body.versions.map((v) => [v.version, v.text, v.by.name]), [[2, "Spam spam", "bo"], [1, "Good words", "ann"]]);
	// Restoring version 1 makes it the newest; nothing is lost.
	const back = await call("gh-mod", "POST", "/lyrics/101/restore", { version: 1, base: 2 });
	assert.deepEqual([back.status, back.body.version, back.body.text], [200, 3, "Good words"]);
	assert.equal((await call("gh-mod", "GET", "/lyrics/101/versions")).body.versions[0].note, "restored version 1");
	// Hidden: listeners see none, members cannot edit, the reason is given.
	assert.equal((await call("gh-mod", "POST", "/lyrics/101/hide", {})).status, 400, "a reason is needed");
	const hidden = await call("gh-mod", "POST", "/lyrics/101/hide", { reason: "Waiting for the songwriter" });
	assert.equal(hidden.body.hidden.by, "mod");
	assert.equal((await read(101)).status, 404);
	const refused = await call("gh-ann", "POST", "/lyrics/101", { text: "Again", base: 3 });
	assert.deepEqual([refused.status, /Waiting for the songwriter/.test(refused.body.error)], [403, true]);
	await call("gh-mod", "POST", "/lyrics/101/show", {});
	assert.equal((await read(101)).body.text, "Good words");
});

test("blocked members cannot edit; joining two accounts keeps their edits", { skip }, async () => {
	const { env, call, signIn } = setup();
	await seed(env);
	await call("gh-ann", "POST", "/lyrics/101", { text: "One", base: 0 });
	const bo = (await signIn("gh-bo")).member.id;
	await call("gh-bo", "POST", "/lyrics/102", { text: "Two", base: 0 });
	await env.DB.prepare("UPDATE members SET blocked_at = 1, blocked_by = 'mod', blocked_reason = 'spam' WHERE id = ?1").bind(bo).run();
	const blocked = await call("gh-bo", "POST", "/lyrics/101", { text: "Spam", base: 1 });
	assert.equal(blocked.status, 403);
	await env.DB.prepare("UPDATE members SET blocked_at = NULL WHERE id = ?1").bind(bo).run();
	const ann = (await signIn("gh-ann")).member.id;
	await mergeMembers(env, ann, bo, 1);
	const rows = (await env.DB.prepare("SELECT DISTINCT member_id FROM lyrics_versions").all()).results;
	assert.equal(rows.length, 1);
});

test("other origins may read but not edit", { skip }, async () => {
	const { env, signIn } = setup();
	await seed(env);
	const { token } = await signIn("gh-ann");
	const res = await handleLyrics(new Request(`${W}/lyrics/101`, { method: "POST", headers: { Origin: "https://evil.example", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", base: 0 }) }), env, null);
	assert.equal(res.status, 403);
	assert.equal((await handleLyrics(new Request(`${W}/lyrics/abc`), env, null)).status, 404);
});
