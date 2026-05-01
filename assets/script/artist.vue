<template>
  <div class="artist">

    <template v-if="artistName && init">
      <div v-if="dataStore.tracks.length" class="container detail">
        <div class="row center count">
          <div class="plays">
            <p class="icon-headphones" v-bind:class="{ active: trackPlays }"><span v-text="trackPlays"></span></p>
          </div>
          <div class="time">
            <p class="icon-time" v-bind:class="{ active: trackDuration }"><span v-text="trackDuration"></span></p>
          </div>
          <div class="track">
            <p class="icon-music" v-bind:class="{ active: trackCount }"><span v-text="trackCount"></span></p>
          </div>
          <div class="album">
            <p class="icon-cd" v-bind:class="{ active: albumCount }"><span v-text="albumCount"></span></p>
          </div>
        </div>
        <div class="row center head">
          <h1>{{ dataStore.artist.name }} <span v-if="dataStore.artist.aka">({{ dataStore.artist.aka }})</span></h1>
        </div>
        <div v-if="artistYear.length" class="row center year">
          <a v-for="year in artistYear" :key="year">{{ year }}</a>
        </div>
        <div class="row center play">
          <span @click="playArtist" class="play all">Play all</span>
        </div>
        <div v-if="artistRecommended.length" class="row center name-artist artists recommended">
          <q>Recommended</q>
          <router-link v-for="artist in artistRecommended" :to="{ path: '/artist/' + artist }" :key="artist">{{ artist
            }}</router-link>
        </div>
        <div class="row center- tracks bg sh">
          <div class="track-row">
            <!-- <track-row v-for="track in dataStore.tracks" v-bind:track="track" :key="track.id" /> -->
            <track-row v-for="(n, index) in dataStore.artistTracksLimit" v-bind:track="dataStore.tracks[index]"
              :key="index" />
            <div v-if="dataStore.tracks.length > dataStore.artistTracksLimit" class="show-more">
              <p @click="dataStore.artistTracksLimit += 9" class="icon-right">
                <span v-text="dataStore.artistTracksLimit" class="limit"></span><span v-text="dataStore.tracks.length"
                  class="total"></span><span class="more">more</span>
              </p>
            </div>
          </div>
        </div>
        <div v-if="artistRelated.length" class="row center name-artist artists related">
          <q>Related</q>
          <router-link v-for="artist in artistRelated" :to="{ path: '/artist/' + artist }" :key="artist">{{ artist
            }}</router-link>
        </div>
      </div>
      <!-- albums -->
      <div v-if="dataStore.albums.length" class="container list">
        <div>
          <div class="album-raw center">
            <album-raw v-for="album in dataStore.albums" v-bind:album="album" :key="album.ui" />
          </div>
        </div>
      </div>

    </template>
    <template v-else>
      <div class="container list">
        <div v-if="dataStore.all.lang.length" class="row center tag show-lang badge-tag-">
          <!-- <router-link :to="{ path: '/artist'}" class="icon-lightbulb">All</router-link> -->
          <!-- <router-link v-for="(lang,index) in dataStore.all.lang" :to="{ path: '/artist/'+lang.name}" :key="index"
          class="icon-lightbulb">{{lang.name}}</router-link> -->
          <router-link v-for="(lang, index) in dataStore.all.lang" :to="{ path: linkPath('artist', lang.name) }"
            :key="index" class="icon-lightbulb">{{ lang.name }}</router-link>
        </div>
        <!-- <div v-if="dataStore.all.artistType.length" class="row center tag show-lang badge-tag-">
        <router-link v-for="(lang,index) in dataStore.all.artistType"
          :to="{ path: linkPath('artist',artistName,lang.name)}" :key="index"
          class="icon-lightbulb">{{lang.name}}</router-link>
      </div> -->


        <!-- artists -->
        <!-- v-if="isNaN(category.cluster)" -->
        <div class="z-artists" v-if="artistCategory.length">
          <div v-for="category in artistCategory" :key="category.cluster">
            <div v-if="isNaN(category.cluster)">
              <h3>{{ category.cluster }}</h3>
              <p v-if="category.artists.length">
                <router-link v-for="artist in category.artists" :key="artist.id"
                  :to="{ path: '/artist/' + artist.name }">{{ artist.name }}</router-link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
// @ts-ignore
import trackRow from "./components/track-row.vue";
// @ts-ignore
// import albumRow from "../components/album-row.vue";
// @ts-ignore
import albumRaw from "./components/album-raw.vue";

export default {
  name: "Artist",
  props: ["artistName", "language"],

  inject: ["root", "dataStore", "storageStore"],
  provide() {
    return {
      root: this.root,
      dataStore: this.dataStore,
      storageStore: this.storageStore,
    };
  },

  components: {
    trackRow,
    // albumRow,
    albumRaw,
  },

  // filters:{
  //   sumplay: function(e){
  //     return e.reduce((a, b) => a + parseInt(b.p), 0);
  //   }
  // },
  methods: {
    // albumArtist: function(e){
    //   var o = e.map((a) => a.ar );
    //   return new Set([].concat.apply([], o));
    // },
    // playTrack: function(e){
    //   this.parent.addQueue(e);
    // },
    // playAlbum(ui){
    //   var albums = this.parentparent.old.filter((e) => {
    //     return e.ui == ui;
    //   });
    //   this.parentparent.queue=[];
    //   for (const album of albums) {
    //     for (const trk of album.tk) {
    //       this.parentparent.queue.push(trk);
    //     }
    //   }
    // },
    playArtist() {
      // this.parentparent.queue = this.dataStore.tracks;
      // this.parent.queue=[];
      // await this.dataStore.tracks.forEach(e=>this.parent.addQueue(e))
      // this.parent.play();
      this.root.playAll(this.dataStore.tracks);
    },

    linkPath(...a) {
      return "/" + a.filter((e) => e).join("/");
    },
  },
  watch: {
    artistTracksLimit(e) {
      this.dateStore.artistTracksLimit =
        e < this.dataStore.tracks.length ? e : this.dataStore.tracks.length;
    },
    // tracksByArtistLimit(e){
    //   this.tracksByArtistLimit = e<this.tracksByArtist.length?e:this.tracksByArtist.length;
    // },
  },
  computed: {
    init() {
      var lg = this.dataStore.all.lang.find(
        (e) => e.name.toLowerCase() == this.artistName.toLowerCase()
      );
      if (lg) {
        this.dataStore.artistActiveLang = lg.id;
        return null;
      }

      this.dataStore.artist = this.dataStore.all.artist.find(
        (artist) =>
          this.artistName.toLowerCase() === artist.name.toLowerCase() ||
          (artist.aka && new RegExp(this.artistName, "i").test(artist.aka))
      );
      if (!this.dataStore.artist) return null;
      // console.log(artist)
      this.dataStore.albums = this.dataStore.all.album.filter((album) =>
        album.tk.some(
          // track => track.ar.indexOf(this.artistName) >= 0
          (track) => track.a.find((e) => e == this.dataStore.artist.id)
        )
      );

      this.dataStore.tracks = this.dataStore.albums
        .map((album) =>
          album.tk.filter((track) =>
            track.a.find((e) => e == this.dataStore.artist.id)
          )
        )
        .reduce((prev, next) => prev.concat(next), [])
        .sort((a, b) => (a.p < b.p ? 1 : -1));

      var artRed = this.dataStore.albums
        .map((album) =>
          album.tk
            .map((track) => track.a)
            .reduce((prev, next) => prev.concat(next), [])
        )
        .reduce((prev, next) => prev.concat(next), []);
      this.dataStore.artistRelatedIndex = [...new Set(artRed)].filter(
        (i) => i > 1 && i !== this.dataStore.artist.id
      );

      var artRmd = this.dataStore.tracks
        .map((track) => track.a)
        .reduce((prev, next) => prev.concat(next), []);
      this.dataStore.artistRecommendedIndex = [...new Set(artRmd)].filter(
        (i) => i > 1 && i !== this.dataStore.artist.id
      );

      this.artistRelated = this.dataStore.artistRelatedIndex
        .filter(
          this.dataStore.arrayComparer(this.dataStore.artistRecommendedIndex)
        )
        .map((i) => this.dataStore.all.artist.find((e) => e.id == i))
        .sort((a, b) => (a.plays < b.plays ? 1 : -1))
        .map(
          (e) =>
            (this.dataStore.utf8(this.artistName) ||
              this.dataStore.artist.l.find((e) => e == 2)) &&
              e.aka
              ? e.aka
              : e.name
          // e=>this.dataStore.utf8(this.artistName) && e.aka?e.aka:e.name
          // e=>this.dataStore.artist.l.find(e=>e == 2) && e.aka?e.aka:e.name
        );

      this.artistRecommended = this.dataStore.artistRecommendedIndex
        .map((i) => this.dataStore.all.artist.find((e) => e.id == i))
        .sort((a, b) => (a.plays < b.plays ? 1 : -1))
        .map((e) =>
          this.dataStore.utf8(this.artistName) && e.aka ? e.aka : e.name
        );
      return this.dataStore.albums.length;
    },

    albumPlays() {
      return this.dataStore.albums.reduce((a, b) => a + parseInt(b.tp), 0);
    },
    trackPlays() {
      return this.dataStore.tracks.reduce((a, b) => a + parseInt(b.p), 0);
    },
    artistYear() {
      var yrs = this.dataStore.albums
        .map((a) => a.yr)
        .reduce((prev, next) => prev.concat(next), []);
      return [...new Set(yrs)].sort().filter(Number);
    },
    trackCount() {
      return this.dataStore.tracks.length;
    },
    albumCount() {
      return this.dataStore.albums.length;
    },
    trackDuration() {
      // return this.parent.trackDuration(this.dataStore.tracks);
      return this.dataStore.trackDuration(
        this.dataStore.tracks.map((track) => track.d)
      );
    },
    artistCategory() {
      return this.dataStore.artistCategory();
    },
  },
  created() {
    // console.log("home.created");
    // console.log("layout.$parent.dataStore", this.parentparent.dataStore);
    // this.dataStore.increment();
    // console.log("layout.dataStore.searchAt", this.dataStore.searchAt);
    // console.log("layout.created=1", this.dataStore.count);
    // console.log("home.created=1", this.dataStore.count);
    // console.log("artist.created", this.dataStore.count);
    // console.log("artist.created", this.root.testDelete);
    // this.root.testDelete();
    // console.log(this.dataStore.all.artist);
    // this.dataStore.artistCategory();
  },
};

</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>