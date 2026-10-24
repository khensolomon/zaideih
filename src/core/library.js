/**
 * User library: likes, playlists and play history, persisted in IndexedDB.
 * Track references are global track ids, so they survive catalog updates.
 *
 * Likes and playlists also go to the signed-in account (core/sync.js):
 * every change is passed to `library.onChange` (set by the app), and what
 * other devices changed comes back through applyRemote(). Playlists carry
 * `uid` (the same on every device) and `version` (the server's, 0 before
 * the first sync). Play history stays on the device.
 */
import { db } from "./db.js";
import { emit } from "./store.js";

const HISTORY_LIMIT = 500;

const newUid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const playlistChange = (row, deleted = false) => ({ kind: "playlist", uid: row.uid, name: row.name, tracks: deleted ? [] : [...row.tracks], deleted, at: row.updated, base: row.version ?? 0 });

export const library = {
	likes: new Set(),
	playlists: [],
	/** Set by the app: each change of likes or playlists, for syncing (core/sync.js). */
	onChange: null,

	async init() {
		const [likes, playlists] = await Promise.all([db.keys("likes"), db.all("playlists")]);
		this.likes = new Set(likes);
		// Playlists from before syncing get their lasting id now.
		for (const p of playlists) {
			if (!p.uid) { p.uid = newUid(); p.version = 0; await db.put("playlists", p); }
		}
		this.playlists = playlists.sort((a, b) => b.updated - a.updated);
		emit("library");
	},

	changed(change) {
		this.onChange?.(change);
	},

	isLiked: (id) => library.likes.has(id),

	async toggleLike(id) {
		const at = Date.now();
		if (this.likes.has(id)) {
			await db.delete("likes", id);
			this.likes.delete(id);
		} else {
			await db.put("likes", { id, at });
			this.likes.add(id);
		}
		emit("library");
		this.changed({ kind: "like", track: id, liked: this.likes.has(id), at });
		return this.likes.has(id);
	},

	async likedIds() {
		const rows = await db.all("likes");
		return rows.sort((a, b) => b.at - a.at).map((r) => r.id);
	},

	async createPlaylist(name, tracks = []) {
		const clean = name.trim();
		if (!clean) throw new Error("A playlist needs a name.");
		const now = Date.now();
		const row = { name: clean, tracks: [...tracks], created: now, updated: now, uid: newUid(), version: 0 };
		row.id = await db.put("playlists", row);
		this.playlists.unshift(row);
		emit("library");
		this.changed(playlistChange(row));
		return row;
	},

	playlist(id) {
		return this.playlists.find((p) => p.id === id);
	},

	async savePlaylist(row) {
		row.updated = Date.now();
		await db.put("playlists", row);
		this.playlists.sort((a, b) => b.updated - a.updated);
		emit("library");
		this.changed(playlistChange(row));
	},

	async addToPlaylist(id, trackIds) {
		const row = this.playlist(id);
		if (!row) throw new Error("That playlist no longer exists.");
		const present = new Set(row.tracks);
		const added = trackIds.filter((t) => !present.has(t));
		row.tracks.push(...added);
		await this.savePlaylist(row);
		return added.length;
	},

	async removeFromPlaylist(id, trackId) {
		const row = this.playlist(id);
		if (!row) throw new Error("That playlist no longer exists.");
		row.tracks = row.tracks.filter((t) => t !== trackId);
		await this.savePlaylist(row);
	},

	async renamePlaylist(id, name) {
		const clean = name.trim();
		if (!clean) throw new Error("A playlist needs a name.");
		const row = this.playlist(id);
		row.name = clean;
		await this.savePlaylist(row);
	},

	async deletePlaylist(id) {
		const row = this.playlist(id);
		await db.delete("playlists", id);
		this.playlists = this.playlists.filter((p) => p.id !== id);
		emit("library");
		if (row) this.changed(playlistChange({ ...row, updated: Date.now() }, true));
	},

	/** For the first sync of an account on this device: everything liked, and every playlist. */
	async snapshot() {
		const likes = await db.all("likes");
		return { likes: likes.map((l) => ({ id: l.id, at: l.at })), playlists: this.playlists.map((p) => ({ uid: p.uid, name: p.name, tracks: [...p.tracks], updated: p.updated, version: p.version ?? 0 })) };
	},

	/**
	 * What other devices changed (core/sync.js), written here; songs and
	 * playlists with a change of this device still waiting (`pending` keys
	 * "like:<id>", "playlist:<uid>") keep it. Answers whether anything changed.
	 */
	async applyRemote({ likes = [], playlists = [] }, pending = new Set()) {
		let changed = false;
		for (const l of likes) {
			if (pending.has(`like:${l.track}`)) continue;
			if (l.liked && !this.likes.has(l.track)) {
				await db.put("likes", { id: l.track, at: l.at });
				this.likes.add(l.track);
				changed = true;
			} else if (!l.liked && this.likes.has(l.track)) {
				await db.delete("likes", l.track);
				this.likes.delete(l.track);
				changed = true;
			}
		}
		for (const p of playlists) {
			if (pending.has(`playlist:${p.uid}`)) continue;
			const row = this.playlists.find((x) => x.uid === p.uid);
			if (p.deleted) {
				if (row) {
					await db.delete("playlists", row.id);
					this.playlists = this.playlists.filter((x) => x !== row);
					changed = true;
				}
			} else if (row) {
				const same = row.version === p.version && row.name === p.name && row.tracks.length === p.tracks.length && row.tracks.every((t, i) => t === p.tracks[i]);
				if (!same) {
					Object.assign(row, { name: p.name, tracks: [...p.tracks], updated: p.at, version: p.version });
					await db.put("playlists", row);
					changed = true;
				}
			} else {
				const fresh = { name: p.name, tracks: [...p.tracks], created: p.at, updated: p.at, uid: p.uid, version: p.version };
				fresh.id = await db.put("playlists", fresh);
				this.playlists.push(fresh);
				changed = true;
			}
		}
		if (changed) {
			this.playlists.sort((a, b) => b.updated - a.updated);
			emit("library");
		}
		return changed;
	},

	async recordPlay(trackId) {
		await db.put("history", { track: trackId, at: Date.now() });
		emit("history");
	},

	/** Distinct recently played track ids, newest first. */
	async recent(limit = 30) {
		const rows = await db.recentHistory(HISTORY_LIMIT);
		const seen = new Set();
		for (const r of rows) {
			seen.add(r.track);
			if (seen.size >= limit) break;
		}
		return [...seen];
	},

	async clearHistory() {
		await db.clear("history");
		emit("history");
	},

	/** Portable backup of everything except downloaded audio. */
	async exportData() {
		const [likes, playlists, history] = await Promise.all([db.all("likes"), db.all("playlists"), db.all("history")]);
		return { app: "zaideih", kind: "library", version: 1, exported: new Date().toISOString(), likes, playlists, history };
	},

	async importData(data) {
		if (data?.app !== "zaideih" || data.kind !== "library" || data.version !== 1) {
			throw new Error("This file is not a Zaideih library backup.");
		}
		for (const l of data.likes ?? []) {
			await db.put("likes", { id: l.id, at: l.at });
			this.changed({ kind: "like", track: l.id, liked: true, at: l.at });
		}
		for (const p of data.playlists ?? []) {
			// A restored playlist is a new one here (its own lasting id), so it never overwrites one of the account's.
			const row = { name: p.name, tracks: p.tracks, created: p.created, updated: p.updated, uid: newUid(), version: 0 };
			await db.put("playlists", row);
			this.changed(playlistChange(row));
		}
		for (const h of data.history ?? []) await db.put("history", { track: h.track, at: h.at });
		await this.init();
		emit("history");
	},
};
