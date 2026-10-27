/**
 * The Workspace's Statistics, from the audio Worker's play counts: the totals
 * per song (GET /plays: all time and the last 30 days) and the counting's
 * history (GET /plays/stats: when it began, the plays of each day, and each
 * song's plays of the last 7 days). Days are UTC days, as the Worker keeps them.
 *
 * Pure: tested in Node (tests/stats.test.mjs).
 */
import { NOT_ARTISTS } from "../core/catalog.js";

const DAY_MS = 86400000;
export const PERIODS = Object.freeze({ week: 7, month: 30, all: Infinity });

/** GET /plays/stats beside the totals' address, or "" when that is not a URL. */
export function statsUrl(totalsUrl) {
	try {
		const u = new URL(totalsUrl);
		u.pathname = `${u.pathname.replace(/\/+$/, "")}/stats`;
		u.search = "";
		return u.href;
	} catch {
		return "";
	}
}

const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayText = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** The day `n` days after `day` (YYYY-MM-DD). */
export const dayAfter = (day, n) => dayText(dayNumber(day) + n);

/** Checks the Worker's answer; throws with the reason when it is not usable. */
export function parseStats(data) {
	const isDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
	if (!data || data.v !== 1 || !isDay(data.today) || !(data.first === null || isDay(data.first)) || !Array.isArray(data.days) || !Array.isArray(data.week)) throw new Error("unexpected play statistics format");
	return {
		updated: data.updated,
		first: data.first,
		today: data.today,
		days: data.days.filter((r) => Array.isArray(r) && isDay(r[0]) && Number.isSafeInteger(r[1]) && r[1] >= 0),
		week: new Map(data.week.filter((r) => Array.isArray(r) && Number.isSafeInteger(r[0]) && Number.isSafeInteger(r[1])).map(([id, n]) => [id, n])),
	};
}

/**
 * Everything the page shows apart from the ranking:
 * { first, today, age (days counted, today included), week, month, all,
 *   average (per day counted), busiest {day, n} | null, days [{day, n}] (every
 *   day from the first, at most `chartDays`, zeros included), played (songs) }
 */
export function summarize(totals, stats, { chartDays = 90 } = {}) {
	let all = 0;
	let month = 0;
	let played = 0;
	for (const [, total, recent] of totals.tracks) {
		all += total;
		month += recent;
		if (total > 0) played += 1;
	}
	let week = 0;
	for (const n of stats.week.values()) week += n;
	const today = dayNumber(stats.today);
	const first = stats.first ? dayNumber(stats.first) : today;
	const age = today - first + 1;
	const byDay = new Map(stats.days.map(([d, n]) => [dayNumber(d), n]));
	const days = [];
	for (let d = Math.max(first, today - chartDays + 1); d <= today; d++) days.push({ day: dayText(d), n: byDay.get(d) ?? 0 });
	let busiest = null;
	for (const [d, n] of stats.days) if (n > 0 && (!busiest || n > busiest.n)) busiest = { day: d, n };
	return { first: stats.first, today: stats.today, age, week, month, all, average: all / age, busiest, days, played };
}

/** The periods worth offering: one that covers the whole counting is the same as "all" and is left out. */
export function periodsFor(age) {
	return Object.keys(PERIODS).filter((p) => p === "all" || PERIODS[p] < age);
}

/**
 * The ranking of `kind` (songs, albums, artists, languages) over `period`
 * (week, month, all): [{ key, label, sub, n, open }] by plays, most first.
 * `track(id)` is the catalog's song; a song no longer in the catalog is
 * listed under songs only. An artist gets every play of each song credited to
 * them; "Unknown" and "Various Artists" are credits, not artists, and are left out.
 */
export function ranking(totals, stats, track, period, kind) {
	const plays = new Map();
	for (const [id, total, recent] of totals.tracks) {
		const n = period === "week" ? stats.week.get(id) ?? 0 : period === "month" ? recent : total;
		if (n > 0) plays.set(id, n);
	}
	const groups = new Map();
	const add = (key, n, make) => {
		const g = groups.get(key);
		if (g) g.n += n;
		else groups.set(key, { key, n, ...make() });
	};
	for (const [id, n] of plays) {
		const t = track(id);
		if (kind === "songs") {
			add(id, n, () => t
				? { label: t.title, sub: [t.album.title, t.artists.filter((a) => a && !NOT_ARTISTS.has(a.id)).map((a) => a.name).join(", ")].filter(Boolean).join(" · "), open: { kind: "album", id: t.album.id } }
				: { label: `Song #${id}`, sub: "no longer in the catalog", open: null });
			continue;
		}
		if (!t) continue;
		if (kind === "albums") add(t.album.id, n, () => ({ label: t.album.title, sub: t.album.lang?.name ?? "", open: { kind: "album", id: t.album.id } }));
		else if (kind === "languages") add(t.album.lang?.id ?? -1, n, () => ({ label: t.album.lang?.name ?? "No language", sub: "", open: null }));
		else for (const a of new Set(t.artists)) if (a && !NOT_ARTISTS.has(a.id)) add(a.id, n, () => ({ label: a.name, sub: a.aka ?? "", open: { kind: "artist", id: a.id } }));
	}
	return [...groups.values()].sort((x, y) => y.n - x.n || String(x.label).localeCompare(String(y.label)));
}
