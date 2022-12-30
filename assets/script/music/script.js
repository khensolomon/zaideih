// @ts-ignore
import trackRow from "../components/track-row.vue";
// @ts-ignore
import albumRaw from "../components/album-raw.vue";

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
