import { defineStore } from "pinia";

import Timer from "./timer.js";
import Digit from "./digit.js";

export const useDataStore = defineStore("data", {
	state: () => ({
		ready: false,
		loading: true,
		message: null,
		error: null,
		count: 0,

		meta: { album: 0, artist: 0, genre: 0, lang: [] },
		all: {
			// data:[],
			album: [],
			genre: [],
			artist: [],
			lang: [],
		},
		total: {
			track: 0,
			album: 0,
			artist: 0,
		},
		searchQuery: "",
		searchAt: "avekpi",
		queueActive: {},
		// testPlayerEvent:[],
		api: {
			// audio_test:'*/yalp/oidua/ipa/moc.hiediaz//:ptth'.split("").reverse().join(""),
			// audio: "1l=v1d?*/oidua/ipa/moc.hiediaz.www//:sptth"
			// 	.split("")
			// 	.reverse()
			// 	.join("")
			audio: "*/oidua/ipa/".split("").reverse().join(""),
		},
		queue: [
			{
				a: ["Jacky Zheng"],
				d: "4:25",
				i: "tmp/million-times.mp3",
				p: 224564563,
				t: "Million Times",
			},
			{
				a: ["Katie Melua"],
				d: "3.41",
				i: "tmp/Katie-Melua-If-You-Were-A-Sailboat.mp3",
				p: 94564563,
				t: "If You Were A Sailboat",
			},
			{
				a: ["M2M"],
				d: "3.53",
				i: "tmp/m2m-the_day_you_went_away.mp3",
				p: 104564563,
				t: "The day you went away",
			},
			{
				a: ["စိုးသူ"],
				d: "3.59",
				i: "tmp/soe-tho_kyi_phyy_bar_doh.mp3",
				p: 44564563,
				t: "ကြည်ဖြူပါတော့",
			},
			{
				a: ["Irene Zin Mar Myint"],
				d: "3.59",
				i: "tmp/Irene-Zin-Mar-Myint_melody_2013.mp3",
				p: 345643,
				t: "???",
			},
			{
				a: ["Cyndi"],
				d: "3.53",
				i: "tmp/cyndi-first-love.mp3",
				p: 4564563,
				t: "First love",
			},
			{
				a: ["ကြိုးကြာ", "စင်ဒီ"],
				d: "3.53",
				i: "tmp/chit-thaw-nit.mp3",
				p: 213463,
				t: "ချစ်သောနေ့",
			},
			{
				a: ["Rod Stewart"],
				d: "4:51",
				i: "tmp/rod-stewart-sailing.mp3",
				p: 127237368,
				t: "Sailing",
			},
			{
				a: ["Ruben"],
				d: "2:59",
				i: "tmp/Ruben-Dear-God.mp3",
				p: 6775752667,
				t: "Dear God",
			},
		],
		playing: false,
		activeLang: null,
		limitShow: 30,

		// Artists
		artistActiveLang: null,
		artistLimitShow: 30,
		artistTracksLimit: 50,
		artist: {},
		albums: [],
		tracks: [],
		artistRelatedIndex: [],
		artistRecommendedIndex: [],

		// Albums
		albumLimit: 9,
		albumActiveLang: null,

		// Queue
		queueTrackLimit: 10,

		// Music -> search
		// searchAlbumLimit
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
	getters: {
		doubleCount: (state) => state.count * 2,
		getterTest: (state) => state.queue,
		totalQueue: (state) => state.queue.length,
	},
	actions: {
		utf8(str) {
			// for (var i = 0; i < str.length; i++) if (str.charCodeAt(i) > 127) return true;
			// return false;
			return /[^\u0000-\u007f]/.test(str);
		},

		timeFormat(e) {
			if (!e) return "00:00";
			let hhmmss = new Date(e * 1000).toISOString().substr(11, 8);
			return hhmmss.indexOf("00:") === 0 ? hhmmss.substr(3) : hhmmss;
		},

		digitShortenTesting(digit) {
			return new Digit(digit).shorten();
		},

		// artist

		trackDuration(e) {
			return new Timer(e).shorten();
			// return new Timer(e.map(track => track.d)).format();
		},

		// album

		albumDuration(album) {
			try {
				return new Timer(album.tk.map((e) => e.d)).format();
			} catch (error) {
				console.log("time error", album.ab);
			}
		},
		// general
		async randamQueue() {
			return this.queue[Math.floor(Math.random() * this.queue.length)];
		},

		arrayComparer(otherArray) {
			return function (current) {
				return (
					otherArray.filter(function (other) {
						return other == current;
						// return other.toString().toLowerCase()  == current.toString().toLowerCase()
						// return other.value == current.value && other.display == current.display
					}).length == 0
				);
			};
		},
		arrayComparerID_notInUseds(otherArray) {
			return function (current) {
				return (
					otherArray.filter(function (other) {
						return other.id == current.id;
					}).length == 0
				);
			};
		},
		arrayComparerUI_notInUseds(otherArray) {
			return function (current) {
				return (
					otherArray.filter(function (other) {
						return other.ui == current.ui;
					}).length == 0
				);
			};
		},
		artistAlphabetically(filters) {
			var row = this.all.artist.filter(filters).reduce((e, k) => {
				// @ts-ignore
				let cluster = k.name[0].toUpperCase();
				if (!e[cluster]) {
					e[cluster] = { cluster: cluster, artists: [] };
				}
				e[cluster].artists.push(k);
				return e;
			}, {});
			return Object.values(row).sort((a, b) =>
				a.cluster > b.cluster ? 1 : -1
			);
		},

		artistCategory() {
			return this.artistAlphabetically(
				(artist) =>
					artist.id > 1 &&
					artist.lang.find((e) =>
						this.artistActiveLang ? e == this.artistActiveLang : true
					)
				// artist=> artist.id > 1 && artist.lang.find(e=> this.artistActiveLang?e == this.artistActiveLang:true) && artist.plays > 3000
				// artist=> artist.id > 1 && this.artistActiveLang?artist.lang.find(e=>e == this.artistActiveLang):true
			);
			// return this.$.artistAlphabetically(
			//   artist=> artist.id > 1 && artist.lang && artist.lang.find(
			//     e => e == 1
			//   )
			// );
		},
	},
});
