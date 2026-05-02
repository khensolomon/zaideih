<template>
  <div class="album-row">
    <div class="left">
      <p class="play">
        <span class="icon-play" @click="root.playAlbum(album.ui)" role="button" tabindex="0" @keydown.enter="root.playAlbum(album.ui)" :aria-label="'Play ' + album.ab"></span>
      </p>
    </div>
    <div class="right">
      <h3>
        <router-link :to="{ path: '/album/' + album.ui }">{{ album.ab }}</router-link>
      </h3>
      <div class="badge-tag artist-name artist icon-artist">
        <router-link v-for="artist in root.albumArtist(album)" :to="{ path: '/artist/' + artist }" :key="artist">{{ artist }}</router-link>
      </div>
      <p class="other">
        <span class="plays icon-flag">{{ sumplay }}</span>
        <router-link v-for="genre in album.gr" :to="{}" :key="genre" class="genre">{{ genre }}</router-link>
        <router-link v-for="year in dataStore.yearRanges(album.yr)" :to="{}" :key="year" class="year">{{ year }}</router-link>
      </p>
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useDataStore } from "./store-data.js";

export default {
  name: 'album-row',
  props: {
    album: Object,
  },
  inject: ["root"],
  computed: {
    ...mapStores(useDataStore),
    sumplay() {
      return this.album.tk.reduce((a, b) => a + parseInt(b.p), 0);
    },
  },
};
</script>
