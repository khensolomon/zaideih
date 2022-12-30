export default {
	name: "Home",
	data: () => ({
		// artists: {
		// 	all: [],
		// 	zola: [],
		// 	myanmar: [],
		// 	mizo: [],
		// 	falam: []
		// },
		popularArtist: {}
	}),
	inject: ["root", "dataStore", "storageStore"],
	// methods: {},
	// computed: {},
	created() {
		// console.log("home.created");
		// console.log("layout.$parent.dataStore", this.$parent.testDelete);
		// this.dataStore.increment();
		// console.log("layout.dataStore.searchAt", this.dataStore.searchAt);
		// console.log("layout.created=1", this.dataStore.count);
		// console.log("home.created=1", this.dataStore.count);
		var artists = this.dataStore.all.artist
			.filter(e => e.id > 1)
			.sort((a, b) => (a.plays < b.plays ? 1 : -1));

		// this.artists.zola = artists.filter(
		//   e=> e.lang.find(i=>i == 1)
		// ).slice(0, 10);

		// this.artists.myanmar = artists.filter(
		//   e=> e.lang.find(i=>i == 2) && !this.artists.zola.find(i=>i.id == e.id)
		// ).slice(0, 10);

		// this.artists.mizo = artists.filter(
		//   e=>e.lang.find(i=>i == 3) && !this.artists.zola.find(i=>i.id == e.id)
		// ).slice(0, 10);
		// this.artists.falam = artists.filter(
		//   e=>e.lang.find(i=>i == 4) && !this.artists.zola.find(i=>i.id == e.id)
		// ).slice(0, 10);

		// var artists = this.all.artist.filter(e=>e.id > 1).sort((a, b) => (a.plays < b.plays) ? 1 : -1);
		// artists.slice(0, 10).forEach((e)=>{
		//   var id = e.id;
		//   console.log(e)
		//   this.artist[id]
		// })

		// var most = id =>
		// 	Object.values(this.popularArtist).filter(e => e.find(i => i.id == id));

		this.dataStore.all.lang.forEach(l => {
			this.popularArtist[l.id] = artists
				.filter(
					a => a.lang[0] == l.id
					// a=>a.lang.find(i=>i == l.id) && most(a.id).length == 0
				)
				.slice(0, 15);
		});
	}

	// setup() {}
};
