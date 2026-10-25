/**
 * Catalog health checks for the Workspace's Checks section: things worth a look
 * in the source data, each item opening its editor. Some checks come with a
 * fix that adds the corrections to the draft (spacing and Unicode form).
 * Pure: tested in Node (tests/workspace.test.mjs).
 */
import { normalize } from "../core/text.js";

const MAX_ITEMS = 200;

/** A title or name with stray spaces, or not in Unicode NFC form; returns the corrected text or null. */
export function tidyText(value) {
	if (typeof value !== "string") return null;
	const tidy = value.normalize("NFC").replace(/\s+/g, " ").trim();
	return tidy !== value ? tidy : null;
}

/**
 * Runs every check. Returns [{ id, title, help, items: [{ kind, id, open, label }], fixes? }],
 * where `open` names the editor ({kind: "album"|"artist", id}) and `fixes`
 * are draft changes ({kind, id, field, value}) that correct every item.
 */
export function healthChecks({ albums, artists }) {
	const out = [];
	const used = new Set();
	const songs = [];
	for (const al of albums) for (const t of al.tk) {
		songs.push({ al, t });
		for (const a of t.a) used.add(a);
	}
	const albumItem = (al, label) => ({ kind: "album", id: al.ui, open: { kind: "album", id: al.ui }, label });
	const songItem = ({ al, t }, label) => ({ kind: "track", id: t.i, open: { kind: "album", id: al.ui }, label });
	const artistItem = (a, label) => ({ kind: "artist", id: a.id, open: { kind: "artist", id: a.id }, label });
	const add = (id, title, help, items, fixes) => out.push({ id, title, help, items: items.slice(0, MAX_ITEMS), total: items.length, ...(fixes?.length ? { fixes } : {}) });

	// Text: stray spaces and non-NFC forms (Myanmar marks out of order), with a one-click fix.
	const textItems = [];
	const textFixes = [];
	for (const al of albums) {
		const v = tidyText(al.ab);
		if (v !== null) { textItems.push(albumItem(al, `Album "${al.ab}"`)); textFixes.push({ kind: "album", id: al.ui, field: "ab", value: v }); }
	}
	for (const s of songs) {
		const v = tidyText(s.t.t);
		if (v !== null) { textItems.push(songItem(s, `Song "${s.t.t}" (${s.al.ab})`)); textFixes.push({ kind: "track", id: s.t.i, field: "t", value: v }); }
	}
	for (const a of artists) {
		const v = tidyText(a.name);
		if (v !== null) { textItems.push(artistItem(a, `Artist "${a.name}"`)); textFixes.push({ kind: "artist", id: a.id, field: "name", value: v }); }
	}
	add("text", "Titles and names with stray spaces or an unusual Unicode form", "Extra or doubled spaces, or Myanmar marks stored in a non-standard order (the app corrects the order when it builds, but search tools and diffs see the difference).", textItems, textFixes);

	add("no-artist", "Songs without an artist", "Shown as \"Unknown artist\".", songs.filter((s) => !s.t.a.length && s.t.h !== true).map((s) => songItem(s, `${s.t.t} (${s.al.ab})`)));
	add("no-duration", "Songs with no length", "A length of 0 seconds usually means the file was never read; check that it plays.", songs.filter((s) => !s.t.d && s.t.h !== true).map((s) => songItem(s, `${s.t.t} (${s.al.ab})`)));
	add("no-year", "Albums without a year", "They sort last by year and are missing from year questions in search.", albums.filter((al) => !al.yr?.length).map((al) => albumItem(al, al.ab)));
	add("no-genre", "Albums without a genre", "They are missing from every genre page.", albums.filter((al) => !al.gr?.length).map((al) => albumItem(al, al.ab)));

	// Same name written the same way (ignoring case, accents and spaces) under two ids.
	const byName = new Map();
	for (const a of artists) {
		const key = normalize(a.name).replace(/ /g, "");
		if (!key) continue;
		if (!byName.has(key)) byName.set(key, []);
		byName.get(key).push(a);
	}
	const dupes = [...byName.values()].filter((list) => list.length > 1 && list.filter((a) => used.has(a.id)).length > 1);
	add("duplicate-artist", "Artists who may be listed twice", "The same name under more than one id, each with songs. Move the songs to one of them by editing their albums.", dupes.flatMap((list) => list.map((a) => artistItem(a, `${a.name} (#${a.id})`))));

	add("hidden", "Hidden songs", "Kept in the source but not shipped; open the album to show them again.", songs.filter((s) => s.t.h === true).map((s) => songItem(s, `${s.t.t} (${s.al.ab})`)));
	add("unused-artist", "Artists without songs", "Not shipped in the app.", artists.filter((a) => !used.has(a.id)).map((a) => artistItem(a, a.name)));
	return out;
}
