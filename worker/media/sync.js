/**
 * Liked songs and playlists on every device (docs/sync.md).
 *
 *   POST /library/sync {since, changes: [...]}, with the session
 *     -> {since, likes: [...], playlists: [...]}: the device's changes
 *        applied, then everything changed since `since` (its own included),
 *        and the server's copy of every song and playlist the request named.
 *
 * Changes:
 *   {kind: "like", track, liked, at}
 *       The most recent wins (`at`, the device's clock, milliseconds).
 *   {kind: "playlist", uid, name, tracks, deleted, at, base, offline}
 *       `base` is the version the device last saw. When it is the server's
 *       version, the change applies (version + 1). When another device has
 *       changed the playlist since, the server's copy wins, unless the change
 *       was made offline, where the most recent wins. A deleted playlist is
 *       kept as a mark (deleted, no songs) so every device removes it.
 *
 * Each request's writes are one D1 batch, a transaction: the member's counter
 * (library_sync.seq) goes up by one and every row written takes the new
 * value, so "changed since" never misses a row written by another device at
 * the same moment. A request carries at most MAX_CHANGES changes, which keeps
 * the batch small (one batch is one query, whatever its size); the app sends more in turn.
 */
import { MemberError } from "./members.js";

export const MAX_CHANGES = 25;
const MAX_TRACKS = 5000;
const MAX_NAME = 200;
const FUTURE_MS = 24 * 3600_000;

const trackOk = (t) => (Number.isSafeInteger(t) && t > 0) || (typeof t === "string" && /^u\d{1,12}$/.test(t));
// Catalog ids are numbers; uploads' are "u<id>". Stored as text, given back as they came.
const trackOut = (t) => (/^\d+$/.test(t) ? Number(t) : t);

function check(change, nowMs) {
	if (!change || typeof change !== "object") throw new MemberError("each change must be an object");
	if (!Number.isFinite(change.at) || change.at <= 0 || change.at > nowMs + FUTURE_MS) throw new MemberError("at must be the time of the change, in milliseconds");
	if (change.kind === "like") {
		if (!trackOk(change.track)) throw new MemberError(`not a song: ${JSON.stringify(change.track)}`);
		if (typeof change.liked !== "boolean") throw new MemberError("liked must be true or false");
		return change;
	}
	if (change.kind === "playlist") {
		if (typeof change.uid !== "string" || !/^[0-9a-f]{16}$/.test(change.uid)) throw new MemberError("uid must be 16 hex characters");
		if (typeof change.deleted !== "boolean") throw new MemberError("deleted must be true or false");
		if (!Number.isSafeInteger(change.base) || change.base < 0) throw new MemberError("base must be the version last seen (0 for a new playlist)");
		const name = typeof change.name === "string" ? change.name.normalize("NFC").replace(/\s+/g, " ").trim() : "";
		if (!change.deleted && (!name || name.length > MAX_NAME)) throw new MemberError(`a playlist needs a name of 1 to ${MAX_NAME} characters`);
		const tracks = change.deleted ? [] : change.tracks;
		if (!Array.isArray(tracks) || tracks.length > MAX_TRACKS || !tracks.every(trackOk)) throw new MemberError(`tracks must be at most ${MAX_TRACKS} songs`);
		return { ...change, name, tracks, offline: change.offline === true };
	}
	throw new MemberError(`unknown change kind ${JSON.stringify(change.kind)}`);
}

export async function handleSync(env, memberId, body, nowMs) {
	const since = body.since ?? 0;
	if (!Number.isSafeInteger(since) || since < 0) throw new MemberError("since must be the counter from the last sync (0 at first)");
	const changes = body.changes ?? [];
	if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new MemberError(`changes must be a list of at most ${MAX_CHANGES}`);
	const checked = changes.map((c) => check(c, nowMs));
	if (checked.length) {
		const seq = "(SELECT seq FROM library_sync WHERE member_id = ?1)";
		await env.DB.batch([
			env.DB.prepare("INSERT INTO library_sync (member_id, seq) VALUES (?1, 1) ON CONFLICT (member_id) DO UPDATE SET seq = seq + 1").bind(memberId),
			...checked.map((c) => (c.kind === "like"
				? env.DB.prepare(
					`INSERT INTO library_likes (member_id, track, liked, at, seq) VALUES (?1, ?2, ?3, ?4, ${seq})
					ON CONFLICT (member_id, track) DO UPDATE SET liked = excluded.liked, at = excluded.at, seq = excluded.seq
					WHERE excluded.at >= library_likes.at`,
				).bind(memberId, String(c.track), c.liked ? 1 : 0, Math.round(c.at))
				: env.DB.prepare(
					`INSERT INTO library_playlists (member_id, uid, name, tracks, deleted, at, version, seq) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ${seq})
					ON CONFLICT (member_id, uid) DO UPDATE SET name = excluded.name, tracks = excluded.tracks, deleted = excluded.deleted,
						at = excluded.at, version = library_playlists.version + 1, seq = excluded.seq
					WHERE library_playlists.version = ?7 OR (?8 = 1 AND excluded.at > library_playlists.at)`,
				).bind(memberId, c.uid, c.name, JSON.stringify(c.tracks.map(String)), c.deleted ? 1 : 0, Math.round(c.at), c.base, c.offline ? 1 : 0))),
		]);
	}
	const now = (await env.DB.prepare("SELECT seq FROM library_sync WHERE member_id = ?1").bind(memberId).first())?.seq ?? 0;
	// Everything changed since, and the rows this request touched: a change that lost
	// (the server's copy won) left its row as it was, and the device needs that copy.
	const touchedLikes = JSON.stringify(checked.filter((c) => c.kind === "like").map((c) => String(c.track)));
	const touchedPlaylists = JSON.stringify(checked.filter((c) => c.kind === "playlist").map((c) => c.uid));
	const likes = (await env.DB.prepare("SELECT track, liked, at FROM library_likes WHERE member_id = ?1 AND (seq > ?2 OR track IN (SELECT value FROM json_each(?3)))").bind(memberId, since, touchedLikes).all()).results ?? [];
	const playlists = (await env.DB.prepare("SELECT uid, name, tracks, deleted, at, version FROM library_playlists WHERE member_id = ?1 AND (seq > ?2 OR uid IN (SELECT value FROM json_each(?3)))").bind(memberId, since, touchedPlaylists).all()).results ?? [];
	return {
		since: now,
		likes: likes.map((r) => ({ track: trackOut(r.track), liked: r.liked === 1, at: r.at })),
		playlists: playlists.map((r) => ({ uid: r.uid, name: r.name, tracks: JSON.parse(r.tracks).map(trackOut), deleted: r.deleted === 1, at: r.at, version: r.version })),
	};
}
