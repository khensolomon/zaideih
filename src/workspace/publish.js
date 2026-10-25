/**
 * Publishing a member's album (docs/library.md, "Asking to publish"): the
 * catalog changes for one approved request, built from the newest
 * albums.json, artist.name.json and media.json.
 *
 *   - a new album (a random 16-hex id) with the reviewer's title, year,
 *     language and genres;
 *   - one song per upload, with new track ids after the highest in use
 *     (the catalog's, and those other approved requests have taken);
 *   - artists matched by name, or added (type Unknown) when new;
 *   - a media.json row: the files under music/<language>/<album>/.
 *
 * The audio Worker copies each upload to its key (POST
 * /library/requests/<id>/approve) before the pull request is opened; a
 * second attempt keeps the same album id, track ids and keys
 * (`assigned`), since the files are already in place.
 */
import { normalize } from "../core/text.js";
import { DraftError } from "./draft.js";

const HEX = "0123456789abcdef";

/** A path segment from a title: no slashes, no dot-only names, single spaces. */
export function segment(text) {
	const s = String(text ?? "").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
	if (!s) throw new DraftError(`"${text}" cannot be used as a folder or file name`);
	return s;
}

const randomUi = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => HEX[b % 16]).join("");

/**
 * @param data      { albums, artists, media, category } as parsed from the files
 * @param request   the request from GET /library/requests, with its songs
 * @param form      { title, year, lang, genres: [ids], songs: [{ upload, title, artists: "A, B" }] }
 * @param options   { reserved: Set of track ids taken by other approved requests, assigned: { album, tracks } from an earlier attempt, ui: () => string }
 * @returns { albums, artists, media, approve: { album, tracks: [{upload, track, key}] }, lines, newArtists }
 */
export function buildPublish(data, request, form, { reserved = new Set(), assigned = null, ui = randomUi } = {}) {
	const title = String(form.title ?? "").trim();
	if (!title) throw new DraftError("the album needs a title");
	const lang = data.category.lang.find((l) => l.id === Number(form.lang));
	if (!lang || lang.id === 0) throw new DraftError("choose the album's language");
	const year = form.year === "" || form.year === null || form.year === undefined ? null : Number(form.year);
	if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) throw new DraftError("the year must be from 1900 to 2100, or empty");
	const genres = (form.genres ?? []).map(Number);
	for (const g of genres) if (!data.category.genre.some((x) => x.id === g)) throw new DraftError(`unknown genre ${g}`);
	const songs = request.songs ?? [];
	if (!songs.length) throw new DraftError("the request has no songs");
	const typed = new Map((form.songs ?? []).map((s) => [Number(s.upload), s]));

	// Ids: the album's, kept from an earlier attempt or new; tracks after the highest in use.
	const used = new Set(data.albums.map((a) => a.ui));
	let albumId = assigned?.album;
	if (!albumId) do albumId = ui(); while (used.has(albumId));
	else if (used.has(albumId)) throw new DraftError(`album ${albumId} is already in the catalog; this request may have been published already`);
	let nextTrack = Math.max(0, ...data.albums.flatMap((a) => a.tk.map((t) => t.i)), ...reserved) + 1;
	let nextArtist = Math.max(0, ...data.artists.map((a) => a.id)) + 1;
	const before = assigned ? new Map(assigned.tracks.map((t) => [t.upload, t])) : null;

	const folder = `${segment(lang.name)}/${segment(title)}`;
	if (!assigned && data.media.albums.some((row) => row[1] === folder)) throw new DraftError(`music/${folder}/ is already an album's folder; change the title a little (a year, a volume) to keep them apart`);

	const artists = [...data.artists];
	const newArtists = [];
	const artistIds = (names) => names.split(",").map((n) => n.trim()).filter(Boolean).map((n) => {
		const hit = artists.find((a) => a.name === n) ?? artists.find((a) => normalize(a.name) === normalize(n));
		if (hit) return hit.id;
		const made = { name: n.normalize("NFC"), correction: [], thesaurus: [], type: 0, id: nextArtist++ };
		artists.push(made);
		newArtists.push(made);
		return made.id;
	}).filter((id, i, all) => all.indexOf(id) === i);

	const files = new Set();
	const tk = [];
	const rows = [];
	const tracks = [];
	for (const u of songs) {
		const f = typed.get(u.upload) ?? {};
		const t = String(f.title ?? u.title ?? "").trim();
		if (!t) throw new DraftError(`song ${u.fileName} needs a title`);
		const a = artistIds(String(f.artists ?? u.artist ?? ""));
		if (!a.length) throw new DraftError(`"${t}" needs an artist (a new name is added to the catalog)`);
		let track, key, file;
		if (before) {
			const was = before.get(u.upload);
			if (!was) throw new DraftError(`song ${u.fileName} was not in the earlier attempt`);
			track = was.track; key = was.key; file = key.split("/").pop();
		} else {
			track = nextTrack++;
			const base = segment(u.fileName.replace(/\.mp3$/i, ""));
			file = `${base}.mp3`;
			for (let n = 2; files.has(file.toLowerCase()); n++) file = `${base} (${n}).mp3`;
			key = `${data.media.root}/${folder}/${file}`;
		}
		files.add(file.toLowerCase());
		tk.push({ t, a, d: Math.round(u.duration ?? 0), p: 0, i: track });
		rows.push([track, file]);
		tracks.push({ upload: u.upload, track, key });
	}
	const mediaFolder = before ? tracks[0].key.slice(data.media.root.length + 1, tracks[0].key.lastIndexOf("/")) : folder;
	const album = { ui: albumId, ab: title, gr: genres, yr: year === null ? [] : [year], lg: lang.id, tk };
	const lines = [
		`Published "${title}" (${tk.length} song${tk.length === 1 ? "" : "s"}, ${lang.name}${year ? `, ${year}` : ""}), from @${request.login}'s library`,
		...newArtists.map((a) => `New artist ${a.name} (#${a.id})`),
	];
	return {
		albums: [...data.albums, album],
		artists,
		media: { ...data.media, albums: [...data.media.albums, [albumId, mediaFolder, rows]] },
		approve: { album: albumId, tracks },
		lines,
		newArtists,
	};
}
