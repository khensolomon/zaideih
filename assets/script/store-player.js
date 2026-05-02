import { defineStore } from "pinia";

/**
 * Player store — owns all playback and queue state.
 *
 * Click behaviour (track-row click):
 *   - Click the currently-playing track → toggle pause/resume.
 *   - Click any other track → play that track immediately. If it was
 *     already in the queue, we jump to it (keeping its queue position);
 *     if not, we add it to the end and play it.
 *
 * The queue order is preserved: when the current track ends, the next
 * track is the one after the current one's position in the queue,
 * regardless of which track the user jumped to.
 *
 * Loop:
 *   - When the last track ends and loop is on, playback wraps to the
 *     first track in the queue. Otherwise, playback stops at the end.
 *
 * Playback intent (`wantsToPlay`) vs. actual state (`playing`):
 *   `wantsToPlay` is the user's intent; `playing` is what the audio
 *   element is actually doing. We need both because there's a delay
 *   between "user clicked play" and "audio is ready to play." The
 *   `canplay` event in player.vue is what bridges them — see comments
 *   there for details.
 */

const VOLUME_KEY = "player.volume";

function loadVolume() {
	try {
		const raw = localStorage.getItem(VOLUME_KEY);
		const v = raw === null ? NaN : Number.parseFloat(raw);
		return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.4;
	} catch {
		return 0.4;
	}
}

export const usePlayerStore = defineStore("player", {
	state: () => ({
		queue: [],
		current: null,

		/** User's intent: should we be playing right now? */
		wantsToPlay: false,

		/** Audio element's actual state. */
		playing: false,

		loading: false,
		loop: false,
		shuffle: false,
		currentTime: 0,
		duration: 0,
		buffered: 0,
		volume: loadVolume(),
		volumeBeforeMute: 0.4,
		command: null,
		error: null,
	}),

	getters: {
		currentIndex: (state) =>
			state.current
				? state.queue.findIndex((t) => t.i === state.current.i)
				: -1,

		hasNext() {
			if (this.queue.length === 0) return false;
			if (this.loop) return true;
			return this.currentIndex < this.queue.length - 1;
		},

		hasPrevious() {
			if (this.queue.length === 0) return false;
			if (this.loop) return true;
			return this.currentIndex > 0;
		},

		isMuted: (state) => state.volume === 0,

		percentProgress: (state) =>
			state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0,

		percentBuffered: (state) => state.buffered * 100,

		queueCount: (state) => state.queue.length,

		isInQueue: (state) => (trackId) =>
			state.queue.some((t) => t.i === trackId),

		isCurrent: (state) => (trackId) => state.current?.i === trackId,

		hasActiveTrack: (state) => state.current != null,
	},

	actions: {
		// --- Queue management --------------------------------------------

		/** Append to the end of the queue. Idempotent. */
		addToQueue(track) {
			if (!track || track.i == null) return false;
			if (this.isInQueue(track.i)) return true;
			this.queue.push(track);
			return false;
		},

		/** Replace the entire queue. */
		setQueue(tracks) {
			this.queue = Array.isArray(tracks) ? tracks.slice() : [];
		},

		removeFromQueue(trackId) {
			const i = this.queue.findIndex((t) => t.i === trackId);
			if (i < 0) return;
			const wasCurrent = this.current?.i === trackId;
			this.queue.splice(i, 1);
			if (wasCurrent) {
				if (this.queue.length === 0) {
					this.stop();
				} else {
					// The next track shifted into position `i`, or wrap to 0.
					const nextIdx = i < this.queue.length ? i : 0;
					this.current = this.queue[nextIdx];
					this.wantsToPlay = true;
				}
			}
		},

		clearQueue() {
			this.queue = [];
			this.stop();
		},

		// --- Playback control --------------------------------------------

		/**
		 * Click handler for a track row.
		 *   - Same as current → toggle pause/resume.
		 *   - Different track → play it now (jumps to it in the queue,
		 *     or appends + plays if not yet queued).
		 */
		smartPlay(track) {
			if (!track || track.i == null) return;

			if (this.current?.i === track.i) {
				this.togglePlay();
				return;
			}

			this.playTrack(track);
		},

		/**
		 * Play a specific track now. If the track is already in the queue,
		 * jump to its existing position (preserving queue order). If not,
		 * append it to the end and play.
		 */
		playTrack(track) {
			if (!track || track.i == null) return;
			if (!this.isInQueue(track.i)) {
				this.queue.push(track);
			}
			this.current = track;
			this.wantsToPlay = true;
			this.error = null;
		},

		/**
		 * Replace the queue with `tracks` and start the first.
		 * Used by "Play album" / "Play artist" actions.
		 */
		playAll(tracks) {
			if (!tracks || tracks.length === 0) return;
			this.setQueue(tracks);
			this.current = tracks[0];
			this.wantsToPlay = true;
			this.error = null;
		},

		next() {
			if (this.queue.length === 0) {
				this.wantsToPlay = false;
				this.playing = false;
				return;
			}

			const idx = this.currentIndex;
			let nextIdx;

			if (idx < this.queue.length - 1) {
				nextIdx = idx + 1;
			} else if (this.loop) {
				// Wrap to first track.
				nextIdx = 0;
			} else {
				// End of queue, no loop — stop.
				this.wantsToPlay = false;
				this.playing = false;
				return;
			}

			this.current = this.queue[nextIdx];
			this.wantsToPlay = true;
			this.error = null;
		},

		previous() {
			if (this.queue.length === 0) return;

			// Common UX: more than 3s in → restart current track.
			if (this.currentTime > 3) {
				this.seek(0);
				return;
			}

			const idx = this.currentIndex;
			let prevIdx;

			if (idx > 0) {
				prevIdx = idx - 1;
			} else if (this.loop) {
				prevIdx = this.queue.length - 1;
			} else {
				this.seek(0);
				return;
			}

			this.current = this.queue[prevIdx];
			this.wantsToPlay = true;
			this.error = null;
		},

		togglePlay() {
			// Nothing loaded — start the first queued track if any.
			if (!this.current && this.queue.length > 0) {
				this.current = this.queue[0];
				this.wantsToPlay = true;
				return;
			}
			if (!this.current) return;
			this.wantsToPlay = !this.wantsToPlay;
		},

		toggleLoop() {
			this.loop = !this.loop;
		},

		toggleShuffle() {
			this.shuffle = !this.shuffle;
		},

		seek(seconds) {
			if (!Number.isFinite(seconds) || seconds < 0) return;
			this.command = { id: Date.now(), type: "seek", value: seconds };
		},

		seekPercent(percent) {
			if (!this.duration) return;
			this.seek((percent / 100) * this.duration);
		},

		stop() {
			this.wantsToPlay = false;
			this.playing = false;
			this.current = null;
			this.currentTime = 0;
			this.duration = 0;
			this.buffered = 0;
		},

		// --- Volume ------------------------------------------------------

		setVolume(v) {
			const clamped = Math.max(0, Math.min(1, Number(v) || 0));
			this.volume = clamped;
			try {
				localStorage.setItem(VOLUME_KEY, String(clamped));
			} catch {
				// localStorage may be unavailable; ignore.
			}
		},

		toggleMute() {
			if (this.volume === 0) {
				this.setVolume(this.volumeBeforeMute || 0.4);
			} else {
				this.volumeBeforeMute = this.volume;
				this.setVolume(0);
			}
		},

		// --- Audio element event handlers --------------------------------

		onLoadStart() {
			this.loading = true;
			this.error = null;
		},

		onCanPlay() {
			this.loading = false;
		},

		onPlay() {
			this.playing = true;
			this.wantsToPlay = true;
		},

		onPause() {
			this.playing = false;
			this.wantsToPlay = false;
		},

		onTimeUpdate(t) {
			this.currentTime = t;
		},

		onDurationChange(d) {
			this.duration = Number.isFinite(d) ? d : 0;
		},

		onProgress(fraction) {
			this.buffered = Math.max(0, Math.min(1, fraction));
		},

		onEnded() {
			// Browser handles loop on the same track via the audio element's
			// `loop` attribute, so we only get `ended` when transitioning.
			this.next();
		},

		onError(message) {
			this.loading = false;
			this.playing = false;
			this.wantsToPlay = false;
			this.error = message || "Audio playback failed";
		},

		clearError() {
			this.error = null;
		},
	},
});