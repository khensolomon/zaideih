<template>
  <div class="artist">

    <div v-if="loading" class="container detail">
      <p class="t2 trial">one moment</p>
    </div>

    <div v-else-if="!artist" class="container detail z-not-found">
      <h1 class="t2">Artist not found</h1>
      <p>
        We couldn't find an artist matching "{{ artistName }}".
        <router-link :to="{ name: 'artist-index' }">Browse all artists</router-link>
      </p>
    </div>

    <template v-else>
      <div class="container detail">
        <div class="row center count">
          <div class="plays">
            <p class="icon-headphones" :class="{ active: trackPlays }">
              <span v-text="trackPlays"></span>
            </p>
          </div>
          <div class="time">
            <p class="icon-time" :class="{ active: trackDuration }">
              <span v-text="trackDuration"></span>
            </p>
          </div>
          <div class="track">
            <p class="icon-music" :class="{ active: trackCount }">
              <span v-text="trackCount"></span>
            </p>
          </div>
          <div class="album">
            <p class="icon-cd" :class="{ active: albumCount }">
              <span v-text="albumCount"></span>
            </p>
          </div>
        </div>

        <div class="row center head">
          <h1>
            {{ artist.name }}
            <span v-if="artist.aka">({{ artist.aka }})</span>
          </h1>
        </div>

        <div v-if="artistYear.length" class="row center year">
          <a v-for="year in artistYear" :key="year">{{ year }}</a>
        </div>

        <div class="row center play">
          <span @click="playArtist" class="play all" role="button" tabindex="0" @keydown.enter="playArtist">Play all</span>
        </div>

        <div v-if="recommended.length" class="row center name-artist artists recommended">
          <q>Recommended</q>
          <router-link
            v-for="name in recommended"
            :key="name"
            :to="{ path: '/artist/' + name }"
          >{{ name }}</router-link>
        </div>

        <div class="row center- tracks bg sh">
          <div class="track-row">
            <track-row
              v-for="track in visibleTracks"
              :key="track.i"
              :track="track"
            />
            <div v-if="tracks.length > tracksLimit" class="show-more">
              <p @click="showMore" class="icon-right">
                <span v-text="tracksLimit" class="limit"></span>
                <span v-text="tracks.length" class="total"></span>
                <span class="more">more</span>
              </p>
            </div>
          </div>
        </div>

        <div v-if="related.length" class="row center name-artist artists related">
          <q>Related</q>
          <router-link
            v-for="name in related"
            :key="name"
            :to="{ path: '/artist/' + name }"
          >{{ name }}</router-link>
        </div>
      </div>

      <div v-if="albums.length" class="container list">
        <div>
          <div class="album-raw center">
            <album-raw
              v-for="album in albums"
              :key="album.ui"
              :album="album"
            />
          </div>
        </div>
      </div>
    </template>

  </div>
</template>

<script>
import { mapStores } from "pinia";
import trackRow from "./track-row.vue";
import albumRaw from "./album-raw.vue";
import { useDataStore } from "./store-data.js";
import { usePlayerStore } from "./store-player.js";

export default {
  name: "Artist",
  components: { trackRow, albumRaw },
  props: {
    artistName: { type: String, required: true },
  },

  inject: ["root"],

  data: () => ({
    tracksLimit: 50,
  }),

  computed: {
    ...mapStores(useDataStore, usePlayerStore),

    loading() {
      return !this.dataStore.ready;
    },

    artist() {
      if (!this.dataStore.ready || !this.artistName) return null;
      const needle = this.artistName.toLowerCase();
      return (
        this.dataStore.all.artist.find((a) => {
          if (!a) return false;
          if (a.name && a.name.toLowerCase() === needle) return true;
          if (a.aka && new RegExp(this.artistName, "i").test(a.aka)) return true;
          return false;
        }) || null
      );
    },

    albums() {
      if (!this.artist) return [];
      const id = this.artist.id;
      return this.dataStore.all.album.filter((album) =>
        album.tk.some((track) => track.a.includes(id)),
      );
    },

    tracks() {
      if (!this.artist) return [];
      const id = this.artist.id;
      const tracks = [];
      for (const album of this.albums) {
        for (const track of album.tk) {
          if (track.a.includes(id)) tracks.push(track);
        }
      }
      return tracks.sort((a, b) => (b.p || 0) - (a.p || 0));
    },

    visibleTracks() {
      return this.tracks.slice(0, this.tracksLimit);
    },

    /**
     * Years this artist has albums in, compressed:
     * `[1990, 1999, ..., 2011]` → `["1990", "1999-2011"]`.
     *
     * Each `album.yr` is an array of years (already deduped + sorted by
     * sw-album.js / index.js fallback). We flatten across albums, dedupe
     * again at the artist level, then run the compression.
     */
    artistYear() {
      const years = new Set();
      for (const album of this.albums) {
        if (Array.isArray(album.yr)) {
          for (const y of album.yr) {
            if (y) years.add(y);
          }
        }
      }
      return this.dataStore.yearRanges(Array.from(years));
    },

    trackPlays() {
      return this.tracks.reduce((sum, t) => sum + (parseInt(t.p) || 0), 0);
    },

    trackCount() {
      return this.tracks.length;
    },

    albumCount() {
      return this.albums.length;
    },

    trackDuration() {
      return this.dataStore.trackDuration(
        this.tracks.map((t) => t.d),
      );
    },

    recommended() {
      if (!this.artist) return [];
      const myId = this.artist.id;
      const idSet = new Set();
      for (const track of this.tracks) {
        for (const aid of track.a) {
          if (aid > 1 && aid !== myId) idSet.add(aid);
        }
      }
      return this.resolveArtistNames(idSet);
    },

    related() {
      if (!this.artist) return [];
      const myId = this.artist.id;
      const recommendedIds = new Set();
      for (const track of this.tracks) {
        for (const aid of track.a) {
          if (aid !== myId) recommendedIds.add(aid);
        }
      }

      const relatedIds = new Set();
      for (const album of this.albums) {
        for (const track of album.tk) {
          for (const aid of track.a) {
            if (
              aid > 1 &&
              aid !== myId &&
              !recommendedIds.has(aid)
            ) {
              relatedIds.add(aid);
            }
          }
        }
      }
      return this.resolveArtistNames(relatedIds);
    },
  },

  methods: {
    resolveArtistNames(idSet) {
      const useAka =
        this.dataStore.utf8(this.artistName) ||
        (this.artist.l && this.artist.l.includes(2));

      return Array.from(idSet)
        .map((id) => this.dataStore.all.artist.find((a) => a.id === id))
        .filter(Boolean)
        .sort((a, b) => (b.plays || 0) - (a.plays || 0))
        .map((a) => (useAka && a.aka ? a.aka : a.name));
    },

    playArtist() {
      this.playerStore.playAll(this.tracks);
    },

    showMore() {
      this.tracksLimit = Math.min(
        this.tracksLimit + 9,
        this.tracks.length,
      );
    },
  },
};
</script>

<style scoped>
.z-not-found {
  text-align: center;
  padding: 48px 16px;
}
.z-not-found p {
  margin-top: 12px;
}
</style>
