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
// @ts-ignore
import trackRow from "./components/track-row.vue";
// @ts-ignore
import albumRaw from "./components/album-raw.vue";

// album-box, album-detail album-list, album-row
export default {
  name: "Album",
  props: ["albumId", "language"],

  inject: ["root", "dataStore", "storageStore"],
  provide() {
    return {
      root: this.root,
      dataStore: this.dataStore,
      storageStore: this.storageStore
    };
  },

  components: {
    trackRow,
    albumRaw
  },
  // watch: {},
  methods: {
    // playAlbum(ui){
    //   var albums = this.$parent.old.filter((e) => {
    //     return e.ui == ui;
    //   });
    //   this.$parent.queue=[];
    //   for (const album of albums) {
    //     for (const trk of album.tk) {
    //       this.$parent.queue.push(trk);
    //     }
    //   }
    // },
  },
  // filters:{
  //   sumplay: function(e){
  //     return e.reduce((a, b) => a + parseInt(b.p), 0);
  //   }
  // },
  computed: {
    // $() {
    // 	return this.$parent;
    // },
    albums() {
      return this.dataStore.all.album.filter(e =>
        this.dataStore.albumActiveLang
          ? e.lg == this.dataStore.albumActiveLang
          : true
      );
    },
    activeAlbum() {
      if (this.albumId) {
        var lg = this.dataStore.all.lang.find(
          e => e.name.toLowerCase() == this.albumId.toLowerCase()
        );
        if (lg) {
          this.dataStore.albumActiveLang = lg.id;
        } else {
          return this.dataStore.all.album
            .filter(
              e =>
                e.ui == this.albumId ||
                e.ab.toLowerCase() == this.albumId.toLowerCase()
            )
            .filter(
              // e=>e.tk.sort((a, b) => (a.n > b.n) ? 1 : -1)
              e => e.tk
            );
        }
      }
      return [];
    }
  }
  // created() {},
  // beforeMount() {}
  // mounted () {},
};

</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>