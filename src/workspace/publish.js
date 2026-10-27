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
 *   - a media.json row: the files under music/<language>/<album>/, or,
 *     when every song was added from storage and they share one folder,
 *     that folder, "in place" (src/core/media-keys.js): nothing is copied.
 *
 * The audio Worker copies each upload to its key (POST
 * /library/requests/<id>/approve) before the pull request is opened; a
 * second attempt keeps the same album id, track ids and keys
 * (`assigned`), since the files are already in place.
 */
import { CATALOG_ROOT, folderProblem, inPlaceFolder } from "../core/media-keys.js";
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

/** The folder a key is in ("" at the top of the bucket). */
const dirOf = (key) => key.slice(0, Math.max(0, key.lastIndexOf("/")));

/**
 * Where an album's songs go: { inPlace: true, folder: "/<their folder>" }
 * when every song was added from storage, all in one folder that media.json
 * can name and no catalog album uses yet; otherwise { inPlace: false, why }
 * (why they are copied, or "" for uploads).
 */
export function placeOf(songs, media) {
	const keys = songs.map((u) => u.storageKey ?? null);
	if (!keys.length || keys.some((k) => !k)) return { inPlace: false, why: keys.some((k) => k) ? "some of its songs were uploaded, so all are copied into the catalog's folder" : "" };
	const dirs = new Set(keys.map(dirOf));
	if (dirs.size > 1) return { inPlace: false, why: `its songs are in ${dirs.size} folders in storage, so they are copied into one catalog folder` };
	const [dir] = dirs;
	if (!keys.every((k) => /\.mp3$/i.test(k))) return { inPlace: false, why: "not every file is an .mp3" };
	const folder = dir ? inPlaceFolder(dir) : null;
	const problem = folder ? folderProblem(folder) : "a file at the top of the bucket has no folder";
	if (problem) return { inPlace: false, why: `${problem}, so they are copied` };
	if (media.albums.some((row) => row[1] === folder)) return { inPlace: false, why: `${dir}/ is already a catalog album's folder, so they are copied` };
	return { inPlace: true, folder, dir };
}

/**
 * @param data      { albums, artists, media, category } as parsed from the files
 * @param request   the request from GET /library/requests, with its songs
 * @param form      { title, year, lang, genres: [ids], songs: [{ upload, title, artists: "A, B" }] }
 * @param options   { reserved: Set of track ids taken by other approved requests, assigned: { album, tracks } from an earlier attempt, ui: () => string }
 * @returns { albums, artists, media, approve: { album, tracks: [{upload, track, key}] }, place, lines, newArtists }
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

	const place = placeOf(songs, data.media);
	const folder = place.inPlace ? place.folder : `${segment(lang.name)}/${segment(title)}`;
	if (!assigned && !place.inPlace && data.media.albums.some((row) => row[1] === folder)) throw new DraftError(`music/${folder}/ is already an album's folder; change the title a little (a year, a volume) to keep them apart`);

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
		} else if (place.inPlace) {
			// Left where it is: its own file name, in its own folder.
			track = nextTrack++;
			key = u.storageKey;
			file = key.split("/").pop();
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
	// An earlier attempt's keys name the folder: under music/, or in place.
	const keyFolder = (key) => (key.startsWith(`${CATALOG_ROOT}/`) ? dirOf(key).slice(CATALOG_ROOT.length + 1) : inPlaceFolder(dirOf(key)));
	const mediaFolder = before ? keyFolder(tracks[0].key) : folder;
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
		place: before ? { inPlace: !tracks[0].key.startsWith(`${CATALOG_ROOT}/`), folder: mediaFolder } : place,
		lines,
		newArtists,
	};
}
