/**
 * Questions typed into search: "most played artists", "mizo gospel albums
 * from the 90s", "newest albums by lianbawi", "top songs 1987".
 *
 * parseIntent() reads what kind of thing is asked for, how to order it and
 * which filters apply, from a small fixed vocabulary plus the catalog's own
 * language, genre and artist names. answer() lists the matching records.
 * A query that reads as an ordinary title search returns null, so normal
 * search stays in charge of everything else.
 */
import { normalize } from "./text.js";

const SORTS = [
	["plays", ["most played", "most popular", "most listened", "popular", "top", "best", "hits", "hit", "favourite", "favorite"]],
	["newest", ["newest", "latest", "new", "recent", "recently released"]],
	["oldest", ["oldest", "earliest", "old"]],
];
const KINDS = [
	["artists", ["artists", "artist", "singers", "singer", "bands", "band", "choirs", "choir", "groups", "group", "who"]],
	["albums", ["albums", "album", "records", "record", "collections", "collection"]],
	["tracks", ["songs", "song", "tracks", "track"]],
];
const LANG_ALIASES = { burmese: "myanmar" };
const STOP = new Set(["who", "what", "which", "whose", "is", "are", "was", "were", "the", "a", "an", "of", "in", "on", "from", "with", "me",
	"show", "list", "give", "find", "all", "any", "some", "play", "and", "for", "year", "years", "music", "ever", "time", "made", "released", "s"]);

/** Removes a whole phrase from a space-separated token string; returns [found, rest]. */
function take(text, phrase) {
	const re = new RegExp(`(^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
	if (!re.test(text)) return [false, text];
	return [true, text.replace(re, " ").replace(/ +/g, " ").trim()];
}

function takeFirst(text, table) {
	for (const [value, phrases] of table) {
		for (const p of [...phrases].sort((a, b) => b.length - a.length)) {
			const [found, rest] = take(text, p);
			if (found) return [value, rest];
		}
	}
	return [null, text];
}

/** Years: "1987", "1990s", "90s", "90 s" (normalized "90's"). */
function takeYears(text) {
	let m = text.match(/(^| )((?:19|20)\d)0 ?s( |$)/) ?? text.match(/(^| )(\d)0 ?s( |$)/);
	if (m) {
		const decade = m[2].length === 1 ? (Number(m[2]) >= 3 ? 1900 : 2000) + Number(m[2]) * 10 : Number(m[2]) * 10;
		return [[decade, decade + 9], text.replace(m[0], " ").trim()];
	}
	m = text.match(/(^| )(19[3-9]\d|20[0-4]\d)( |$)/);
	if (m) return [[Number(m[2]), Number(m[2])], text.replace(m[0], " ").trim()];
	return [null, text];
}

function takeNamed(text, records, nameOf) {
	const list = [...records].map((r) => [normalize(nameOf(r)), r]).filter(([n]) => n).sort((a, b) => b[0].length - a[0].length);
	for (const [name, rec] of list) {
		const [found, rest] = take(text, name);
		if (found) return [rec, rest];
	}
	return [null, text];
}

/** The artist a phrase names: exact name or also-known-as, else a unique prefix. */
function artistNamed(catalog, phrase) {
	if (!phrase) return null;
	const q = phrase.replace(/ /g, "");
	let best = null;
	for (const a of catalog.artists.values()) {
		if (a.id <= 1) continue;
		const names = [a.name, a.aka].filter(Boolean).map((n) => normalize(n).replace(/ /g, ""));
		if (names.includes(q)) { if (!best || a.plays > best.plays) best = a; }
	}
	if (best) return best;
	if (q.length < 4) return null;
	const starts = [...catalog.artists.values()].filter((a) => a.id > 1 && normalize(a.name).replace(/ /g, "").startsWith(q));
	return starts.length ? starts.sort((x, y) => y.plays - x.plays)[0] : null;
}

/**
 * Reads a query as a question. Returns null when it does not ask for a
 * list, otherwise { kind, sort, lang, genre, years, by, text } where `text`
 * is any leftover words, matched against titles.
 */
export function parseIntent(catalog, query) {
	let text = normalize(query);
	if (!text) return null;
	let sort, kind, lang, genre, years, by = null;
	[sort, text] = takeFirst(text, SORTS);
	const asksWho = /(^| )who( |$)/.test(text);
	[kind, text] = takeFirst(text, KINDS);
	[years, text] = takeYears(text);
	for (const [alias, name] of Object.entries(LANG_ALIASES)) text = text.replace(new RegExp(`(^| )${alias}( |$)`), ` ${name} `).trim();
	[lang, text] = takeNamed(text, catalog.langs.values(), (l) => l.name);
	[genre, text] = takeNamed(text, catalog.genres.values(), (g) => g.name);
	const byMatch = text.match(/(^| )by (.+)$/);
	if (byMatch) {
		by = artistNamed(catalog, byMatch[2].trim());
		if (by) text = text.slice(0, byMatch.index).trim();
	}
	const words = text.split(" ").filter((w) => w && !STOP.has(w));
	text = words.join(" ");
	// "lianbawi albums", "albums of lianbawi": the leftover words name an artist.
	if (!by && kind && kind !== "artists" && text) {
		const a = artistNamed(catalog, text);
		if (a) { by = a; text = ""; }
	}
	const filters = Boolean(lang || genre || years || by);
	// "best friend" or "new life" are titles: an order word alone, with other
	// words left over, does not make a question.
	const fires = (sort && (!text || kind || filters)) || Boolean(by) || (kind && filters) || (filters && !text) || (asksWho && kind === "artists");
	if (!fires) return null;
	kind ??= by ? "albums" : sort && !filters ? "tracks" : "albums";
	sort ??= "plays";
	return { kind, sort, lang, genre, years, by, text };
}

const tokensOf = (text) => (text ? text.split(" ") : []);
const hasAll = (hay, tokens) => tokens.every((t) => hay.includes(t));

/** Lists the records an intent asks for, best first. */
export function answer(catalog, intent, limit = 60) {
	const { kind, sort, lang, genre, years, by, text } = intent;
	const tokens = tokensOf(text);
	const albumOk = (al) => (!lang || al.lang === lang)
		&& (!genre || al.genres.includes(genre))
		&& (!years || (al.year >= years[0] && al.year <= years[1]));
	const trackOk = (t) => albumOk(t.album) && (!by || t.artists.includes(by)) && (!tokens.length || hasAll(t.search, tokens) || hasAll(t.album.search, tokens));
	const byYear = (dir) => (x, y) => dir * ((x.year || 0) - (y.year || 0)) || y.plays - x.plays;

	if (kind === "artists") {
		const totals = new Map();
		for (const t of catalog.tracks.values()) {
			if (!trackOk(t)) continue;
			for (const a of t.artists) {
				if (a.id <= 1) continue;
				const v = totals.get(a) ?? { plays: 0, year: 0, first: 9999 };
				v.plays += t.plays;
				if (t.album.year) { v.year = Math.max(v.year, t.album.year); v.first = Math.min(v.first, t.album.year); }
				totals.set(a, v);
			}
		}
		const rows = [...totals].map(([artist, v]) => ({ artist, ...v }));
		if (sort === "newest") rows.sort((x, y) => y.year - x.year || y.plays - x.plays);
		else if (sort === "oldest") rows.sort((x, y) => x.first - y.first || y.plays - x.plays);
		else rows.sort((x, y) => y.plays - x.plays);
		return { total: rows.length, items: rows.slice(0, limit).map((r) => r.artist), plays: new Map(rows.map((r) => [r.artist, r.plays])) };
	}
	if (kind === "albums") {
		let list = [...catalog.albums.values()].filter((al) => albumOk(al)
			&& (!by || al.artists.includes(by))
			&& (!tokens.length || hasAll(al.search, tokens)));
		if (sort !== "plays") list = list.filter((al) => al.year);
		list.sort(sort === "newest" ? byYear(-1) : sort === "oldest" ? byYear(1) : (x, y) => y.plays - x.plays);
		return { total: list.length, items: list.slice(0, limit) };
	}
	let list = [...catalog.tracks.values()].filter(trackOk);
	if (sort !== "plays") list = list.filter((t) => t.album.year);
	const yearOf = (t) => t.album.year || 0;
	list.sort(sort === "newest" ? (x, y) => yearOf(y) - yearOf(x) || y.plays - x.plays
		: sort === "oldest" ? (x, y) => yearOf(x) - yearOf(y) || y.plays - x.plays
		: (x, y) => y.plays - x.plays);
	return { total: list.length, items: list.slice(0, limit) };
}

/**
 * Plain-language title for an intent, e.g. "Most played Mizo gospel albums
 * from the 1990s". `langName` turns a language record into its label.
 */
export function describe(intent, langName = (l) => l.name) {
	const { kind, sort, lang, genre, years, by, text } = intent;
	const head = { plays: "Most played", newest: "Newest", oldest: "Oldest" }[sort];
	const noun = { artists: "artists", albums: "albums", tracks: "songs" }[kind];
	const parts = [head];
	if (lang) parts.push(langName(lang));
	if (genre) parts.push(genre.name.toLowerCase());
	parts.push(noun);
	if (by) parts.push(`by ${by.name}`);
	if (years) parts.push(years[0] === years[1] ? `from ${years[0]}` : `from the ${years[0]}s`);
	if (text) parts.push(`matching “${text}”`);
	return parts.join(" ");
}
