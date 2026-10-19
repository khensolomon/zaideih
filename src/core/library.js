/**
 * User library: likes, playlists and play history, persisted in IndexedDB.
 * Track references are global track ids, so they survive catalog updates.
 */
import { db } from "./db.js";
import { emit } from "./store.js";

const HISTORY_LIMIT = 500;

export const library = {
	likes: new Set(),
	playlists: [],

	async init() {
		const [likes, playlists] = await Promise.all([db.keys("likes"), db.all("playlists")]);
		this.likes = new Set(likes);
		this.playlists = playlists.sort((a, b) => b.updated - a.updated);
		emit("library");
	},

	isLiked: (id) => library.likes.has(id),

	async toggleLike(id) {
		if (this.likes.has(id)) {
			await db.delete("likes", id);
			this.likes.delete(id);
		} else {
			await db.put("likes", { id, at: Date.now() });
			this.likes.add(id);
		}
		emit("library");
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
		const row = { name: clean, tracks: [...tracks], created: now, updated: now };
		row.id = await db.put("playlists", row);
		this.playlists.unshift(row);
		emit("library");
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
		await db.delete("playlists", id);
		this.playlists = this.playlists.filter((p) => p.id !== id);
		emit("library");
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
		for (const l of data.likes ?? []) await db.put("likes", { id: l.id, at: l.at });
		for (const p of data.playlists ?? []) {
			await db.put("playlists", { name: p.name, tracks: p.tracks, created: p.created, updated: p.updated });
		}
		for (const h of data.history ?? []) await db.put("history", { track: h.track, at: h.at });
		await this.init();
		emit("history");
	},
};
