<template>
  <div class="player-controls">
    <div class="meta">
      <div class="info">
        <p class="title icon-music">{{ playerStore.current?.t || '...' }}</p>
        <p v-if="playerStore.current?.a" class="artist icon-artist">
          <router-link
            v-for="artist in artistNames"
            :to="{ path: '/artist/' + artist }"
            :key="artist"
          >{{ artist }}</router-link>
        </p>
        <p v-if="playerStore.current?.b" class="album icon-cd">
          <router-link :to="{ path: '/album/' + playerStore.current.b }">
            {{ playerStore.current.b }}
          </router-link>
        </p>
      </div>
    </div>

    <div class="controls">
      <div class="progress">
        <audio
          ref="audio"
          :src="audioSrc"
          :loop="playerStore.loop"
          @loadstart="playerStore.onLoadStart()"
          @canplay="onCanPlay"
          @play="playerStore.onPlay()"
          @pause="playerStore.onPause()"
          @ended="onEnded"
          @timeupdate="onTimeUpdate"
          @durationchange="onDurationChange"
          @loadedmetadata="onLoadedMetadata"
          @progress="onProgress"
          @error="onError"
          type="audio/mpeg"
          preload="auto"
          controls
          hidden
        ></audio>

        <div class="time start">{{ timeOfCurrent }}</div>

        <div class="seek">
          <span class="tooltip" :style="{ left: hoverLeft + 'px' }">{{ timeOfHover }}</span>
          <div>
            <div :style="{ width: playerStore.percentProgress + '%' }" class="seeker"></div>
            <div :style="{ width: playerStore.percentBuffered + '%' }" class="progress"></div>
            <input
              :value="playerStore.percentProgress"
              @input="onSeekInput"
              @change="onSeekChange"
              @mousemove="onSeekHover"
              type="range"
              step="0.001"
              min="0"
              max="100"
              :aria-label="'Seek, currently at ' + timeOfCurrent"
            />
          </div>
        </div>

        <div class="time end">{{ timeOfDuration }}</div>
      </div>

      <ul>
        <li
          class="icon-loop toggle"
          :class="{ active: playerStore.loop }"
          @click="playerStore.toggleLoop()"
          :aria-pressed="playerStore.loop"
          aria-label="Loop"
          role="button"
          tabindex="0"
          @keydown.enter="playerStore.toggleLoop()"
          @keydown.space.prevent="playerStore.toggleLoop()"
        ></li>

        <li
          class="icon-play-previous"
          :class="{ disabled: !playerStore.hasActiveTrack }"
          @click="playerStore.previous()"
          aria-label="Previous track"
          role="button"
          tabindex="0"
          @keydown.enter="playerStore.previous()"
        ></li>

        <li
          :class="[
            playerStore.loading ? 'icon-loading animate-spin' :
            playerStore.playing ? 'icon-pause' : 'icon-play',
            'round'
          ]"
          @click="playerStore.togglePlay()"
          :aria-label="playerStore.playing ? 'Pause' : 'Play'"
          role="button"
          tabindex="0"
          @keydown.enter="playerStore.togglePlay()"
          @keydown.space.prevent="playerStore.togglePlay()"
        ></li>

        <li
          class="icon-play-next"
          :class="{ disabled: !playerStore.hasNext }"
          @click="playerStore.next()"
          aria-label="Next track"
          role="button"
          tabindex="0"
          @keydown.enter="playerStore.next()"
        ></li>

        <li class="queue">
          <router-link
            :to="{ path: '/queue' }"
            class="icon-list-bullet"
            title="Queue"
            :data-count="playerStore.queueCount"
          ></router-link>
        </li>
      </ul>
    </div>

    <div class="options">
      <ul>
        <li>
          <div class="volume">
            <span
              v-if="playerStore.volume > 0.9"
              @click="playerStore.toggleMute()"
              class="icon-volume-up"
              role="button"
              tabindex="0"
              aria-label="Mute"
            ></span>
            <span
              v-else-if="playerStore.isMuted"
              @click="playerStore.toggleMute()"
              class="muted icon-volume-off"
              role="button"
              tabindex="0"
              aria-label="Unmute"
            ></span>
            <span
              v-else
              @click="playerStore.toggleMute()"
              class="icon-volume-down"
              role="button"
              tabindex="0"
              aria-label="Mute"
            ></span>
            <input
              :value="playerStore.volume"
              @input="onVolumeInput"
              type="range"
              step="0.001"
              min="0"
              max="1"
              aria-label="Volume"
            />
          </div>
        </li>
      </ul>
    </div>

    <p
      v-if="playerStore.error"
      class="error"
      role="alert"
      @click="playerStore.clearError()"
      title="Click to dismiss"
    >{{ playerStore.error }}</p>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useDataStore } from "./store-data.js";
import { usePlayerStore } from "./store-player.js";

/**
 * Player component.
 *
 * Playback flow (the part that took us a few iterations to get right):
 *
 *   1. User clicks a track or hits play.
 *   2. Store sets `current = track` and `wantsToPlay = true`.
 *   3. Vue updates the <audio> element's src via :src binding.
 *   4. Browser fires `loadstart` (we set loading=true), buffers data.
 *   5. Browser fires `canplay` when ready. If wantsToPlay is true,
 *      we call audio.play() here — NOT earlier.
 *   6. audio.play() succeeds, fires `play` event, store.playing becomes true.
 *
 * Calling audio.play() before `canplay` fires often results in a silent
 * no-op or a rejected promise, which is why the user previously had to
 * click play twice. The `canplay` handler is the one that actually
 * triggers playback for fresh tracks.
 *
 * For pause/resume on the same track (no src change), we don't get a new
 * `canplay` event, so the wantsToPlay watcher handles those cases.
 */
export default {
  name: "Player",

  inject: ["root"],

  data: () => ({
    hover: 0,
    hoverLeft: -13,
    lastCommandId: 0,
  }),

  computed: {
    ...mapStores(useDataStore, usePlayerStore),

    /**
     * Returns undefined (NOT empty string) when no track is loaded, so
     * Vue removes the `src` attribute entirely.
     */
    audioSrc() {
      const id = this.playerStore.current?.i;
      if (id == null) return undefined;
      return this.dataStore.api.audio.replace("*", id);
    },

    artistNames() {
      const t = this.playerStore.current;
      if (!t || !t.a) return [];
      return this.root.artistName(t);
    },

    timeOfCurrent() {
      return this.dataStore.timeFormat(this.playerStore.currentTime);
    },

    timeOfHover() {
      return this.dataStore.timeFormat(this.hover);
    },

    timeOfDuration() {
      return this.dataStore.timeFormat(this.playerStore.duration);
    },
  },

  watch: {
    /**
     * Handles pause/resume on the SAME track (no src change). For a
     * fresh src, the canplay event handler triggers playback instead —
     * see onCanPlay() below.
     */
    "playerStore.wantsToPlay"(wants) {
      const audio = this.$refs.audio;
      if (!audio || !audio.src) return;

      if (wants && audio.paused && audio.readyState >= 2) {
        // readyState >= 2 means the audio has enough data to play at
        // least the current frame. If we're below that, canplay will
        // fire soon and trigger playback then.
        this.tryPlay(audio);
      } else if (!wants && !audio.paused) {
        audio.pause();
      }
    },

    /**
     * Update document title when track changes.
     */
    "playerStore.current"(track) {
      if (!track) {
        document.title = "Music";
        return;
      }
      const title = track.t || "Untitled";
      const artists = this.artistNames.join(", ");
      document.title = artists ? `${title} - ${artists}` : title;
    },

    "playerStore.volume"(v) {
      const audio = this.$refs.audio;
      if (audio) audio.volume = v;
    },

    "playerStore.command"(cmd) {
      if (!cmd || cmd.id === this.lastCommandId) return;
      this.lastCommandId = cmd.id;
      const audio = this.$refs.audio;
      if (!audio) return;
      if (cmd.type === "seek") {
        audio.currentTime = cmd.value;
      }
    },
  },

  mounted() {
    this.$refs.audio.volume = this.playerStore.volume;
  },

  methods: {
    /**
     * Called when the audio element has buffered enough to start playing.
     * If the user wanted to play (clicked a track / hit play), this is
     * where we actually start playback for a freshly-loaded track.
     */
    onCanPlay() {
      this.playerStore.onCanPlay();

      const audio = this.$refs.audio;
      if (this.playerStore.wantsToPlay && audio.paused) {
        this.tryPlay(audio);
      }
    },

    /**
     * Wrap audio.play() with proper error handling. Browsers reject the
     * play() promise in two main cases:
     *   - AbortError: src changed mid-load (normal during fast track changes)
     *   - NotAllowedError: autoplay blocked (user hasn't interacted yet)
     */
    tryPlay(audio) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch((err) => {
          if (!err) return;
          if (err.name === "AbortError") return; // expected during track changes
          if (err.name === "NotAllowedError") {
            // Browser autoplay block. Keep wantsToPlay=false and let the
            // user click play manually. Don't show this as an error;
            // it's the browser's expected behavior on fresh page loads.
            this.playerStore.wantsToPlay = false;
            return;
          }
          this.playerStore.onError(err.message || "Playback failed");
        });
      }
    },

    onTimeUpdate(e) {
      this.playerStore.onTimeUpdate(e.target.currentTime);
    },

    onDurationChange(e) {
      this.playerStore.onDurationChange(e.target.duration);
    },

    onLoadedMetadata(e) {
      this.playerStore.onDurationChange(e.target.duration);
    },

    onProgress(e) {
      const audio = e.target;
      const dur = audio.duration;
      if (!dur || !Number.isFinite(dur)) return;

      let maxEnd = 0;
      for (let i = 0; i < audio.buffered.length; i++) {
        const end = audio.buffered.end(i);
        if (end > maxEnd) maxEnd = end;
      }
      this.playerStore.onProgress(maxEnd / dur);
    },

    onEnded() {
      this.playerStore.onEnded();
    },

    onError(e) {
      const audio = e.target;

      // No src — not a real error.
      if (!audio.src || audio.src === window.location.href) return;
      // Aborted load — happens on fast track changes.
      if (!audio.currentSrc) return;

      const code = audio.error?.code;
      const messages = {
        1: "Playback aborted",
        2: "Network error — check your connection",
        3: "Could not decode audio",
        4: "Audio not available",
      };
      this.playerStore.onError(messages[code] || "Audio error");
    },

    onSeekInput(e) {
      const percent = Number(e.target.value);
      if (this.playerStore.duration) {
        this.playerStore.onTimeUpdate(
          (percent / 100) * this.playerStore.duration
        );
      }
    },

    onSeekChange(e) {
      this.playerStore.seekPercent(Number(e.target.value));
      e.target.blur();
    },

    onSeekHover(e) {
      const dur = this.playerStore.duration;
      if (!dur) return;
      const rect = e.target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x > 0 && x < rect.width) {
        this.hover = dur * (x / rect.width);
        this.hoverLeft = x - 18;
      }
    },

    onVolumeInput(e) {
      this.playerStore.setVolume(Number(e.target.value));
    },
  },
};
</script>

<style scoped>
.disabled {
  opacity: 0.4;
  pointer-events: none;
}
.error {
  color: #c44;
  font-size: 0.85em;
  margin: 0.25em 0.5em;
  cursor: pointer;
}
</style>