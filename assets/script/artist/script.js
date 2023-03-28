// @ts-ignore
import trackRow from "../components/track-row.vue";
// @ts-ignore
// import albumRow from "../components/album-row.vue";
// @ts-ignore
import albumRaw from "../components/album-raw.vue";

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
							this.dataStore.artist.lang.find((e) => e == 2)) &&
						e.aka
							? e.aka
							: e.name
					// e=>this.dataStore.utf8(this.artistName) && e.aka?e.aka:e.name
					// e=>this.dataStore.artist.lang.find(e=>e == 2) && e.aka?e.aka:e.name
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
