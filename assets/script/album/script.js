// @ts-ignore
import trackRow from "../components/track-row.vue";
// @ts-ignore
import albumRaw from "../components/album-raw.vue";

// album-box, album-detail album-list, album-row
export default {
	name: "Album",
	props: ["albumId", "language"],

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
	// watch: {},
	methods: {
		// playAlbum(ui){
		//   var albums = this.$parent.old.filter((e) => {
		//     return e.ui == ui;
		//   });
		//   this.$parent.queue=[];
		//   for (const album of albums) {
		//     for (const trk of album.tk) {
		//       this.$parent.queue.push(trk);
		//     }
		//   }
		// },
	},
	// filters:{
	//   sumplay: function(e){
	//     return e.reduce((a, b) => a + parseInt(b.p), 0);
	//   }
	// },
	computed: {
		// $() {
		// 	return this.$parent;
		// },
		albums() {
			return this.dataStore.all.album.filter(e =>
				this.dataStore.albumActiveLang
					? e.lg == this.dataStore.albumActiveLang
					: true
			);
		},
		activeAlbum() {
			if (this.albumId) {
				var lg = this.dataStore.all.lang.find(
					e => e.name.toLowerCase() == this.albumId.toLowerCase()
				);
				if (lg) {
					this.dataStore.albumActiveLang = lg.id;
				} else {
					return this.dataStore.all.album
						.filter(
							e =>
								e.ui == this.albumId ||
								e.ab.toLowerCase() == this.albumId.toLowerCase()
						)
						.filter(
							// e=>e.tk.sort((a, b) => (a.n > b.n) ? 1 : -1)
							e => e.tk
						);
				}
			}
			return [];
		}
	}
	// created() {},
	// beforeMount() {}
	// mounted () {},
};
