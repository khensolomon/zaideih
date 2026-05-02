<template>
  <div v-if="album" class="album-box--">
    <div class="disc icon-albums" :class="root.albumGenre(album).map(e=>e.toLowerCase()).join(' ')">
      <p class="genre">
        <a v-for="gr in root.albumGenre(album)" :key="gr" v-text="gr"></a>
      </p>
      <p class="year">
        <a v-for="year in dataStore.yearRanges(album.yr)" :key="year" v-text="year"></a>
      </p>
      <p class="play">
        <span class="icon-play" @click="root.playAlbum(album.ui)" role="button" tabindex="0" @keydown.enter="root.playAlbum(album.ui)" :aria-label="'Play ' + album.ab"></span>
      </p>
      <p class="length icon-time" v-text="dataStore.albumDuration(album)"></p>
      <p class="total icon-headphones" v-text="album.tp"></p>
      <p class="artist">
        <span v-for="artist in root.albumArtist(album)" :key="artist">{{ artist }}</span>
      </p>
    </div>
    <div class="name">
      <p class="album">
        <router-link :to="{ path: '/album/' + album.ui }" :title="album.ab">{{ album.ab }}</router-link>
      </p>
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useDataStore } from "./store-data.js";

export default {
  name: 'album-raw',
  props: {
    album: Object,
  },
  inject: ["root"],
  computed: {
    ...mapStores(useDataStore),
  },
};
</script>
