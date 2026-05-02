<template>
  <div class="z-artist-index">

    <div class="z-hero">
      <p class="z-subtitle">{{ totalArtistsLabel }}</p>
      <h1 class="t2">Artists</h1>
    </div>

    <div class="show-lang">
      <a
        v-for="lang in languageOptions"
        :key="lang.id ?? 'all'"
        href="#"
        :class="{ 'router-link-exact-active': activeLang === lang.id }"
        @click.prevent="activeLang = lang.id"
      >{{ lang.label }}</a>
    </div>

    <div class="z-types">
      <a
        v-for="opt in typeOptions"
        :key="opt.value ?? 'all'"
        href="#"
        :class="{ active: activeType === opt.value }"
        @click.prevent="activeType = opt.value"
      >{{ opt.label }}<span v-if="opt.count" class="z-type-count">{{ opt.count }}</span></a>
    </div>

    <div class="z-sort">
      <span class="z-sort-label">Sort by:</span>
      <a
        v-for="opt in sortOptions"
        :key="opt.value"
        href="#"
        :class="{ active: sortBy === opt.value }"
        @click.prevent="sortBy = opt.value"
      >{{ opt.label }}</a>
    </div>

    <div v-if="featuredArtists.length" class="z-featured">
      <h2 class="z-section-label">Most played{{ activeLang ? ' · ' + activeLangLabel : '' }}{{ activeType !== null ? ' · ' + activeTypeLabel : '' }}</h2>
      <div class="z-featured-grid">
        <router-link
          v-for="artist in featuredArtists"
          :key="artist.id"
          :to="{ name: 'artist', params: { artistName: artist.name } }"
          class="z-featured-card"
        >
          <div class="z-avatar" :style="avatarStyle(artist)">
            <span>{{ initials(artist.name) }}</span>
          </div>
          <div class="z-featured-meta">
            <p class="z-featured-name">{{ artist.name }}</p>
            <p class="z-featured-stats">
              {{ formatPlays(artist.plays) }} plays · {{ artist.track || 0 }} tracks
            </p>
          </div>
        </router-link>
      </div>
    </div>

    <nav class="z-alphabet" aria-label="Jump to letter">
      <!--
        These are NOT navigation links — they jump within the page. We
        bind to a real `#letter-X` href so the link is shareable and
        right-clickable, but intercept the click and scroll the section
        into view via JS. Without preventDefault, vue-router treats the
        hash as a navigation and may bounce the user to / (home).
      -->
      <a
        v-for="letter in alphabet"
        :key="letter"
        :href="lettersWithArtists.has(letter) ? '#letter-' + letter : null"
        :class="{ disabled: !lettersWithArtists.has(letter) }"
        :aria-disabled="!lettersWithArtists.has(letter)"
        @click="onLetterClick($event, letter)"
      >{{ letter }}</a>
    </nav>

    <div v-if="visibleByLetter.length" class="z-letter-sections">
      <section
        v-for="group in visibleByLetter"
        :key="group.letter"
        :id="'letter-' + group.letter"
        class="z-letter-group"
      >
        <header>
          <h3>{{ group.letter }}</h3>
          <span>{{ group.artists.length }} {{ group.artists.length === 1 ? 'artist' : 'artists' }}</span>
        </header>
        <div class="z-artist-grid">
          <router-link
            v-for="artist in group.artists"
            :key="artist.id"
            :to="{ name: 'artist', params: { artistName: artist.name } }"
            class="z-artist-row"
          >
            <div class="z-avatar small" :style="avatarStyle(artist)">
              <span>{{ initials(artist.name) }}</span>
            </div>
            <div class="z-artist-meta">
              <p class="z-artist-name">{{ displayName(artist) }}</p>
              <p class="z-artist-sub">
                {{ artist.track || 0 }} {{ artist.track === 1 ? 'track' : 'tracks' }}
              </p>
            </div>
            <span class="z-artist-plays">{{ formatPlays(artist.plays) }}</span>
          </router-link>
        </div>
      </section>
    </div>

    <div v-else class="z-empty">
      <p>No artists match these filters.</p>
    </div>

  </div>
</template>

<script>
import { mapStores } from "pinia";
import { useDataStore } from "./store-data.js";
import {
  avatarColor,
  avatarInitials,
  isFeaturedBlocked,
  ARTIST_TYPES,
  ARTIST_TYPE_LABELS,
} from "./avatar.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
const FEATURED_COUNT = 6;

export default {
  name: "ArtistIndex",

  inject: ["root"],

  data: () => ({
    activeLang: null,
    activeType: null,
    sortBy: "plays",
  }),

  computed: {
    ...mapStores(useDataStore),

    allArtists() {
      return this.dataStore.all.artist.filter((a) => a && a.id > 0);
    },

    languageOptions() {
      const langs = this.dataStore.all.lang || [];
      return [
        { id: null, label: "All" },
        ...langs.map((l) => ({ id: l.id, label: l.name })),
      ];
    },

    activeLangLabel() {
      const found = this.languageOptions.find((o) => o.id === this.activeLang);
      return found ? found.label : "";
    },

    typeOptions() {
      const langFiltered = this.byLang(this.allArtists);
      const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
      for (const a of langFiltered) {
        const t = Number.isInteger(a.type) ? a.type : 0;
        if (t in counts) counts[t]++;
      }
      return [
        { value: null, label: "All", count: langFiltered.length },
        { value: ARTIST_TYPES.FEMALE, label: ARTIST_TYPE_LABELS[3], count: counts[3] },
        { value: ARTIST_TYPES.MALE, label: ARTIST_TYPE_LABELS[2], count: counts[2] },
        { value: ARTIST_TYPES.GROUP, label: ARTIST_TYPE_LABELS[1], count: counts[1] },
        { value: ARTIST_TYPES.UNKNOWN, label: ARTIST_TYPE_LABELS[0], count: counts[0] },
      ];
    },

    activeTypeLabel() {
      if (this.activeType === null) return "";
      return ARTIST_TYPE_LABELS[this.activeType] || "";
    },

    sortOptions() {
      return [
        { value: "plays", label: "Most played" },
        { value: "name", label: "A → Z" },
        { value: "tracks", label: "Most tracks" },
      ];
    },

    filteredByLang() {
      return this.byLang(this.allArtists);
    },

    filteredArtists() {
      const list = this.filteredByLang;
      if (this.activeType === null) return list;
      return list.filter((a) => {
        const t = Number.isInteger(a.type) ? a.type : 0;
        return t === this.activeType;
      });
    },

    featuredArtists() {
      const list = this.filteredArtists
        .filter((a) => !isFeaturedBlocked(a.name))
        .filter((a) => (a.plays || 0) > 0);

      const sorted = list.slice().sort(
        (a, b) => (b.plays || 0) - (a.plays || 0),
      );
      return sorted.slice(0, FEATURED_COUNT);
    },

    sortedArtists() {
      const list = this.filteredArtists.slice();
      switch (this.sortBy) {
        case "name":
          return list.sort((a, b) =>
            (a.name || "").localeCompare(b.name || ""),
          );
        case "tracks":
          return list.sort((a, b) => (b.track || 0) - (a.track || 0));
        case "plays":
        default:
          return list.sort((a, b) => (b.plays || 0) - (a.plays || 0));
      }
    },

    visibleByLetter() {
      const groups = new Map();
      for (const artist of this.sortedArtists) {
        const letter = artist.fl || "#";
        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push(artist);
      }
      return ALPHABET.filter((l) => groups.has(l)).map((l) => ({
        letter: l,
        artists: groups.get(l),
      }));
    },

    lettersWithArtists() {
      return new Set(this.visibleByLetter.map((g) => g.letter));
    },

    alphabet() {
      return ALPHABET;
    },

    totalArtistsLabel() {
      const total = this.allArtists.length;
      const filtered = this.filteredArtists.length;
      if (filtered !== total) {
        return `${filtered.toLocaleString()} of ${total.toLocaleString()} artists`;
      }
      return `${total.toLocaleString()} artists`;
    },
  },

  methods: {
    byLang(list) {
      if (!this.activeLang) return list;
      return list.filter(
        (a) => Array.isArray(a.l) && a.l.includes(this.activeLang),
      );
    },

    avatarStyle(artist) {
      let ramp;
      if (typeof artist.ck === "number") {
        ramp = avatarColor(artist.ck);
      } else {
        ramp = avatarColor(artist.id);
      }
      return {
        backgroundColor: ramp.bg,
        color: ramp.fg,
      };
    },

    initials(name) {
      return avatarInitials(name);
    },

    displayName(artist) {
      if (artist.aka && this.dataStore.utf8(artist.name)) {
        return artist.aka;
      }
      return artist.name;
    },

    formatPlays(n) {
      const plays = Number(n) || 0;
      return this.dataStore.digitShortenTesting(plays);
    },

    /**
     * Handle a click on a letter in the sticky alphabet bar.
     *
     * preventDefault stops two unwanted things:
     *   1. The browser's default hash-link behaviour (which jumps
     *      instantly without a smooth scroll, and also dumps the
     *      letter section under the sticky bar — `scroll-margin-top`
     *      mostly helps but smooth scroll is nicer).
     *   2. Any Vue Router interpretation of the hash. Even though
     *      Vue Router shouldn't intercept anchor-only clicks, in
     *      some configurations it does and the user ends up at "/".
     *
     * We then call scrollIntoView on the section ourselves and update
     * the URL hash via replaceState (so the back button doesn't get
     * polluted with one history entry per letter clicked).
     */
    onLetterClick(event, letter) {
      event.preventDefault();

      if (!this.lettersWithArtists.has(letter)) return;

      const target = document.getElementById("letter-" + letter);
      if (!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "start" });

      // Update URL so the user can copy/share the deep link, without
      // adding a history entry for every letter clicked.
      const newUrl = `${window.location.pathname}${window.location.search}#letter-${letter}`;
      window.history.replaceState(window.history.state, "", newUrl);
    },
  },

  mounted() {
    // If the page was loaded with a #letter-X hash already in the URL
    // (e.g. someone shared a deep link), scroll there once the page
    // has rendered.
    const hash = window.location.hash;
    if (hash && hash.startsWith("#letter-")) {
      this.$nextTick(() => {
        const target = document.getElementById(hash.slice(1));
        if (target) {
          target.scrollIntoView({ behavior: "auto", block: "start" });
        }
      });
    }
  },
};
</script>

<style lang="scss" scoped>
@use "sass:color";

$bg: color.adjust(gray, $lightness: 15%);
$surface: color.adjust(#595959, $lightness: -5%);
$border: color.adjust($bg, $lightness: -8%);
$text: color.adjust(#f0f0f0, $lightness: -5%);
$text-dim: color.adjust(#f0f0f0, $lightness: -25%);
$text-mute: color.adjust(#f0f0f0, $lightness: -45%);

.z-artist-index {
  padding: 16px 24px 32px;
}

.z-hero {
  text-align: center;
  padding: 24px 0 16px;
  .z-subtitle {
    font-size: 13px;
    color: $text-mute;
    margin: 0 0 4px;
    letter-spacing: 0.04em;
  }
  h1 {
    margin: 0;
  }
}

.show-lang {
  text-align: center;
  margin-bottom: 8px;
}

.z-types {
  text-align: center;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
  a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    border-radius: 100px;
    background: color.adjust($bg, $lightness: 7%);
    color: $text-mute;
    text-decoration: none;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    transition: all 0.2s ease;
    &.active {
      background: color.adjust($bg, $lightness: -20%);
      color: $text-dim;
    }
    &:hover:not(.active) {
      color: $text-dim;
    }
  }
  .z-type-count {
    font-size: 11px;
    opacity: 0.7;
    text-transform: none;
    letter-spacing: 0;
    padding: 1px 6px;
    border-radius: 100px;
    background: rgba(0, 0, 0, 0.15);
  }
}

.z-sort {
  text-align: center;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  .z-sort-label {
    color: $text-mute;
  }
  a {
    padding: 4px 14px;
    border-radius: 100px;
    color: $text-mute;
    text-decoration: none;
    font-size: 12px;
    transition: all 0.2s ease;
    &.active {
      background: color.adjust($bg, $lightness: -20%);
      color: $text;
    }
    &:hover:not(.active) {
      color: $text-dim;
    }
  }
}

.z-section-label {
  font-size: 12px;
  font-weight: normal;
  color: $text-mute;
  margin: 0 0 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.z-featured {
  margin-bottom: 32px;
}

.z-featured-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.z-featured-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: color.adjust($bg, $lightness: -8%);
  border: 1px solid $border;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: all 0.2s ease;
  &:hover {
    background: color.adjust($bg, $lightness: -12%);
    transform: translateY(-1px);
  }
}

.z-featured-meta {
  flex: 1;
  min-width: 0;
}

.z-featured-name {
  font-size: 16px;
  margin: 0 0 3px;
  color: $text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.z-featured-stats {
  font-size: 12px;
  margin: 0;
  color: $text-mute;
}

.z-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 500;
  flex-shrink: 0;
  text-shadow: 0 1px 1px rgba(0,0,0,0.15);
  &.small {
    width: 30px;
    height: 30px;
    font-size: 12px;
  }
}

.z-alphabet {
  position: sticky;
  top: 0;
  background: $bg;
  padding: 10px 0;
  margin: 16px -24px;
  border-top: 1px solid $border;
  border-bottom: 1px solid $border;
  display: flex;
  gap: 1px;
  flex-wrap: wrap;
  justify-content: center;
  z-index: 5;
  a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    font-size: 13px;
    color: $text-dim;
    text-decoration: none;
    border-radius: 4px;
    font-weight: 500;
    transition: background 0.15s ease;
    cursor: pointer;
    &.disabled {
      color: $text-mute;
      cursor: default;
      pointer-events: none;
      font-weight: normal;
      opacity: 0.5;
    }
    &:hover:not(.disabled) {
      background: color.adjust($bg, $lightness: -8%);
      color: $text;
    }
  }
}

.z-letter-group {
  margin-bottom: 24px;
  // Push the letter section's start below the sticky alphabet bar
  // when scrolled into view via anchor click.
  scroll-margin-top: 60px;
  > header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid color.adjust($bg, $lightness: -8%);
    h3 {
      font-size: 28px;
      font-weight: lighter;
      margin: 0;
      color: $text-dim;
      line-height: 1;
      text-shadow: 0 1px 1px color.adjust($bg, $lightness: -25%);
    }
    span {
      font-size: 12px;
      color: $text-mute;
    }
  }
}

.z-artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 4px 16px;
}

.z-artist-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s ease;
  &:hover {
    background: color.adjust($bg, $lightness: -8%);
    .z-artist-name {
      color: $text;
    }
  }
}

.z-artist-meta {
  flex: 1;
  min-width: 0;
}

.z-artist-name {
  font-size: 14px;
  margin: 0;
  color: $text-dim;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.z-artist-sub {
  font-size: 11px;
  color: $text-mute;
  margin: 0;
}

.z-artist-plays {
  font-size: 11px;
  color: $text-mute;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.z-empty {
  text-align: center;
  padding: 48px 16px;
  color: $text-mute;
  font-size: 14px;
}

@media (max-width: 641px) {
  .z-artist-index { padding: 8px 12px 24px; }
  .z-alphabet { margin: 16px -12px; }
  .z-featured-grid { grid-template-columns: 1fr; }
  .z-artist-grid { grid-template-columns: 1fr; }
}
</style>