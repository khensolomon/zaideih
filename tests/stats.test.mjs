import assert from "node:assert/strict";
import { test } from "node:test";
import { dayAfter, parseStats, periodsFor, ranking, statsUrl, summarize } from "../src/workspace/stats.js";

const lang = { id: 1, name: "Zolai" };
const albumA = { id: "a", title: "Agape", lang };
const albumB = { id: "b", title: "Bawk", lang: { id: 2, name: "Myanmar" } };
const unknown = { id: 0, name: "Unknown" };
const lian = { id: 10, name: "Lianbawi", aka: "" };
const thang = { id: 11, name: "Thangno", aka: "" };
const tracks = new Map([
	[1, { id: 1, title: "One", album: albumA, artists: [lian] }],
	[2, { id: 2, title: "Two", album: albumA, artists: [lian, thang] }],
	[3, { id: 3, title: "Three", album: albumB, artists: [unknown] }],
]);
const track = (id) => tracks.get(id) ?? null;
const totals = { v: 1, updated: 1, recentDays: 30, tracks: [[1, 50, 20], [2, 30, 30], [3, 10, 0], [9, 5, 1]] };
const stats = parseStats({ v: 1, updated: 2, first: "2026-09-01", today: "2026-10-27", days: [["2026-09-01", 40], ["2026-10-26", 30], ["2026-10-27", 25], ["bad", 1]], week: [[1, 4], [2, 6]] });

test("stats: the address sits beside the totals", () => {
	assert.equal(statsUrl("https://audio.example/plays"), "https://audio.example/plays/stats");
	assert.equal(statsUrl("https://audio.example/plays/?x=1"), "https://audio.example/plays/stats");
	assert.equal(statsUrl(""), "");
	assert.throws(() => parseStats({ v: 2 }), /format/);
	assert.equal(stats.days.length, 3, "a bad row is left out");
	assert.equal(dayAfter("2026-09-01", 30), "2026-10-01");
});

test("stats: the summary counts from the first day, with every day in the chart", () => {
	const sum = summarize(totals, stats);
	assert.equal(sum.age, 57);
	assert.equal(sum.all, 95);
	assert.equal(sum.month, 51);
	assert.equal(sum.week, 10);
	assert.equal(sum.played, 4);
	assert.deepEqual(sum.busiest, { day: "2026-09-01", n: 40 });
	assert.equal(sum.days.length, 57);
	assert.deepEqual(sum.days.at(-1), { day: "2026-10-27", n: 25 });
	assert.equal(sum.days[1].n, 0, "a day without plays is a zero");
	assert.equal(summarize(totals, stats, { chartDays: 10 }).days[0].day, "2026-10-18");
});

test("stats: a period as long as the counting is not offered", () => {
	assert.deepEqual(periodsFor(57), ["week", "month", "all"]);
	assert.deepEqual(periodsFor(30), ["week", "all"]);
	assert.deepEqual(periodsFor(5), ["all"]);
});

test("stats: rankings by song, album, artist and language", () => {
	const songs = ranking(totals, stats, track, "all", "songs");
	assert.deepEqual(songs.map((r) => [r.key, r.n]), [[1, 50], [2, 30], [3, 10], [9, 5]]);
	assert.equal(songs[1].sub, "Agape · Lianbawi, Thangno");
	assert.equal(songs[2].sub, "Bawk", "Unknown is not named");
	assert.equal(songs[3].open, null, "a song gone from the catalog cannot be opened");
	assert.deepEqual(ranking(totals, stats, track, "all", "albums").map((r) => [r.key, r.n]), [["a", 80], ["b", 10]]);
	assert.deepEqual(ranking(totals, stats, track, "month", "artists").map((r) => [r.key, r.n]), [[10, 50], [11, 30]]);
	assert.deepEqual(ranking(totals, stats, track, "week", "songs").map((r) => [r.key, r.n]), [[2, 6], [1, 4]]);
	assert.deepEqual(ranking(totals, stats, track, "all", "languages").map((r) => [r.label, r.n]), [["Zolai", 80], ["Myanmar", 10]]);
});
