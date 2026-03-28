<template>
  <div class="album">
    <template v-if="activeAlbum.length">
      <div v-for="album in activeAlbum" :key="album.ui" class="container detail">
        <div class="row center count">
          <div class="plays">
            <p class="icon-headphones active"><span>{{ album.tp }}</span></p>
          </div>
          <div class="time">
            <p class="icon-time active"><span v-text="dataStore.albumDuration(album)"></span></p>
          </div>
          <div class="track">
            <p class="icon-music" :class="{ active: album.tk.length }"><span v-text="album.tk.length"></span></p>
          </div>
        </div>
        <div class="row center head">
          <h1 v-text="album.ab"></h1>
        </div>
        <div v-if="album.yr.length" class="row center year">
          <a v-for="year in album.yr" :key="year" v-text="year"></a>
        </div>
        <div class="row center play">
          <span @click="root.playAlbum(album.ui)" class="play all">Play all</span>
        </div>
        <div v-if="album.gr.length" class="row center genre">
          <a v-for="genre in root.albumGenre(album)" :key="genre" v-text="genre"></a>
        </div>
        <div class="row center middle artists name-artist">
          <router-link v-for="artist in root.albumArtist(album)" :to="{ path: '/artist/' + artist.toLowerCase() }"
            :key="artist">{{ artist }}</router-link>
        </div>
        <div class="row tracks bg- sh-">
          <div class="main track-row" v-if="album.tk.length">
            <track-row v-for="track in album.tk" :track="track" :key="track.i" />
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="container list">
        <div v-if="dataStore.all.lang.length" class="row center tag show-lang badge-tag-">
          <router-link v-for="(lang, index) in dataStore.all.lang" :to="{ path: '/album/' + lang.name }" :key="index"
            class="icon-lightbulb">{{ lang.name }}</router-link>
        </div>
        <div v-if="albums.length" class="album-raw">
          <album-raw v-for="(n, index) in dataStore.albumLimit" :album="albums[index]" :key="index" />
        </div>
        <div v-if="albums.length > dataStore.albumLimit" class="row center show-more">
          <p @click="dataStore.albumLimit += 9" class="icon-right">
            <span v-text="dataStore.albumLimit" class="limit"></span>
            <span v-text="albums.length" class="total"></span>
            <span class="more">more</span>
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
// Option A: Keep pointing to your external file
import script from './script.js';
export default script;

// Option B: If you prefer to paste your script.js content here, 
// remove the import above and paste the export default { ... } block here.
</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>