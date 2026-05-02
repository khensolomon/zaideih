<template>
  <div class="queue">
    <div v-if="playerStore.queueCount" class="row tracks bg- sh-">
      <div class="track-row">
        <track-row
          v-for="(track, index) in visibleQueue"
          :track="track"
          :key="track.i + '-' + index"
        />
        <div
          v-if="playerStore.queueCount > dataStore.queueTrackLimit"
          class="show-more"
        >
          <p @click="dataStore.queueTrackLimit += 9" class="icon-right">
            <span v-text="dataStore.queueTrackLimit" class="limit"></span>
            <span v-text="playerStore.queueCount" class="total"></span>
            <span class="more">more</span>
          </p>
        </div>
      </div>
    </div>
    <div v-else class="row center">
      <h1>Queue is empty</h1>
      <p>Click any track to start playing.</p>
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import trackRow from "./components/track-row.vue";
import { useDataStore } from "./store-data.js";
import { usePlayerStore } from "./store-player.js";

export default {
  name: "Queue",
  components: { trackRow },

  // No more provide/inject needed — track-row gets the stores directly.
  // We still inject `root` because track-row uses it for artistName.
  inject: ["root"],
  provide() {
    return { root: this.root };
  },

  computed: {
    ...mapStores(useDataStore, usePlayerStore),

    /**
     * Slice the queue down to the current display limit. Reading the
     * sliced array (instead of indexing) avoids any chance of going past
     * the end if the queue shrinks while the page is rendered.
     */
    visibleQueue() {
      return this.playerStore.queue.slice(0, this.dataStore.queueTrackLimit);
    },
  },
};
</script>
