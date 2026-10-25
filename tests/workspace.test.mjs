import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChanges, cleanValue, describe, DraftError, indexData, setChange, sourceText } from "../src/workspace/draft.js";
import { healthChecks, tidyText } from "../src/workspace/health.js";
import { challengeOf, createSession, PENDING_KEY, SESSION_KEY } from "../src/workspace/session.js";
import { LEVELS, levelOf, readWho, saveWho, WHO_KEY } from "../src/core/access.js";
import { releaseFiles } from "../tools/lib/version.mjs";

const data = () => ({
	albums: [{ ui: "a1", ab: "Agape", gr: [2], yr: [1987], lg: 1, tk: [{ t: "Hong len in", a: [10], d: 200, p: 5, i: 1 }, { t: "Two", a: [11], d: 100, p: 1, i: 2 }] }],
	artists: [{ id: 10, name: "Lianbawi", aka: "", type: 2, thesaurus: [] }, { id: 11, name: "Thangno", type: 2 }],
});
const category = { lang: [{ id: 1, name: "zola" }, { id: 3, name: "mizo" }], genre: [{ id: 2, name: "Gospel" }, { id: 4, name: "Tribal" }], artist: [{ id: 2, name: "Male" }, { id: 3, name: "Female" }] };

test("values are checked and made canonical", () => {
	assert.equal(cleanValue({ kind: "album", field: "ab" }, "  Agape No.1 "), "Agape No.1");
	assert.throws(() => cleanValue({ kind: "album", field: "ab" }, "  "), DraftError);
	assert.equal(cleanValue({ kind: "album", field: "yr" }, ""), null);
	assert.throws(() => cleanValue({ kind: "album", field: "yr" }, "87"), /1900/);
	assert.throws(() => cleanValue({ kind: "album", field: "lg" }, "9", category), /unknown language/);
	assert.deepEqual(cleanValue({ kind: "album", field: "gr" }, ["2", "4", "2"], category), [2, 4]);
	assert.deepEqual(cleanValue({ kind: "artist", field: "thesaurus" }, "a, b ,, a"), ["a", "b"]);
	assert.equal(cleanValue({ kind: "track", field: "t" }, "ဟေ့်".normalize("NFD")), "ဟေ့်".normalize("NFC"));
	assert.throws(() => cleanValue({ kind: "track", field: "zz" }, 1), /unknown field/);
});

test("a change back to the source value leaves the draft", () => {
	const index = indexData(data());
	let changes = setChange([], index, { kind: "album", id: "a1", field: "ab", value: "Agape No.1" });
	changes = setChange(changes, index, { kind: "album", id: "a1", field: "ab", value: "Agape II" });
	assert.equal(changes.length, 1);
	assert.equal(changes[0].value, "Agape II");
	changes = setChange(changes, index, { kind: "album", id: "a1", field: "ab", value: "Agape" });
	assert.deepEqual(changes, []);
	assert.throws(() => setChange([], index, { kind: "track", id: 99, field: "t", value: "x" }), /does not exist/);
});

test("changes apply to copies, and missing records are named", () => {
	const src = data();
	const changes = [
		{ kind: "album", id: "a1", field: "yr", value: null },
		{ kind: "track", id: 2, field: "h", value: true },
		{ kind: "track", id: 1, field: "a", value: [10, 11] },
		{ kind: "artist", id: 11, field: "thesaurus", value: ["Thang No"] },
		{ kind: "track", id: 77, field: "t", value: "gone" },
	];
	const out = applyChanges(src, changes);
	assert.deepEqual(out.albums[0].yr, []);
	assert.equal(out.albums[0].tk[1].h, true);
	assert.deepEqual(out.albums[0].tk[0].a, [10, 11]);
	assert.deepEqual(out.artists[1].thesaurus, ["Thang No"]);
	assert.equal(out.missing.length, 1);
	assert.match(out.missing[0].reason, /track 77/);
	assert.deepEqual(src.albums[0].yr, [1987], "the source is untouched");
	const shown = applyChanges(out, [{ kind: "track", id: 2, field: "h", value: false }]);
	assert.equal("h" in shown.albums[0].tk[1], false, "showing again removes the field");
});

test("descriptions read as sentences", () => {
	const index = indexData(data());
	const names = { artist: (id) => index.artist.get(id)?.name, genre: (id) => category.genre.find((g) => g.id === id)?.name };
	assert.equal(describe({ kind: "album", id: "a1", field: "ab", value: "Agape II" }, index), 'album "Agape": title "Agape" → "Agape II"');
	assert.equal(describe({ kind: "track", id: 2, field: "h", value: true }, index), 'Hide the song "Two" (Agape)');
	assert.equal(describe({ kind: "track", id: 1, field: "a", value: [10, 11] }, index, names), 'song "Hong len in": artists Lianbawi → Lianbawi, Thangno');
	assert.equal(describe({ kind: "album", id: "a1", field: "gr", value: [4] }, index, names), 'album "Agape": genres Gospel → Tribal');
});

test("source files keep the repository's format, and releases use the shared writer", () => {
	assert.equal(sourceText([{ a: 1 }], "[]"), '[\n  {\n    "a": 1\n  }\n]');
	assert.equal(sourceText([], "[]\n"), "[]\n");
	const files = releaseFiles({
		"package.json": '{\n\t"name": "z",\n\t"version": "26.10.22.2"\n}\n',
		"platforms/desktop/package.json": '{\n\t"version": "26.10.22.2"\n}\n',
		"CHANGELOG.md": "# Version\n\n## v26.10.22.2\n\n- before\n",
	}, "26.10.22.3", ["Catalog fixes"]);
	assert.match(files["package.json"], /"version": "26.10.22.3"/);
	assert.ok(files["CHANGELOG.md"].startsWith("# Version\n\n## v26.10.22.3\n\n- Catalog fixes\n\n## v26.10.22.2"));
});

/* ---------------------------------------------------------------- health ---- */

test("tidyText corrects stray spaces and the Unicode form, and leaves clean text alone", () => {
	assert.equal(tidyText(" Agape  No.1 "), "Agape No.1");
	assert.equal(tidyText("Café"), "Café");
	assert.equal(tidyText("Agape No.1"), null);
	assert.equal(tidyText(undefined), null);
});

test("healthChecks lists what needs a look, with fixes that apply to the draft", () => {
	const data = {
		albums: [
			{ ui: "a1", ab: "First  album", yr: [], gr: [], lg: 1, tk: [{ i: 1, t: "Song ", a: [], d: 0 }, { i: 2, t: "Hidden", a: [10], d: 200, h: true }] },
			{ ui: "a2", ab: "Second", yr: [1990], gr: [3], lg: 1, tk: [{ i: 3, t: "Fine", a: [11], d: 180 }] },
		],
		artists: [{ id: 10, name: "Lam Cin" }, { id: 11, name: "Lamcin" }, { id: 12, name: "Nobody" }],
	};
	const byId = Object.fromEntries(healthChecks(data).map((c) => [c.id, c]));
	assert.equal(byId.text.total, 2);
	assert.deepEqual(byId.text.fixes, [
		{ kind: "album", id: "a1", field: "ab", value: "First album" },
		{ kind: "track", id: 1, field: "t", value: "Song" },
	]);
	assert.equal(byId["no-artist"].total, 1);
	assert.equal(byId["no-duration"].total, 1, "the hidden song is not counted");
	assert.deepEqual(byId["no-year"].items.map((i) => i.id), ["a1"]);
	assert.deepEqual(byId["no-genre"].items.map((i) => i.id), ["a1"]);
	assert.deepEqual(byId["duplicate-artist"].items.map((i) => i.id), [10, 11]);
	assert.deepEqual(byId.hidden.items.map((i) => [i.id, i.open]), [[2, { kind: "album", id: "a1" }]]);
	assert.deepEqual(byId["unused-artist"].items.map((i) => i.id), [12]);
	assert.ok(!("fixes" in byId["no-year"]));
	// The fixes are valid draft changes.
	const index = indexData(data);
	let changes = [];
	for (const f of byId.text.fixes) changes = setChange(changes, index, f);
	assert.equal(changes.length, 2);
});

/* --------------------------------------------------------------- session ---- */

function memoryStorage() {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}
function fakeAuth(answers) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		const path = url.split("/").pop();
		calls.push({ path, body: JSON.parse(init.body) });
		const a = answers[path];
		const { status = 200, body = {} } = typeof a === "function" ? a() : a;
		return new Response(status === 204 ? null : JSON.stringify(body), { status });
	};
	return { calls, fetchImpl };
}

test("PKCE challenge is the S256 of the verifier (RFC 7636 example)", async () => {
	assert.equal(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("sign-in: start keeps the verifier for this tab; finish needs the same tab's nonce", async () => {
	const local = memoryStorage(), tab = memoryStorage();
	const auth = fakeAuth({ token: { body: { access_token: "ghu_1", expires_at: 10_000_000, refresh_token: "ghr_1", refresh_expires_at: 99_000_000 } } });
	const session = createSession({ authUrl: "https://media.zaideih.com/auth", local, tab, fetchImpl: auth.fetchImpl, now: () => 0 });
	const to = new URL(await session.start("https://zaideih.com/"));
	assert.equal(to.origin + to.pathname, "https://media.zaideih.com/auth/login");
	const pending = JSON.parse(tab.getItem(PENDING_KEY));
	assert.equal(to.searchParams.get("nonce"), pending.nonce);
	assert.equal(to.searchParams.get("challenge"), await challengeOf(pending.verifier));
	assert.ok(!to.href.includes(pending.verifier), "the verifier never leaves the page");

	await assert.rejects(session.finish({ code: "c", nonce: "someone-else" }), /not started from this tab/);
	assert.equal(tab.getItem(PENDING_KEY), null, "a refused code also ends the attempt");
	assert.equal(auth.calls.length, 0);

	await session.start("https://zaideih.com/");
	const { nonce, verifier } = JSON.parse(tab.getItem(PENDING_KEY));
	await session.finish({ code: "c", nonce });
	assert.deepEqual(auth.calls[0], { path: "token", body: { code: "c", verifier } });
	assert.equal(session.signedIn, true);
	assert.equal(await session.token(), "ghu_1");
});

test("sign-in: the token is renewed near its end, once for parallel calls, and a failed renewal signs out", async () => {
	const local = memoryStorage(), tab = memoryStorage();
	let t = 0;
	let n = 0;
	const auth = fakeAuth({ refresh: () => ({ body: { access_token: `ghu_${++n}`, expires_at: t + 8 * 3600e3, refresh_token: `ghr_${n}`, refresh_expires_at: t + 1e10 } }), signout: { status: 204 } });
	const session = createSession({ authUrl: "https://w/auth", local, tab, fetchImpl: auth.fetchImpl, now: () => t });
	local.setItem(SESSION_KEY, JSON.stringify({ access_token: "ghu_0", expires_at: 10 * 60e3, refresh_token: "ghr_0", refresh_expires_at: 1e10 }));
	assert.equal(await session.token(), "ghu_0", "more than five minutes left");
	t = 6 * 60e3;
	const [a, b] = await Promise.all([session.token(), session.token()]);
	assert.equal(a, "ghu_1");
	assert.equal(b, "ghu_1");
	assert.equal(auth.calls.filter((c) => c.path === "refresh").length, 1);
	assert.deepEqual(auth.calls[0].body, { refresh_token: "ghr_0" });

	await session.signOut();
	assert.equal(local.getItem(SESSION_KEY), null);
	assert.deepEqual(auth.calls.at(-1), { path: "signout", body: { access_token: "ghu_1" } });

	const failing = createSession({ authUrl: "https://w/auth", local, tab, fetchImpl: fakeAuth({ refresh: { status: 400, body: { error: "GitHub: The refresh token has expired." } } }).fetchImpl, now: () => 1e6 });
	local.setItem(SESSION_KEY, JSON.stringify({ access_token: "old", expires_at: 0, refresh_token: "ghr", refresh_expires_at: 1e10 }));
	await assert.rejects(failing.token(), /could not be renewed \(GitHub: The refresh token has expired.\); sign in again/);
	assert.equal(local.getItem(SESSION_KEY), null);
	assert.equal(failing.signedIn, false);
});

test("sign-in: an expired refresh token is not sent anywhere", async () => {
	const local = memoryStorage();
	const auth = fakeAuth({});
	const session = createSession({ authUrl: "https://w/auth", local, tab: memoryStorage(), fetchImpl: auth.fetchImpl, now: () => 100 });
	local.setItem(SESSION_KEY, JSON.stringify({ access_token: "a", expires_at: 50, refresh_token: "r", refresh_expires_at: 90 }));
	assert.equal(session.signedIn, false);
	await assert.rejects(session.token(), /has run out/);
	assert.equal(auth.calls.length, 0);
	const off = createSession({ authUrl: "", local, tab: memoryStorage() });
	await assert.rejects(off.start("https://zaideih.com/"), /not built into this version/);
});

/* ---------------------------------------------------------------- access ---- */

test("levels follow the repository permission", () => {
	assert.equal(levelOf({ admin: true, push: true }), "admin");
	assert.equal(levelOf({ maintain: true, push: true }), "admin");
	assert.equal(levelOf({ push: true }), "editor");
	assert.equal(levelOf({ triage: true, pull: true }), "contributor");
	assert.equal(levelOf({ pull: true }), "guest");
	assert.equal(levelOf(undefined), "guest");
	assert.deepEqual(Object.entries(LEVELS).filter(([, l]) => l.canWrite).map(([k]) => k), ["admin", "editor"]);
});

test("the level shown on every page lasts only as long as the sign-in it came from", () => {
	const st = memoryStorage();
	assert.equal(readWho(st), null, "a listener is a viewer");
	saveWho(st, { login: "ann", level: "guest", via: "github", extra: "dropped" });
	assert.equal(readWho(st), null, "no sign-in behind it");
	st.setItem(SESSION_KEY, JSON.stringify({ access_token: "a", expires_at: 100, refresh_token: "r", refresh_expires_at: 1000 }));
	assert.deepEqual(readWho(st, 500), { login: "ann", level: "guest", via: "github" }, "renewable");
	assert.equal(readWho(st, 2000), null, "run out");
	saveWho(st, { login: "kh", level: "editor", via: "token" });
	assert.equal(readWho(st), null, "token gone");
	st.setItem("zaideih.workspace.token", JSON.stringify("github_pat_x"));
	assert.equal(readWho(st).level, "editor");
	st.setItem(WHO_KEY, JSON.stringify({ login: "x", level: "owner", via: "token" }));
	assert.equal(readWho(st), null, "unknown level");
	saveWho(st, null);
	assert.equal(st.getItem(WHO_KEY), null);
});

test("the admin page's keys move to the Workspace's once; a key already moved is kept", async () => {
	const { moveKeys } = await import("../src/core/moved-keys.js");
	const map = new Map([["zaideih.admin.draft", "D"], ["zaideih.admin.token", "old"], ["zaideih.workspace.token", "new"], ["zaideih.rail", "R"]]);
	const storage = {
		get length() { return map.size; },
		key: (i) => [...map.keys()][i] ?? null,
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
	};
	assert.equal(moveKeys(storage), 2);
	assert.deepEqual(Object.fromEntries(map), { "zaideih.workspace.token": "new", "zaideih.rail": "R", "zaideih.workspace.draft": "D" });
	assert.equal(moveKeys(storage), 0);
});
