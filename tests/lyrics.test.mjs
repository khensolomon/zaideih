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

test("Zawgyi text is refused with a clear message; Unicode Myanmar is kept", { skip }, async () => {
	const { env, call } = setup();
	await seed(env);
	const zawgyi = await call("gh-ann", "POST", "/lyrics/101", { text: "ေနေကာင္းလား", base: 0 });
	assert.equal(zawgyi.status, 422);
	assert.match(zawgyi.body.error, /Zawgyi.*Unicode/);
	assert.equal((await call("gh-ann", "POST", "/lyrics/101", { text: "နေကောင်းလား", base: 0 })).status, 200);
});

test("a member saves at most MAX_PER_HOUR versions an hour; the Lyrics right has no cap", { skip }, async () => {
	const { env, call, tick, signIn } = setup();
	await seed(env);
	const { MAX_PER_HOUR } = await import("../worker/media/lyrics.js");
	let base = 0;
	for (let i = 0; i < MAX_PER_HOUR; i++) base = (await call("gh-ann", "POST", "/lyrics/101", { text: `take ${i}`, base })).body.version;
	const capped = await call("gh-ann", "POST", "/lyrics/101", { text: "one more", base });
	assert.equal(capped.status, 429);
	assert.match(capped.body.error, /last hour/);
	const mod = (await signIn("gh-mod")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'lyrics', 'owner', 0)").bind(mod).run();
	assert.equal((await call("gh-mod", "POST", "/lyrics/101", { text: "the right saves", base })).status, 200);
	tick(3601);
	assert.equal((await call("gh-ann", "POST", "/lyrics/101", { text: "an hour later", base: base + 1 })).status, 200);
});

test("reports: members report, the Lyrics right sees them with recent edits, and a decision resolves them", { skip }, async () => {
	const { env, call, signIn } = setup();
	await seed(env);
	assert.equal((await call("gh-ann", "POST", "/lyrics/101/report", { reason: "wrong song" })).status, 404, "nothing to report yet");
	await call("gh-ann", "POST", "/lyrics/101", { text: "Words", base: 0 });
	await call("gh-bo", "POST", "/lyrics/102", { text: "Spam", base: 0 });
	assert.equal((await call("gh-ann", "POST", "/lyrics/102/report", { reason: "" })).status, 400);
	assert.equal((await call("gh-ann", "POST", "/lyrics/102/report", { reason: "Not the words of this song" })).status, 201);
	assert.equal((await call("gh-ann", "POST", "/lyrics/102/report", { reason: "Spam, really" })).status, 201, "a second report replaces the first");
	assert.equal((await call("gh-ann", "GET", "/lyrics/recent")).status, 403, "the list needs the right");
	const mod = (await signIn("gh-mod")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'lyrics', 'owner', 0)").bind(mod).run();
	const recent = await call("gh-mod", "GET", "/lyrics/recent");
	assert.equal(recent.status, 200, JSON.stringify(recent.body));
	assert.deepEqual(recent.body.edits.map((e) => [e.track, e.version, e.by.name]).sort(), [[101, 1, "ann"], [102, 1, "bo"]]);
	assert.deepEqual(recent.body.reports.map((r) => [r.track, r.reasons.map((x) => x.reason)]), [[102, ["Spam, really"]]]);
	assert.equal((await call("gh-mod", "GET", "/lyrics/102/versions")).body.reports.length, 1);
	// Hiding deals with the report.
	await call("gh-mod", "POST", "/lyrics/102/hide", { reason: "Spam" });
	assert.deepEqual((await call("gh-mod", "GET", "/lyrics/recent")).body.reports, []);
	assert.equal((await call("gh-mod", "GET", "/lyrics/recent")).body.edits.find((e) => e.track === 102).hidden, true);
	// Or resolving without a change.
	await call("gh-bo", "POST", "/lyrics/101/report", { reason: "typo in line 2" });
	assert.equal((await call("gh-mod", "POST", "/lyrics/101/resolve", {})).status, 200);
	assert.deepEqual((await call("gh-mod", "GET", "/lyrics/recent")).body.reports, []);
});

test("translations are kept apart from the song's own words", { skip }, async () => {
	const { env, call, read } = setup();
	await seed(env);
	await call("gh-ann", "POST", "/lyrics/101", { text: "1. Topa ngak ta un", base: 0 });
	const en = await call("gh-ann", "POST", "/lyrics/101?lang=en", { text: "1. Wait on the Lord", base: 0 });
	assert.deepEqual([en.status, en.body.lang, en.body.version], [200, "en", 1]);
	assert.equal((await read(101)).body.text, "1. Topa ngak ta un");
	const pub = await handleLyrics(new Request(`${W}/lyrics/101?lang=en`), env, null);
	assert.equal((await pub.json()).text, "1. Wait on the Lord");
	assert.equal((await handleLyrics(new Request(`${W}/lyrics/101?lang=my`), env, null)).status, 404);
	assert.equal((await call("gh-ann", "POST", "/lyrics/101?lang=fr", { text: "x", base: 0 })).status, 400, "only the languages kept");
	// Versions, reports and hiding are per language.
	await call("gh-bo", "POST", "/lyrics/101/report?lang=en", { reason: "bad translation" });
	const mod = await setupRight(env, call);
	const recent = (await call(mod, "GET", "/lyrics/recent")).body;
	assert.deepEqual(recent.reports.map((r) => [r.track, r.lang]), [[101, "en"]]);
	assert.deepEqual(recent.edits.map((e) => e.lang).sort(), ["", "en"]);
	assert.deepEqual((await call(mod, "GET", "/lyrics/101/versions?lang=en")).body.versions.map((v) => v.text), ["1. Wait on the Lord"]);
	await call(mod, "POST", "/lyrics/101/hide?lang=en", { reason: "checking" });
	assert.equal((await read(101)).status, 200, "hiding the translation leaves the original");
});

test("the index: every shown text's words, then what changed since", { skip }, async () => {
	const { env, call, tick } = setup();
	await seed(env);
	const idx = async (since = 0) => (await (await handleLyrics(new Request(`${W}/lyrics/index?since=${since}`), env, null, { now: () => Date.now() })).json());
	assert.deepEqual((await idx()).songs, []);
	await call("gh-ann", "POST", "/lyrics/101", { text: "Original title: Waiting on the Lord\nKey: Eb\n\n1. [00:05.00]Topa [G]ngak ta un\n\nSakkik:\nVang-liat-na!\n\n2. Jesu tung", base: 0 });
	await call("gh-ann", "POST", "/lyrics/102?lang=en", { text: "Wait on the Lord", base: 0 });
	const all = await idx();
	assert.deepEqual(all.songs, [[101, "", 1, "Waiting on the Lord\nTopa ngak ta un\nVang-liat-na!\nJesu tung"], [102, "en", 1, "Wait on the Lord"]]);
	assert.deepEqual(all.gone, []);
	// Changed since: a new save, and a hidden text as gone.
	tick(10);
	await call("gh-ann", "POST", "/lyrics/102?lang=en", { text: "Wait upon the Lord", base: 1 });
	const mod = (await setupRight(env, call));
	await call(mod, "POST", "/lyrics/101/hide", { reason: "check" });
	const since = await idx(all.at + 1);
	assert.deepEqual(since.songs.map((s) => [s[0], s[3]]), [[102, "Wait upon the Lord"]]);
	assert.deepEqual(since.gone, [[101, ""]]);
	assert.ok(since.at > all.at);
	assert.deepEqual((await idx()).songs.map((s) => s[0]), [102], "hidden lyrics leave the full index");
});

/** Gives gh-mod the Lyrics right; answers its sign-in name for call(). */
async function setupRight(env, call) {
	await call("gh-mod", "GET", "/lyrics/recent");
	const row = await env.DB.prepare("SELECT member_id FROM member_logins WHERE provider = 'github' AND subject = '44'").first();
	await env.DB.prepare("INSERT OR IGNORE INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'lyrics', 'owner', 0)").bind(row.member_id).run();
	return "gh-mod";
}

test("migration 0002 keeps the lyrics there were, as the originals", { skip }, async () => {
	const { readFileSync } = await import("node:fs");
	const db = new sqlite(":memory:");
	db.exec(`CREATE TABLE lyrics (track INTEGER PRIMARY KEY, version INTEGER NOT NULL, text TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by INTEGER NOT NULL, hidden_at INTEGER, hidden_by TEXT, hidden_reason TEXT);
		CREATE TABLE lyrics_versions (track INTEGER NOT NULL, version INTEGER NOT NULL, text TEXT NOT NULL, member_id INTEGER NOT NULL, at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (track, version)) WITHOUT ROWID;
		CREATE TABLE lyrics_reports (id INTEGER PRIMARY KEY, track INTEGER NOT NULL, member_id INTEGER NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT);
		INSERT INTO lyrics VALUES (5, 2, 'two', 100, 7, 150, 'mod', 'x');
		INSERT INTO lyrics_versions VALUES (5, 1, 'one', 7, 90, ''), (5, 2, 'two', 7, 100, '');
		INSERT INTO lyrics_reports (track, member_id, reason, at) VALUES (5, 8, 'bad', 120);`);
	db.exec(readFileSync(new URL("../worker/media/migrations/0002-lyrics-languages.sql", import.meta.url), "utf8"));
	assert.deepEqual({ ...db.prepare("SELECT track, lang, version, text, words, hidden_by, changed_at FROM lyrics").get() }, { track: 5, lang: "", version: 2, text: "two", words: null, hidden_by: "mod", changed_at: 150 });
	assert.deepEqual(db.prepare("SELECT lang, version FROM lyrics_versions ORDER BY version").all().map((r) => [r.lang, r.version]), [["", 1], ["", 2]]);
	assert.equal(db.prepare("SELECT lang FROM lyrics_reports").get().lang, "");
	// The schema then finds what it wants already there.
	const schema = readFileSync(new URL("../worker/media/schema.sql", import.meta.url), "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
	assert.doesNotThrow(() => db.exec(schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS lyrics "))));
	// And a database from before lyrics existed migrates too.
	const empty = new sqlite(":memory:");
	assert.doesNotThrow(() => empty.exec(readFileSync(new URL("../worker/media/migrations/0002-lyrics-languages.sql", import.meta.url), "utf8")));
});

test("shared lyrics: one text for several recordings, each with its own timing", { skip }, async () => {
	const { env, call, read, signIn, tick } = setup();
	await seed(env);
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (103, 'a', 'd.mp3', 0), (104, 'a', 'e.mp3', 0)").run();
	const { applyTimes, clearTimes } = await import("../src/core/lyrics-format.js");
	// Ann's recording, timed to her song.
	const timed = "Key: G\n\n[Verse 1]\n[00:10.00]Topa ngak ta un\n[00:14.00]Vang liat na\n\n[Chorus]\n[00:20.00][01:05.00]Hallelujah";
	assert.equal((await call("gh-ann", "POST", "/lyrics/101", { text: timed, base: 0 })).status, 200);
	tick(60);

	// Linking is for the Lyrics right; a member proposes instead.
	const mod = (await signIn("gh-mod")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'lyrics', 'owner', 0)").bind(mod).run();
	assert.equal((await call("gh-bo", "POST", "/lyrics/102/link", { to: 101 })).status, 403);
	const linked = await call("gh-mod", "POST", "/lyrics/102/link", { to: 101 });
	assert.equal(linked.status, 200, JSON.stringify(linked.body));
	assert.deepEqual(linked.body.shared, { source: 101, with: [101] });
	assert.equal(linked.body.text, clearTimes(timed), "the linked recording shows the words, untimed");
	const own = await read(101);
	assert.equal(own.body.text, timed, "the source keeps its own timing");
	assert.deepEqual(own.body.shared, { source: 101, with: [102] });
	const history = await call("gh-mod", "GET", "/lyrics/102/versions");
	assert.equal(history.body.source, 101);
	assert.match(history.body.versions[0].note, /shared with song 102/);
	assert.equal(history.body.versions[0].text, clearTimes(timed), "the shared text keeps no times");

	// Never over lyrics, never twice, never in a circle; a link to a linked song goes to its source.
	assert.equal((await call("gh-mod", "POST", "/lyrics/101/link", { to: 102 })).status, 409, "the same text already");
	assert.equal((await call("gh-mod", "POST", "/lyrics/102/link", { to: 101 })).status, 409, "already linked");
	assert.equal((await call("gh-mod", "POST", "/lyrics/104/link", { to: 999 })).status, 404, "no such song");
	assert.equal((await call(null, "POST", "/lyrics/104/link", { to: 101 })).status, 401);
	const third = await call("gh-mod", "POST", "/lyrics/103/link", { to: 102 });
	assert.deepEqual(third.body.shared, { source: 101, with: [101, 102] });

	// Bo times his recording: the words stay one version, his times are his.
	const v = linked.body.version;
	const bos = applyTimes(linked.body.text, [[5], [9], [15, 50]]);
	const timedBo = await call("gh-bo", "POST", "/lyrics/102", { text: bos, base: v });
	assert.equal(timedBo.status, 200, JSON.stringify(timedBo.body));
	assert.equal(timedBo.body.version, v, "timing only: no new version of the words");
	assert.equal((await read(102)).body.text, bos);
	assert.equal((await read(101)).body.text, timed, "Ann's timing is untouched");
	assert.equal((await read(103)).body.text, clearTimes(timed));

	// A correction from any recording is one for all; each keeps its timing.
	tick(60);
	const fixed = await call("gh-bo", "POST", "/lyrics/102", { text: bos.replace("Vang liat na", "Vang-liat-na!"), base: v });
	assert.equal(fixed.body.version, v + 1);
	assert.match((await read(101)).body.text, /\[00:14\.00\]Vang-liat-na!/);
	assert.match((await read(103)).body.text, /^Vang-liat-na!$/m);

	// The index lists every recording with the words.
	const idx = await call(null, "GET", "/lyrics/index?since=0");
	assert.deepEqual(idx.body.songs.map((s) => s[0]), [101, 102, 103]);
	assert.ok(idx.body.songs.every((s) => s[3] === idx.body.songs[0][3]));

	// Unlinking is for the Lyrics right; with a copy, the recording keeps the text and its timing as its own.
	const before = idx.body.at;
	tick(60);
	assert.equal((await call("gh-bo", "POST", "/lyrics/102/unlink", { copy: true })).status, 403);
	const copied = await call("gh-mod", "POST", "/lyrics/102/unlink", { copy: true });
	assert.deepEqual(copied.body, { track: 102, source: 101, copied: true });
	const mine = await read(102);
	assert.equal(mine.body.shared, undefined);
	assert.equal(mine.body.text, applyTimes(clearTimes(fixed.body.text), [[5], [9], [15, 50]]), "the copy carries 102's timing");
	assert.equal((await call("gh-mod", "GET", "/lyrics/102/versions")).body.versions[0].note, "copied from song 101");
	assert.deepEqual((await read(101)).body.shared, { source: 101, with: [103] }, "the source is untouched");
	const changes = await call(null, "GET", `/lyrics/index?since=${before + 1}`);
	assert.deepEqual(changes.body.gone, [[102, ""]]);
	assert.ok(changes.body.songs.some((s) => s[0] === 102), "and comes back with its own copy");

	// Unlinking without a copy leaves the recording without lyrics; hiding from a linked song hides the shared text.
	assert.equal((await call("gh-mod", "POST", "/lyrics/103/unlink", {})).status, 200);
	assert.equal((await read(103)).status, 404);
	assert.equal((await call("gh-mod", "POST", "/lyrics/103/link", { to: 101 })).status, 200, "linking again");
	assert.equal((await call("gh-mod", "POST", "/lyrics/103/hide", { reason: "wrong song" })).status, 200);
	assert.equal((await read(101)).status, 404, "hidden for every recording");
	assert.equal((await read(102)).status, 200, "the copy is its own");
});

test("merging: members propose, the Lyrics right compares and merges, nothing is lost", { skip }, async () => {
	const { env, call, read, signIn, tick } = setup();
	await seed(env);
	await env.DB.prepare("INSERT INTO tracks (id, folder_path, mp3, updated_at) VALUES (201, 'a', 'f.mp3', 0), (202, 'a', 'g.mp3', 0), (203, 'a', 'h.mp3', 0), (204, 'a', 'i.mp3', 0), (205, 'a', 'j.mp3', 0)").run();
	const mod = (await signIn("gh-mod")).member.id;
	await env.DB.prepare("INSERT INTO member_rights (member_id, kind, granted_by, granted_at) VALUES (?1, 'lyrics', 'owner', 0)").bind(mod).run();
	// Two copies of one song: Ann's (worked on), Bo's (timed to his recording, with an English translation).
	await call("gh-ann", "POST", "/lyrics/201", { text: "[Verse 1]\nTopa ngak ta un\nVang liat na", base: 0 });
	tick(10);
	await call("gh-ann", "POST", "/lyrics/201", { text: "[Verse 1]\nTopa ngak ta un\nVang-liat-na!\n\n[Chorus]\nHallelujah", base: 1 });
	await call("gh-bo", "POST", "/lyrics/202", { text: "[00:03.00]Topa ngak ta un\n[00:07.00]Vang liat na", base: 0 });
	await call("gh-bo", "POST", "/lyrics/202?lang=en", { text: "Wait upon the Lord", base: 0 });
	await call("gh-mod", "POST", "/lyrics/203/link", { to: 202 });
	tick(10);

	// Bo proposes; it waits for the Lyrics right.
	assert.equal((await call("gh-bo", "POST", "/lyrics/202/propose", { to: 201, note: "Same hymn, sung by Bo" })).status, 201);
	assert.equal((await call("gh-bo", "POST", "/lyrics/202/propose", { to: 999 })).status, 404);
	const waiting = (await call("gh-mod", "GET", "/lyrics/recent")).body.proposals;
	assert.equal(waiting.length, 1);
	assert.deepEqual([waiting[0].track, waiting[0].target, waiting[0].note, waiting[0].by], [202, 201, "Same hymn, sung by Bo", "bo"]);

	// Comparing both copies.
	const cmp = await call("gh-mod", "GET", "/lyrics/202/compare?with=201");
	assert.equal(cmp.status, 200);
	// Bo's has 2 versions: sharing it with 203 moved its timing out of the text.
	assert.deepEqual([cmp.body.a.versions, cmp.body.a.langs, cmp.body.b.versions, cmp.body.b.people], [2, 2, 2, 1]);
	assert.equal((await call("gh-bo", "GET", "/lyrics/202/compare?with=201")).status, 403);

	// Never over lyrics by accident: a merge is asked for.
	assert.match((await call("gh-mod", "POST", "/lyrics/202/link", { to: 201 })).body.error, /merge/);
	const merged = await call("gh-mod", "POST", "/lyrics/202/link", { to: 201, merge: true, keep: "to", proposal: waiting[0].id });
	assert.equal(merged.status, 200, JSON.stringify(merged.body));
	assert.equal(merged.body.text, "[Verse 1]\n[00:03.00]Topa ngak ta un\n[00:07.00]Vang-liat-na!\n\n[Chorus]\nHallelujah", "Ann's words, Bo's timing");
	assert.deepEqual(merged.body.shared, { source: 201, with: [201, 203] }, "the song linked to Bo's follows");
	assert.equal((await read(203)).body.text, "[Verse 1]\nTopa ngak ta un\nVang-liat-na!\n\n[Chorus]\nHallelujah");
	assert.equal((await call("gh-mod", "GET", "/lyrics/recent")).body.proposals.length, 0, "the proposal is done");
	// The translation only Bo's had comes along; Bo's own text and history stay with his song.
	assert.equal((await call(null, "GET", "/lyrics/201?lang=en")).body.text, "Wait upon the Lord");
	const hist = await call("gh-mod", "GET", "/lyrics/202/versions");
	assert.equal(hist.body.source, 201);
	assert.deepEqual(hist.body.own.map((v) => v.text), ["Topa ngak ta un\nVang liat na", "[00:03.00]Topa ngak ta un\n[00:07.00]Vang liat na"]);
	const hidden = await env.DB.prepare("SELECT hidden_reason FROM lyrics WHERE track = 202 AND lang = ''").first();
	assert.equal(hidden.hidden_reason, "merged into song 201");

	// A copy of its own brings it back, its own history continuing.
	tick(10);
	assert.equal((await call("gh-mod", "POST", "/lyrics/202/unlink", { copy: true })).status, 200);
	const back = await read(202);
	assert.deepEqual([back.body.version, back.body.shared], [3, undefined]);
	assert.match(back.body.text, /\[00:03\.00\]Topa ngak ta un\n\[00:07\.00\]Vang-liat-na!/);

	// Merging the other way: the song's own text is kept, the other gives way.
	await call("gh-ann", "POST", "/lyrics/204", { text: "Line kept", base: 0 });
	await call("gh-bo", "POST", "/lyrics/205", { text: "Line dropped", base: 0 });
	const other = await call("gh-mod", "POST", "/lyrics/204/link", { to: 205, merge: true, keep: "track" });
	assert.equal(other.status, 200, JSON.stringify(other.body));
	assert.equal((await read(204)).body.text, "Line kept");
	assert.equal((await read(205)).body.text, "Line kept");
	assert.deepEqual((await read(205)).body.shared, { source: 204, with: [204] });

	// Declining a proposal, with a reason.
	await call("gh-bo", "POST", "/lyrics/101/propose", { to: 204 });
	const p = (await call("gh-mod", "GET", "/lyrics/recent")).body.proposals[0];
	assert.equal((await call("gh-mod", "POST", "/lyrics/101/decline", { proposal: p.id, reason: "" })).status, 400);
	assert.equal((await call("gh-mod", "POST", "/lyrics/101/decline", { proposal: p.id, reason: "Another song with the same title" })).status, 200);
	assert.equal((await call("gh-mod", "POST", "/lyrics/101/decline", { proposal: p.id, reason: "again" })).status, 404);
});
