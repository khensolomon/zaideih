/**
 * Liked songs and playlists on every device (docs/sync.md): the device's
 * side of POST /library/sync (worker/media/sync.js).
 *
 * The device stays the first copy: every change is made locally as before,
 * and also put in an outbox (kept in IndexedDB), which is sent while signed
 * in and online: soon after a change, when the app opens or comes back into
 * view, when the connection returns, and every few minutes while open. Each
 * request sends up to MAX_CHANGES changes and brings back everything changed
 * on other devices since the last request (the server's counter, `since`).
 *
 * A change made offline (or one that could not be sent) is marked offline,
 * so the server lets the most recent change win; one made online wins only
 * if no other device changed the playlist meanwhile (the server's version).
 * Changes still waiting in the outbox are not overwritten by what comes back.
 *
 * The first sync of a signed-in account on this device sends all its liked
 * songs and playlists, so what was here joins the account. Signing out keeps
 * the device's library and stops syncing.
 *
 * Pure apart from what is injected: tested in Node (tests/sync-client.test.mjs).
 */
export const MAX_CHANGES = 25;
const SOON_MS = 1500;

/** One change per song and per playlist: the latest. */
export function collapse(outbox) {
	const out = new Map();
	for (const c of outbox) out.set(c.kind === "like" ? `like:${c.track}` : `playlist:${c.uid}`, c);
	return [...out.values()];
}

const keyOf = (c) => (c.kind === "like" ? `like:${c.track}` : `playlist:${c.uid}`);

/**
 * @param {object} deps
 * @param {() => Promise<{outbox: object[], since: number, member: number|null}>} deps.load   the sync state kept on the device
 * @param {(state: object) => Promise<void>} deps.save
 * @param {() => Promise<{likes: {id, at}[], playlists: object[]}>} deps.local   the device's library, for the first sync
 * @param {(remote: {likes, playlists}, pending: Set<string>) => Promise<boolean>} deps.apply   writes what came back; answers whether anything changed
 * @param {(body: object) => Promise<object>} deps.send   POST /library/sync
 * @param {() => Promise<number|null>} deps.member   the signed-in member's id, or null when signed out
 * @param {() => boolean} deps.online
 * @param {() => number} [deps.now]
 */
export function createSync({ load, save, local, apply, send, member, online, now = () => Date.now() }) {
	let running = null;
	let again = false;
	let timer = 0;
	let queue = Promise.resolve();
	// Writes to the kept state, one at a time (a change and a sync may come together), and
	// one tab at a time: two tabs reading and writing the outbox together would lose a change.
	const locked = (fn) => (globalThis.navigator?.locks ? globalThis.navigator.locks.request("zaideih.sync.state", fn) : fn());
	const withState = (fn) => (queue = queue.then(() => locked(async () => { const s = await load(); const out = await fn(s); await save(s); return out; })));

	const engine = {
		/** A change made on this device: kept, and sent soon. */
		note(change) {
			const c = { ...change, at: change.at ?? now(), offline: !online() };
			const done = withState((s) => { s.outbox = collapse([...s.outbox, c]); });
			engine.soon();
			return done;
		},

		soon(ms = SOON_MS) {
			clearTimeout(timer);
			timer = setTimeout(() => engine.run().catch(() => {}), ms);
		},

		/** Sends what waits and takes what changed elsewhere; one run at a time. Answers whether the library changed. */
		run() {
			if (running) { again = true; return running; }
			running = (async () => {
				let changed = false;
				do {
					again = false;
					changed = (await engine.once()) || changed;
				} while (again);
				return changed;
			})().finally(() => { running = null; });
			return running;
		},

		async once() {
			const id = online() ? await member() : null;
			if (id === null) {
				// Signed out: the device keeps its library; the next account to sign in starts afresh.
				const s = await load();
				if (s.member !== null) await withState((st) => { st.member = null; st.since = 0; st.outbox = []; });
				return false;
			}
			const first = await withState(async (s) => {
				if (s.member === id) return false;
				// First sync of this account here: what the device has joins the account.
				const mine = await local();
				s.member = id;
				s.since = 0;
				s.outbox = collapse([
					...mine.likes.map((l) => ({ kind: "like", track: l.id, liked: true, at: l.at, offline: true })),
					...mine.playlists.map((p) => ({ kind: "playlist", uid: p.uid, name: p.name, tracks: p.tracks, deleted: false, at: p.updated, base: p.version ?? 0, offline: true })),
					...s.outbox,
				]);
				return true;
			});
			let changed = false;
			let more = true;
			while (more) {
				const s = await load();
				const batch = s.outbox.slice(0, MAX_CHANGES);
				let answer;
				try {
					answer = await send({ since: s.since, changes: batch });
				} catch (err) {
					// Not sent: what waits is now an offline change (the most recent wins when it arrives).
					await withState((st) => { st.outbox = st.outbox.map((c) => ({ ...c, offline: true })); });
					throw err;
				}
				const pending = await withState((st) => {
					// The ones sent leave the outbox (the same key and moment); anything changed meanwhile stays (a newer moment).
					st.outbox = st.outbox.filter((c) => !batch.some((b) => b.at === c.at && keyOf(b) === keyOf(c)));
					st.since = answer.since;
					return new Set(st.outbox.map(keyOf));
				});
				changed = (await apply(answer, pending)) || changed;
				more = (await load()).outbox.length > 0;
			}
			return changed || first;
		},

		/** Forgets the sync state (signing out); the library stays. */
		forget() {
			clearTimeout(timer);
			return withState((s) => { s.member = null; s.since = 0; s.outbox = []; });
		},
	};
	return engine;
}
