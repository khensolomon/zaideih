import { defineStore } from "pinia";

import Timer from "./timer.js";
import Digit from "./digit.js";

/**
 * Data store — owns library data (artists, albums, tracks, genres, langs)
 * and search/filter UI state.
 *
 * What used to live here but moved out:
 *   - queue, playing  → store-player.js
 *
 * Things that should probably move out next pass:
 *   - timeFormat, utf8, digitShortenTesting, trackDuration, albumDuration
 *     are pure utility methods. They belong in `utils/format.js`, not in
 *     a Pinia store. Left here for now to keep the diff focused.
 *   - artistAlphabetically / artistCategory are view-layer concerns;
 *     candidates for a useArtistView() composable.
 */
export const useDataStore = defineStore("data", {
	state: () => ({
		ready: false,
		loading: true,
		message: null,
		error: null,

		meta: { album: 0, artist: 0, genre: 0, lang: [] },
		all: {
			album: [],
			genre: [],
			artist: [],
			lang: [],
			artistType: [
				{ name: "unknown" },
				{ name: "various" },
				{ name: "male" },
				{ name: "female" },
				{ name: "duet" },
			],
		},
		total: {
			track: 0,
			album: 0,
			artist: 0,
		},
		searchQuery: "",
		searchAt: "avekpi",

		// API endpoints. The audio URL must point at the audio Worker — the
		// `*` placeholder is replaced with the track ID at request time.
		// (Previously this was reversed-string "obfuscated"; that didn't
		// hide anything from anyone reading the source, so it's gone now.)
		api: {
			audio: "//api.zaideih.com/audio/*",
		},

		activeLang: null,
		limitShow: 30,

		// Artist view
		artistActiveLang: null,
		artistLimitShow: 30,
		artistTracksLimit: 50,
		artist: {},
		albums: [],
		tracks: [],
		artistRelatedIndex: [],
		artistRecommendedIndex: [],

		// Album view
		albumLimit: 9,
		albumActiveLang: null,

		// Queue view
		queueTrackLimit: 10,

		// Search view
		searchAlbumLimit: 9,
		searchAlbumRelatedLimit: 9,
		searchAlbumRecommendedLimit: 9,
		searchTrackLimit: 9,
		searchTracksByArtistLimit: 9,
		searchResults: [],
		searchArtistList: [],
		searchTracksByArtistName: "",
		searchTrackList: [],
		searchAlbumList: [],
	}),

	getters: {},

	actions: {
		// --- Formatting helpers ------------------------------------------
		// (Candidates for a utils/format.js module.)

		utf8(str) {
			return /[^\u0000-\u007f]/.test(str);
		},

		timeFormat(seconds) {
			if (!seconds) return "00:00";
			const hhmmss = new Date(seconds * 1000).toISOString().substr(11, 8);
			return hhmmss.indexOf("00:") === 0 ? hhmmss.substr(3) : hhmmss;
		},

		digitShortenTesting(digit) {
			return new Digit(digit).shorten();
		},

		trackDuration(seconds) {
			return new Timer(seconds).shorten();
		},

		albumDuration(album) {
			try {
				return new Timer(album.tk.map((e) => e.d)).format();
			} catch (err) {
				console.warn("albumDuration failed for", album.ab, err);
				return "";
			}
		},

		// --- Array helpers (legacy) --------------------------------------

		arrayComparer(otherArray) {
			return (current) =>
				otherArray.filter((other) => other === current).length === 0;
		},

		// --- Artist view helpers -----------------------------------------

		artistAlphabetically(filterFn) {
			const grouped = this.all.artist.filter(filterFn).reduce((acc, artist) => {
				const cluster = artist.name[0].toUpperCase();
				if (!acc[cluster]) acc[cluster] = { cluster, artists: [] };
				acc[cluster].artists.push(artist);
				return acc;
			}, {});
			return Object.values(grouped).sort((a, b) =>
				a.cluster > b.cluster ? 1 : -1
			);
		},

		artistCategory() {
			return this.artistAlphabetically(
				(artist) =>
					artist.id > 1 &&
					artist.l.find((e) =>
						this.artistActiveLang ? e === this.artistActiveLang : true
					)
			);
		},
	},
});
