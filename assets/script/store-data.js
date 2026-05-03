import { defineStore } from "pinia";

import Timer from "./timer.js";
import Digit from "./digit.js";

/**
 * Data store — owns library data (artists, albums, tracks, genres, langs)
 * and search/filter UI state.
 *
 * What used to live here but moved out:
 *   - queue, playing               → store-player.js
 *   - artist, albums, tracks       → local state in artist.vue
 *   - artistRelatedIndex,          → local computed in artist.vue
 *     artistRecommendedIndex
 *   - artistTracksLimit            → local data in artist.vue
 *
 * Things that should probably move out next pass:
 *   - timeFormat, utf8, digitShortenTesting, trackDuration, albumDuration,
 *     yearRanges are pure utility methods. They belong in `utils/format.js`.
 *     Left here to keep the diff focused.
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

		api: {
			audio: "https://api.zaideih.com/audio/*",
		},

		activeLang: null,
		limitShow: 30,

		artistActiveLang: null,
		artistLimitShow: 30,

		albumLimit: 9,
		albumActiveLang: null,

		queueTrackLimit: 10,

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

		/**
		 * Compress a sorted, unique year array into display strings,
		 * collapsing runs of consecutive years into "start-end" form.
		 *
		 * Examples (with default minRunLength = 3):
		 *   []                                       → []
		 *   [2010]                                   → ["2010"]
		 *   [2010, 2011]                             → ["2010", "2011"]   (run of 2 stays separate)
		 *   [2010, 2011, 2012]                       → ["2010-2012"]
		 *   [1990, 1999, 2000, 2001, 2002]           → ["1990", "1999-2002"]
		 *   [1990, 1999, 2000, 2001, ..., 2011]      → ["1990", "1999-2011"]
		 *   [2000, 2002, 2004]                       → ["2000", "2002", "2004"] (gaps)
		 *
		 * Defensive: filters out non-finite values; sorts + dedupes its
		 * input so callers can pass raw arrays.
		 *
		 * @param {Array<number|string>} years
		 * @param {number} [minRunLength=3]
		 * @returns {string[]}
		 */
		yearRanges(years, minRunLength = 3) {
			if (!Array.isArray(years) || years.length === 0) return [];

			const sorted = [...new Set(
				years.map((y) => Number(y)).filter((y) => Number.isFinite(y)),
			)].sort((a, b) => a - b);

			if (sorted.length === 0) return [];

			const out = [];
			let runStart = sorted[0];
			let runEnd = sorted[0];

			const flush = () => {
				const length = runEnd - runStart + 1;
				if (length >= minRunLength) {
					out.push(`${runStart}-${runEnd}`);
				} else {
					// Emit each year in the short run as its own pill.
					for (let y = runStart; y <= runEnd; y++) out.push(String(y));
				}
			};

			for (let i = 1; i < sorted.length; i++) {
				if (sorted[i] === runEnd + 1) {
					runEnd = sorted[i];
				} else {
					flush();
					runStart = sorted[i];
					runEnd = sorted[i];
				}
			}
			flush();

			return out;
		},

		// --- Array helpers (legacy) --------------------------------------

		arrayComparer(otherArray) {
			return (current) =>
				otherArray.filter((other) => other === current).length === 0;
		},

		// --- Legacy artist alphabet helpers ------------------------------
		// Used by the OLD artist.vue index branch only; safe to remove
		// once nothing else references them.

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
