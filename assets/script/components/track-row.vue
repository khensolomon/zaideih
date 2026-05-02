<template>
  <div
    v-if="track"
    :class="rowClasses"
    @click="onClick"
    @keydown.enter="onClick"
    role="button"
    tabindex="0"
    :aria-label="ariaLabel"
  >
    <div class="at art">
      <span class="play track" :class="playIconClass"></span>
    </div>
    <div class="begin">
      <span class="trk"></span>
      <span
        class="count icon-headphones"
        v-text="track.p > 0 ? dataStore.digitShortenTesting(track.p) : ''"
      ></span>
    </div>
    <div class="meta">
      <p class="title"><a>{{ track.t }}</a></p>
      <p class="artist">
        <router-link
          v-for="(artist, index) in artistNames"
          :to="{ path: '/artist/' + artist }"
          :key="index"
        >{{ artist }}</router-link>
      </p>
    </div>
    <div class="end">
      <span v-text="dataStore.trackDuration(track.d)"></span>
    </div>
    <div class="at mre">
      <span class="icon-info"></span>
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useDataStore } from "../store-data.js";
import { usePlayerStore } from "../store-player.js";

export default {
  name: "track-row",
  props: {
    track: { type: Object, required: true },
  },

  inject: ["root"],

  computed: {
    ...mapStores(useDataStore, usePlayerStore),

    isCurrent() {
      return this.playerStore.current?.i === this.track.i;
    },

    isQueued() {
      return this.playerStore.isInQueue(this.track.i);
    },

    rowClasses() {
      if (this.isCurrent) return "active";
      if (this.isQueued) return "queued";
      return null;
    },

    playIconClass() {
      if (this.isCurrent && this.playerStore.playing) return "icon-pause";
      return "icon-play";
    },

    artistNames() {
      return this.root.artistName(this.track);
    },

    ariaLabel() {
      const title = this.track.t || "track";
      if (this.isCurrent && this.playerStore.playing) return `Pause ${title}`;
      if (this.playerStore.current && this.playerStore.playing) {
        return `Play ${title} next`;
      }
      return `Play ${title}`;
    },
  },

  methods: {
    onClick(event) {
      // Don't trigger play when the user clicks an artist link inside the row.
      if (event.target.nodeName === "A") return;

      // smartPlay handles all three cases:
      //   - same track → toggle pause/resume
      //   - nothing playing → play immediately
      //   - something playing → enqueue right after current
      this.playerStore.smartPlay(this.track);
    },
  },
};
</script>
