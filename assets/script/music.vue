<template>
  <div class="music">
    <template v-if="searchQuery">
      <!-- <h1><strong>{{searchQuery}}</strong> found match</h1> -->
      <div v-if="searchResult" class="container detail">
        <div class="row center count">
          <div class="track">
            <p class="icon-music" v-bind:class="{ active: tracks.length }"><span v-text="tracks.length"></span></p>
          </div>
          <div class="album">
            <p class="icon-cd" v-bind:class="{ active: albums.length }"><span v-text="albums.length"></span></p>
          </div>
          <div class="album">
            <p class="icon-albums" v-bind:class="{ active: albumsRecommended.length }"><span
                v-text="albumsRecommended.length"></span></p>
          </div>
          <div class="album">
            <p class="icon-flag" v-bind:class="{ active: albumsRelated.length }"><span
                v-text="albumsRelated.length"></span></p>
          </div>
          <div class="artist">
            <p class="icon-artist" v-bind:class="{ active: artists.length }"><span v-text="artists.length"></span></p>
          </div>
          <div class="track">
            <p class="icon-track" v-bind:class="{ active: tracksByArtist.length }"><span
                v-text="tracksByArtist.length"></span></p>
          </div>
        </div>

        <div v-if="tracks.length" class="row tracks bg sh-">
          <div class="track-row">
            <track-row v-for="(n, index) in dataStore.searchTrackLimit" v-bind:track="tracks[index]" :key="index" />
            <div v-if="tracks.length > dataStore.searchTrackLimit" class="show-more">
              <p @click="searchTrackLimitUpdate" class="icon-right">
                <span v-text="dataStore.searchTrackLimit" class="limit"></span><span v-text="tracks.length"
                  class="total"></span><span class="more">more</span>
              </p>
            </div>
          </div>
        </div>

        <div v-if="artists.length" class="row center name-artist artists matched">
          <q>Artist matched</q>
          <router-link v-for="artist in artists" :to="{ path: '/artist/' + artist.name }" :key="artist.id">{{
            artist.name }}</router-link>
        </div>
        <!-- album -->
        <div v-if="albums.length" class="container list">
          <div>
            <div class="album-raw center">
              <album-raw v-for="(n, index) in dataStore.searchAlbumLimit" v-bind:album="albums[index]" :key="index" />
              <div v-if="albums.length > dataStore.searchAlbumLimit" class="show-more">
                <p @click="dataStore.searchAlbumLimit += 9" class="icon-right">
                  <span v-text="dataStore.searchAlbumLimit" class="limit"></span><span v-text="albums.length"
                    class="total"></span><span class="more">more</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <!-- track related: get tracks belongs to the first artist play all, length, plays -->
        <div v-if="tracksByArtist.length" class="row tracks bg- sh-">
          <div class="track-row">
            <track-row v-for="(n, index) in dataStore.searchTracksByArtistLimit" v-bind:track="tracksByArtist[index]"
              :key="index" />
            <div v-if="tracksByArtist.length > dataStore.searchTracksByArtistLimit" class="show-more">
              <p @click="searchTracksByArtistLimitUpdate" class="icon-right">
                <span v-text="dataStore.searchTracksByArtistLimit" class="limit"></span><span
                  v-text="tracksByArtist.length" class="total"></span><span class="more">more</span>
              </p>
            </div>
          </div>
        </div>
        <!-- album recommended: no albums found, therefore get all album from result -->
        <div v-if="albumsRecommended.length" class="row center">
          <div>
            <div class="album-raw center">
              <album-raw v-for="(n, index) in dataStore.searchAlbumRecommendedLimit"
                v-bind:album="albumsRecommended[index]" :key="index" />
              <div v-if="albumsRecommended.length > dataStore.searchAlbumRecommendedLimit" class="show-more">
                <p @click="dataStore.searchAlbumRecommendedLimit += 9" class="icon-right">
                  <span v-text="dataStore.searchAlbumRecommendedLimit" class="limit"></span><span
                    v-text="albumsRecommended.length" class="total"></span><span class="more">more</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <!-- album related: albums found, there are related album too -->
        <div v-if="albumsRelated.length" class="row center">
          <div>
            <div class="album-raw center">
              <album-raw v-for="(n, index) in dataStore.searchAlbumRelatedLimit" v-bind:album="albumsRelated[index]"
                :key="index" />
              <div v-if="albumsRelated.length > dataStore.searchAlbumRelatedLimit" class="show-more">
                <p @click="dataStore.searchAlbumRelatedLimit += 9" class="icon-right">
                  <span v-text="dataStore.searchAlbumRelatedLimit" class="limit"></span><span
                    v-text="albumsRelated.length" class="total"></span><span class="more">more</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="container list">
        <div class="z-working">
          <h1 class="text-vw">Oops!</h1>
          <p v-text="searchQuery"></p>
          <ul>
            <li>...make sure <span>{{ searchQuery }}</span> is spelt correctly,</li>
            <li>try general keywords</li>
            <li><span>or</span> try different keywords.</li>
          </ul>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="container list">
        <div class="z-working">
          <h1 class="text-vw">I don't understand! {{ dataStore.searchQuery }}</h1>
          <p>but let me say hello twice real quick..</p>
          <ul>
            <li v-for="index in 2" :key="index">{{ index }} Hello</li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
// @ts-ignore
import trackRow from "./track-row.vue";
// @ts-ignore
import albumRaw from "./album-raw.vue";

export default {
  name: "Track",
  props: ["year", "language", "genre", "searchQuery", "searchAt"],
  data: () => ({
    // limitResult: 30,
    // albumLimit: 9,
    // albumsRelatedLimit: 9,
    // albumsRecommendedLimit: 9,
    // tracksLimit: 9,
    // tracksByArtistLimit: 9,
    // results: [],
    // artistList: [],
    // tracksByArtistName: "",
    // trackList: [],
    // albumList: []
    // searchAlbumLimit: 9,
    // searchAlbumRelatedLimit: 9,
    // searchAlbumRecommendedLimit: 9,
    // searchTrackLimit: 9,
    // searchTracksByArtistLimit: 9,
    // searchResults: [],
    // searchArtistList: [],
    // searchTracksByArtistName: "",
    // searchTrackList: [],
    // searchAlbumList: []
  }),

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
  methods: {
    searchPattern(query) {
      return new RegExp(this.searchQuery, "i").test(query);
    },
    playTrack(track) {
      console.log(track);
    },
    searchTrackLimitUpdate() {
      var e = this.dataStore.searchTrackLimit + 9;
      if (e < this.tracks.length) {
        this.dataStore.searchTrackLimit = e;
      } else {
        this.dataStore.searchTrackLimit = this.tracks.length;
      }
    },
    searchTracksByArtistLimitUpdate() {
      var e = this.dataStore.searchTracksByArtistLimit + 9;
      if (e < this.tracksByArtist.length) {
        this.dataStore.searchTracksByArtistLimit = e;
      } else {
        this.dataStore.searchTracksByArtistLimit = this.tracksByArtist.length;
      }
    }
  },
  // watch: {
  // 	tracksLimit(e) {
  // 		this.tracksLimit = e < this.tracks.length ? e : this.tracks.length;
  // 	},
  // 	tracksByArtistLimit(e) {
  // 		this.tracksByArtistLimit =
  // 			e < this.tracksByArtist.length ? e : this.tracksByArtist.length;
  // 	}
  // },
  computed: {
    searchResult() {
      // TODO temp

      // this.dataStore.searchResults = this.$parent.old.filter(
      //   album => this.searchPattern(album.ab) || album.tk.some(
      //     track => this.searchPattern(track.tl) || track.ar.some(
      //       artist => this.searchPattern(artist)
      //     )
      //   )
      // );
      this.dataStore.searchArtistList = this.dataStore.all.artist
        .filter(
          e =>
            e.thesaurus.find(s => this.searchPattern(s)) ||
            this.searchPattern(e.name) ||
            (e.aka && this.searchPattern(e.aka))
        )
        .sort((a, b) => (a.plays < b.plays ? 1 : -1));
      // var artistsearch = [172,4].filter(
      //   e=>artistIndex.find(i=>i.id == e)
      // );
      this.dataStore.searchResults = this.dataStore.all.album.filter(
        album =>
          this.searchPattern(album.ab) ||
          album.tk.some(
            track =>
              this.searchPattern(track.t) ||
              track.a.find(id =>
                this.dataStore.searchArtistList.find(i => id == i.id)
              )
          )
      );
      this.dataStore.searchTrackList = this.dataStore.searchResults
        .map(album => album.tk)
        .reduce((prev, next) => prev.concat(next), []);

      this.dataStore.searchAlbumLimit = 9;
      this.dataStore.searchAlbumRelatedLimit = 9;
      this.dataStore.searchAlbumRecommendedLimit = 9;
      this.dataStore.searchTrackLimit = 9;
      this.dataStore.searchTracksByArtistLimit = 9;

      return this.dataStore.searchResults.length;
    },

    tracks() {
      this.dataStore.searchTrackList = this.dataStore.searchResults
        .map(album => album.tk)
        .reduce((prev, next) => prev.concat(next), []);

      return this.dataStore.searchTrackList.filter(track =>
        this.searchPattern(track.t)
      );
    },

    artists() {
      // this.dataStore.searchArtistList = this.dataStore.searchResults.map(
      //   album => album.tk.map(
      //     track => track.ar
      //   ).reduce((prev, next) => prev.concat(next),[])
      // ).reduce((prev, next) => prev.concat(next),[]).filter((value, index, self) => self.indexOf(value) === index);
      // var tmp = this.dataStore.searchArtistList.filter(artist=>this.searchPattern(artist));
      // if (tmp.length) this.dataStore.searchTracksByArtistName = tmp[0];
      // return tmp;
      return this.dataStore.searchArtistList;
    },

    tracksByArtist() {
      return this.dataStore.searchTrackList
        .filter(
          // track => track.a.findIndex(artist => this.dataStore.searchTracksByArtistName.toLowerCase() === artist.toLowerCase()) >= 0
          track =>
            track.a.find(id =>
              this.dataStore.searchArtistList.find(i => id == i.id)
            )
        )
        .filter(
          current =>
            // @ts-ignore
            this.tracks.filter(other => other.i == current.i).length == 0
        );
    },
    albums() {
      this.dataStore.searchAlbumList = this.dataStore.searchResults.filter(
        album => this.searchPattern(album.ab)
      );
      return this.dataStore.searchAlbumList;
    },
    albumsRecommended() {
      return this.dataStore.searchResults.filter(
        current =>
          this.dataStore.searchAlbumList.filter(other => other.ui == current.ui)
            .length == 0
      );
    },
    albumsRelated() {
      return this.dataStore.searchResults.filter(
        current =>
          this.dataStore.searchAlbumList
            .concat(this.albumsRecommended)
            .filter(other => other.ui == current.ui).length == 0
      );
    }
  }
  // created() {},
  // beforeMount() {},
  // mounted() {}
};
/*
var str = "Hello world, welcome to the universe.";
var n = str.includes("world");

if (stringToCheck.substr(0, query.length).toUpperCase() == query.toUpperCase())

var searchPattern = new RegExp('^' + query);
if (searchPattern.test(stringToCheck)) {}
*/

</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>