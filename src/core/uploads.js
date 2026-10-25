/**
 * The signed-in person's own uploads (docs/library.md), from the audio
 * Worker's /library routes.
 *
 * Uploads join the app as songs and albums outside the public catalog
 * (catalog.extra, see core/catalog.js): ids "u<id>" for songs and
 * "u-album-<n>" for albums grouped by their album name, so the player, the
 * album page, the queue, likes and downloads work as for catalog songs,
 * while lists, search, counts and play totals never include them. Each
 * song carries its signed streaming address (`url`), renewed every
 * REFRESH_MS while the app is open.
 *
 * State changes are announced on the "uploads" topic (core/store.js).
 */
import { LIBRARY_URL } from "../config.js";
import { AccountError } from "./account.js";
import { account } from "./signin.js";
import { emit } from "./store.js";
import { checkFile, detailsFromName, formatOf, FORMATS, UploadRuleError } from "./upload-rules.js";
import { readTags, TAG_BYTES } from "./tags.js";
import { compact, normalize } from "./text.js";

const REFRESH_MS = 4 * 3600_000;
const LENGTH_TIMEOUT_MS = 15_000;

export class UploadError extends Error {}


async function call(method, path, body) {
	let res;
	try {
		res = await account().send((token) => fetch(`${LIBRARY_URL}${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
			body: body ? JSON.stringify(body) : undefined,
			cache: "no-store",
		}));
	} catch (err) {
		if (err instanceof UploadError) throw err;
		if (err instanceof AccountError) throw new UploadError(err.message);
		throw new UploadError(`the library could not be reached (${err.message})`);
	}
	if (res.status === 204) return null;
	const answer = await res.json().catch(() => null);
	if (!res.ok) throw new UploadError(answer?.error ?? `the library answered HTTP ${res.status}`);
	return answer;
}

/* ------------------------------------------------------- catalog joins ---- */

const UPLOADS_LANG = Object.freeze({ id: 0, name: "uploads", albums: [] });

/** Songs and albums for the app from the Worker's list (pure apart from ids). */
export function shapeUploads(list, requests = []) {
	const albums = new Map();
	const artists = new Map();
	const artistOf = (name) => {
		const key = name || "Unknown artist";
		if (!artists.has(key)) artists.set(key, { id: `u-artist-${artists.size + 1}`, name: key, aka: "", type: 0, typeName: "", tracks: [], albums: new Set(), plays: 0, upload: true });
		return artists.get(key);
	};
	const tracks = [];
	for (const u of list) {
		const albumName = u.album || "Singles";
		if (!albums.has(albumName)) {
			albums.set(albumName, {
				id: `u-album-${albums.size + 1}`, title: albumName, lang: UPLOADS_LANG, year: null, genres: [],
				tracks: [], duration: 0, plays: 0, artists: [], search: normalize(albumName), searchCompact: compact(normalize(albumName)), upload: true,
				named: Boolean(u.album), request: null, publish: "private",
			});
		}
		const album = albums.get(albumName);
		const artist = artistOf(u.artist);
		const t = {
			id: `u${u.id}`, uploadId: u.id, title: u.title, album, n: 0, duration: u.duration, plays: 0, base: 0, recent: 0,
			artists: [artist], url: u.url, upload: true, format: u.format, size: u.size, year: u.year, track: u.track, fileName: u.fileName, status: u.status,
		};
		album.tracks.push(t);
		album.duration += u.duration;
		if (!album.artists.includes(artist)) album.artists.push(artist);
		if (u.year && (!album.year || u.year < album.year)) album.year = u.year;
		artist.tracks.push(t);
		artist.albums.add(album);
		tracks.push(t);
	}
	// Searched with "My music" on (core/search.js, withMine): uploads have no artist pages, so a
	// song or album is found by its title and by its artists' names.
	const searchable = (r, title, people) => {
		r.search = normalize([title, ...people.map((a) => a.name)].join(" "));
		r.searchCompact = compact(r.search);
	};
	for (const t of tracks) searchable(t, t.title, t.artists);
	for (const album of albums.values()) searchable(album, album.title, album.artists);
	for (const album of albums.values()) {
		// Where the album is in asking to publish (worker/media/requests.js): the furthest any of its songs got.
		const st = new Set(album.tracks.map((t) => t.status));
		album.publish = st.has("requested") ? "requested" : st.has("published") ? "published" : st.has("released") ? "released" : "private";
		album.tracks.sort((a, b) => (a.track ?? 999) - (b.track ?? 999) || a.title.localeCompare(b.title));
		album.tracks.forEach((t, i) => { t.n = i + 1; });
	}
	// The newest request for each album (requests come newest first).
	for (const q of requests) {
		const album = albums.get(q.album);
		if (album && !album.request) album.request = q;
	}
	return { tracks, albums: [...albums.values()].sort((a, b) => a.title.localeCompare(b.title)) };
}

/* -------------------------------------------------------------- state ---- */

export const uploads = {
	/** { member, space, list, albums, loading, error } */
	state: { member: null, space: null, list: [], albums: [], requests: [], loading: false, error: "" },
	catalog: null,
	timer: 0,

	/** True when this build has personal libraries and someone is signed in. */
	get available() {
		return Boolean(LIBRARY_URL) && account().signedIn;
	},

	/** Connects to the app's catalog and reads the library when someone is signed in. */
	start(catalog) {
		this.catalog = catalog;
		if (this.available) this.refresh().catch(() => {});
	},

	/** Reads the library again: new signed addresses, and any change made elsewhere. */
	async refresh() {
		clearTimeout(this.timer);
		if (!this.available) { this.clear(); return; }
		this.state.loading = true;
		emit("uploads", this.state);
		try {
			const lib = await call("GET", "");
			const { tracks, albums } = shapeUploads(lib.uploads, lib.requests ?? []);
			const extra = this.catalog.extra;
			extra.tracks.clear();
			extra.albums.clear();
			for (const t of tracks) extra.tracks.set(t.id, t);
			for (const a of albums) extra.albums.set(a.id, a);
			Object.assign(this.state, { member: lib.member, space: lib.space, list: lib.uploads, albums, requests: lib.requests ?? [], error: "" });
			this.timer = setTimeout(() => this.refresh().catch(() => {}), REFRESH_MS);
		} catch (err) {
			this.state.error = err.message;
			throw err;
		} finally {
			this.state.loading = false;
			emit("uploads", this.state);
		}
	},

	clear() {
		clearTimeout(this.timer);
		this.catalog?.extra.tracks.clear();
		this.catalog?.extra.albums.clear();
		Object.assign(this.state, { member: null, space: null, list: [], albums: [], requests: [], error: "" });
		emit("uploads", this.state);
	},

	/** Space left for new files, in bytes (Infinity for the owner). */
	spaceLeft() {
		const s = this.state.space;
		return !s || s.quota === null ? Infinity : Math.max(0, s.quota - s.used);
	},

	async edit(uploadId, details) {
		await call("PATCH", `/uploads/${uploadId}`, details);
		await this.refresh();
	},

	/** A folder of storage (private/…): { root, prefix, folders, files, others, cursor }. Needs the Storage right. */
	browse(prefix = "", cursor = "") {
		const q = new URLSearchParams();
		if (prefix) q.set("prefix", prefix);
		if (cursor) q.set("cursor", cursor);
		return call("GET", `/storage${q.size ? `?${q}` : ""}`);
	},

	/** Adds prepared files from storage (see prepareStored()) to the library, all or none. */
	async addFromStorage(items) {
		const answer = await call("POST", "/storage/add", {
			items: items.map((r) => ({ key: r.key, title: r.title, artist: r.artist, album: r.album, year: r.year, track: r.track, duration: r.duration })),
		});
		await this.refresh();
		return answer;
	},

	/** True for the owner and those with Review publishing: publishing their own album is one step. */
	get canReview() {
		const m = this.state.member;
		return Boolean(m && (m.role === "owner" || m.rights?.includes("manage") || m.rights?.includes("review")));
	},

	/** True for the owner, co-owners and the Lyrics right: hiding, showing and restoring lyrics (docs/lyrics.md). */
	get canLyrics() {
		const m = this.state.member;
		return Boolean(m && (m.role === "owner" || m.rights?.includes("manage") || m.rights?.includes("lyrics")));
	},

	/** True for the owner, co-owners and the Songbooks right: songbooks, private ones too (docs/songbooks.md). */
	get canSongbooks() {
		const m = this.state.member;
		return Boolean(m && (m.role === "owner" || m.rights?.includes("manage") || m.rights?.includes("songbooks")));
	},

	/** Asks to publish an album of one's uploads: { lang, note } (a reviewer may leave out the language). Answers { id, songs }. */
	async askPublish(albumTitle, { lang, note = "" } = {}) {
		const answer = await call("POST", "/requests", { album: albumTitle, ...(lang ? { lang: Number(lang) } : {}), note });
		await this.refresh();
		return answer;
	},

	async withdrawPublish(requestId) {
		await call("DELETE", `/requests/${requestId}`);
		await this.refresh();
	},

	/** Where this person may add files from storage, or null (core/library rights). */
	get storageRoot() {
		return this.state.member?.storageRoot ?? null;
	},

	async remove(uploadId) {
		await call("DELETE", `/uploads/${uploadId}`);
		await this.refresh();
	},

	/**
	 * Uploads one prepared file (see prepare()): announces it, then sends
	 * it, reporting progress (0 to 1). Answers the stored upload.
	 */
	async send(item, onProgress = () => {}) {
		const made = await call("POST", "/uploads", {
			fileName: item.file.name, size: item.file.size, format: item.format, duration: item.duration,
			title: item.title, artist: item.artist, album: item.album, year: item.year, track: item.track,
		});
		const token = await account().token();
		const base = new URL(LIBRARY_URL).origin;
		return new Promise((resolve, reject) => {
			// XMLHttpRequest, because fetch() reports no upload progress.
			const xhr = new XMLHttpRequest();
			xhr.open("PUT", `${base}${made.upload}`);
			xhr.setRequestHeader("Authorization", `Bearer ${token}`);
			xhr.setRequestHeader("Content-Type", FORMATS[item.format].type);
			xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
			xhr.onload = () => {
				let answer = null;
				try { answer = JSON.parse(xhr.responseText); } catch { /* below */ }
				if (xhr.status >= 200 && xhr.status < 300) resolve(answer);
				else reject(new UploadError(answer?.error ?? `the upload failed: HTTP ${xhr.status}`));
			};
			xhr.onerror = () => reject(new UploadError("the connection was lost during the upload; try again"));
			xhr.send(item.file);
		});
	},
};

/* ----------------------------------------------------------- preparing ---- */

/** The length of an audio file (a File, or an address) in seconds, read by the browser; rejects when it cannot play it. */
function lengthOf(source) {
	return new Promise((resolve, reject) => {
		const audio = new Audio();
		const local = typeof source !== "string";
		const url = local ? URL.createObjectURL(source) : source;
		const done = (fn, v) => { clearTimeout(timer); if (local) URL.revokeObjectURL(url); audio.removeAttribute("src"); fn(v); };
		const timer = setTimeout(() => done(reject, new Error("timeout")), LENGTH_TIMEOUT_MS);
		audio.preload = "metadata";
		audio.onloadedmetadata = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? done(resolve, audio.duration) : done(reject, new Error("no length")));
		audio.onerror = () => done(reject, new Error("unreadable"));
		audio.src = url;
	});
}

/**
 * Reads chosen files before anything is sent: format, size against the
 * limits, length and tags. Answers one item per file:
 * { file, format, duration, title, artist, album, year, track, error }.
 */
export async function prepare(files, { maxBytes, spaceLeft }) {
	const out = [];
	let left = spaceLeft;
	for (const file of files) {
		// From a chosen folder, the album defaults to the folder the file is in.
		const folder = (file.webkitRelativePath ?? "").split("/").slice(-2, -1)[0] ?? "";
		const item = { file, name: file.name, size: file.size, format: formatOf(file.name), duration: 0, ...detailsFromName(file.name), album: folder, year: null, error: "" };
		try {
			checkFile({ fileName: file.name, format: item.format, size: file.size }, { maxBytes, spaceLeft: left });
			try {
				item.duration = await lengthOf(file);
			} catch {
				throw new UploadRuleError(`"${file.name}" has no readable length; it may not be audio, or it is damaged`);
			}
			const tags = readTags(new Uint8Array(await file.slice(0, TAG_BYTES).arrayBuffer()));
			Object.assign(item, Object.fromEntries(Object.entries(tags).filter(([, v]) => v)));
			left -= file.size;
		} catch (err) {
			item.error = err instanceof UploadRuleError ? err.message : `"${file.name}" could not be read (${err.message})`;
		}
		out.push(item);
	}
	return out;
}

/**
 * Reads files already in storage (from browse()) the same way: length from
 * the audio element and tags from the file's first bytes, through their
 * signed addresses; the album defaults to the folder's name. Nothing is
 * checked against space: these files were not uploaded and use none.
 */
export async function prepareStored(files, folderName = "") {
	const out = [];
	for (const f of files) {
		const item = { remote: true, key: f.key, url: f.url, name: f.name, size: f.size, format: f.format, duration: 0, ...detailsFromName(f.name), album: folderName, year: null, error: "" };
		try {
			try {
				item.duration = await lengthOf(f.url);
			} catch {
				throw new UploadRuleError(`"${f.name}" has no readable length; it may not be audio, or it is damaged`);
			}
			const res = await fetch(f.url, { headers: { Range: `bytes=0-${TAG_BYTES - 1}` }, cache: "no-store" });
			if (!res.ok) throw new UploadRuleError(`"${f.name}" could not be read: HTTP ${res.status}`);
			const tags = readTags(new Uint8Array(await res.arrayBuffer()));
			Object.assign(item, Object.fromEntries(Object.entries(tags).filter(([, v]) => v)));
		} catch (err) {
			item.error = err instanceof UploadRuleError ? err.message : `"${f.name}" could not be read (${err.message})`;
		}
		out.push(item);
	}
	return out;
}
