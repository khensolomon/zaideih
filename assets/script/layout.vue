<template>
  <div>
    <div v-if="ready" class="zd primary">
      <div class="bar">
        <div>
          <div class="menu">
            <ul class="panel">
              <li class="icon-panel">Zaideih</li>
            </ul>
            <ul class="nav">
              <li>
                <router-link :to="{ path: '/' }" class="home icon-home-">
                  <span>Home</span>
                </router-link>
              </li>
              <li>
                <router-link :to="{ path: '/artist' }" class="icon-artist-">
                  <span>Artist</span>
                </router-link>
              </li>
              <router-link
                :to="{ path: '/album' }"
                class="icon-album-"
                v-slot="{ isActive, href, navigate }"
              >
                <li :class="{ active: isActive }">
                  <a :href="href" @click="navigate">
                    <span>Album</span>
                  </a>
                </li>
              </router-link>
              <router-link
                :to="{ path: '/queue' }"
                :data-count="playerStore.queueCount"
                class="icon-list-bullet-"
                v-slot="{ isActive, href, navigate }"
              >
                <li :class="{ active: isActive }">
                  <a :href="href" @click="navigate">
                    <span>Queue</span>
                  </a>
                </li>
              </router-link>
            </ul>
          </div>

          <div class="opt">
            <ul>
              <li class="icon-config-"></li>
            </ul>
          </div>
        </div>
      </div>

      <div class="sch">
        <form @submit.prevent="search" name="search" method="get" action="#">
          <div class="logo">
            <span>Zaideih</span>
          </div>
          <div class="type">
            <input
              v-model="dataStore.searchQuery"
              placeholder=" Type here..."
              type="search"
            />
          </div>
          <div class="option">
            <input v-model="dataStore.searchAt" value="title" id="title" type="radio" />
            <label for="title" title="Title" class="icon-track">Title</label>
            <input v-model="dataStore.searchAt" value="artist" id="artist" type="radio" />
            <label for="artist" title="Artist" class="icon-artist">Artist</label>
            <input v-model="dataStore.searchAt" value="album" id="album" type="radio" />
            <label for="album" title="Album" class="icon-album">Album</label>
            <input v-model="dataStore.searchAt" value="avekpi" id="avekpi" type="radio" />
            <label for="avekpi" title="All" class="icon-database">All</label>
          </div>
          <div class="submit">
            <button type="submit" title="Search" class="icon-search"></button>
          </div>
        </form>
      </div>

      <router-view class="wrapper"></router-view>
    </div>

    <div v-else class="zd fullscreen loading">
      <p class="t2 trial">one moment</p>
    </div>

    <div class="zd player">
      <Player />
    </div>
  </div>
</template>

<script>
import { mapStores } from "pinia";
import Player from "./player.vue";
import { useDataStore } from "./store-data.js";
import { usePlayerStore } from "./store-player.js";

/**
 * Map of route name → which `searchAt` value to default to when the user
 * lands on that route. Routes not in this map fall through to "avekpi"
 * (search all). Per the user's spec: "auto select base on the current
 * page, if not suitable fall back to default (all)".
 */
const SEARCH_AT_BY_ROUTE = {
  "artist-index": "artist",
  artist: "artist",
  album: "album",
};

export default {
  components: { Player },

  provide() {
    return { root: this };
  },

  computed: {
    ...mapStores(useDataStore, usePlayerStore),

    ready() {
      return this.dataStore.ready;
    },
  },

  watch: {
    /**
     * Auto-select the search radio based on the route. Runs on every
     * route change. We only override `searchAt` when it doesn't already
     * match the route's preference — so if the user manually picks a
     * different option, we don't fight them on the same page.
     */
    "$route.name": {
      immediate: true,
      handler(routeName) {
        const preferred = SEARCH_AT_BY_ROUTE[routeName] || "avekpi";
        // Only auto-set on initial entry to a relevant route. We track
        // the last route we auto-set on so we don't overwrite manual
        // changes the user made within the same page.
        if (this._lastAutoRoute !== routeName) {
          this.dataStore.searchAt = preferred;
          this._lastAutoRoute = routeName;
        }
      },
    },
  },

  methods: {
    /**
     * Submit the search. Always navigates to /search with the current
     * query and searchAt as URL params. Search results live on /search;
     * /artist and /album are pure browsing pages.
     */
    search() {
      const q = (this.dataStore.searchQuery || "").trim();
      if (!q) return;
      this.$router.push({
        path: "/search",
        query: { q, at: this.dataStore.searchAt },
      });
    },

    // --- Helpers used by other views (kept on `root` for now) ---
    // Candidates for moving to a `utils/track.js` module later.

    artistName(track) {
      if (!track || !track.a) return [];
      return track.a.map((id) => {
        const artist = this.dataStore.all.artist[id];
        if (!artist) return id;
        return artist.aka && this.dataStore.utf8(track.t)
          ? artist.aka
          : artist.name;
      });
    },

    albumArtist(album) {
      const ids = [...new Set([].concat(...album.tk.map((t) => t.a)))];
      return ids
        .map((id) => this.dataStore.all.artist[id])
        .filter(Boolean)
        .map((a) => (album.lg === 2 && a.aka ? a.aka : a.name));
    },

    albumGenre(album) {
      return album.gr.map((id) => this.dataStore.all.genre[id]?.name).filter(Boolean);
    },

    albumByTrackId(id) {
      return this.dataStore.all.album.find((album) =>
        album.tk.some((t) => t.i === id)
      );
    },

    playAll(tracks) {
      this.playerStore.playAll(tracks);
    },

    playAlbum(ui) {
      const album = this.dataStore.all.album.find((a) => a.ui === ui);
      if (album) this.playAll(album.tk);
    },
  },

  async created() {
    await this.$parent.init();

    // Pre-populate the queue with a few popular tracks (existing behaviour).
    this.dataStore.all.album
      .filter((a) => a.lg === 2)
      .slice(0, 10)
      .forEach((album) => {
        album.tk
          .slice()
          .sort((a, b) => (a.p < b.p ? 1 : -1))
          .slice(0, 2)
          .forEach((track) => {
            this.playerStore.addToQueue(track);
          });
      });
  },
};
</script>
