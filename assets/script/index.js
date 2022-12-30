import { createApp, h } from "vue";
import { createPinia, mapStores } from "pinia";

import axios from "axios";

import { useDataStore } from "./store-data.js";
import { useStorageStore } from "./store-storage.js";

// Cannot find module './layout.vue' or its corresponding type declarations.ts(2307)
// @ts-ignore
import layout from "./layout.vue";
// import layout from "./test.vue";

import router from "./router.js";

const pinia = createPinia();

const app = createApp({
	components: {},
	methods: {
		test() {},
		metadata() {
			var d = {};
			var elHead = document.head.querySelector("[name~=application-name]");
			// var elHead = document.querySelectorAll("[name~=application-name]");

			if (elHead instanceof HTMLElement) {
				d = elHead.dataset;
			}
			// for (const i of Object.keys(d)) this.dataStore.meta[i]=d[i].includes(',')?d[i].split(','):parseInt(d[i]);
			for (const i of Object.keys(this.dataStore.meta))
				if (d.hasOwnProperty(i))
					this.dataStore.meta[i] = d[i].includes(",")
						? d[i].split(",")
						: parseInt(d[i]);
			// await this.$http.get('/api').then(e=>this.dataStore.meta = e.data, e=>this.error = e.statusText);
		},
		async fetch(uri) {
			uri = uri
				.split("")
				.reverse()
				.join("");
			var id = uri.split("/").slice(-1)[0],
				k = id
					.split("")
					.reverse()
					.join("");

			try {
				var o = await this.getItem(k);
				if (o.length == this.dataStore.meta[id]) {
					this.dataStore.all[id] = o;
				} else {
					// NOTE: throw error, so that catch can request a new data. This happen when local storage has no data
					this.error = "error";
					throw "error";
				}
			} catch (error) {
				// NOTE: This happened because local storage is empty or user has modified. So we just simply request fresh data.
				// await this.$http.get(uri).then(
				// 	response => {
				// 		this.dataStore.all[id] = response.data;
				// 	},
				// 	error => {
				// 		this.error = error.statusText;
				// 	}
				// );
				await axios
					.get(uri)
					.then(response => {
						this.dataStore.all[id] = response.data;
					})
					.catch(error => {
						this.error = error.statusText;
					});
				await this.setItem(k, this.dataStore.all[id]);
			}
		},
		async init() {
			this.metadata();
			await this.fetch("tsitra/ipa/");
			await this.fetch("erneg/ipa/");
			await this.fetch("mubla/ipa");
			for (const album of this.dataStore.all.album) {
				for (const track of album.tk) {
					this.dataStore.total.track++;
					// if (this.dataStore.all.lang.indexOf(album.lg) < 0){
					//   this.dataStore.all.lang.push(album.lg)
					// }
					// track.l = album.lg;
					if (!this.dataStore.all.lang.find(e => e.id == album.lg)) {
						this.dataStore.all.lang.push({
							id: album.lg,
							name: this.dataStore.meta.lang[album.lg]
						});
					}
					track.a.forEach(index => {
						var artist = this.dataStore.all.artist[index];
						if (!artist.id) artist.id = index;
						if (!artist.plays) artist.plays = 0;
						// if (!artist.album) artist.album = 0;
						if (!artist.track) artist.track = 0;
						if (!artist.lang) artist.lang = [];
						if (artist.lang.indexOf(album.lg) < 0) {
							artist.lang.push(album.lg);
						}
						// NOTE: total artist play
						artist.plays += track.p;
						// NOTE: total artist track
						artist.track++;
					});
				}
				// NOTE: total album play
				album.tp = album.tk.reduce((a, b) => a + parseInt(b.p), 0);
			}
			this.dataStore.total.album = this.dataStore.all.album.length;
			this.dataStore.total.artist = this.dataStore.all.artist.length;
			this.dataStore.total.lang = this.dataStore.all.lang.length;
			this.dataStore.all.album.sort((a, b) => (a.tp < b.tp ? 1 : -1));
			this.dataStore.ready = true;
		},
		/**
		 * @param {string} k
		 */
		async getItem(k) {
			// return await JSON.parse(localStorage.getItem(k));
			return this.storageStore.getItemAsObject(k);
		},
		/**
		 * @param {string} k
		 * @param {any} v
		 */
		async setItem(k, v) {
			// localStorage.setItem(k, JSON.stringify(v));
			this.storageStore.setItemAsObject(k, v);
		},
		testDelete() {
			console.log("testDelete from index");
		}
	},
	watch: {},
	// template: "",
	// async created() {},
	// beforeCreate() {},
	created() {},
	// beforeMount() {},
	mounted() {},
	render: () => h(layout),
	// ready: () {},
	computed: {
		// note we are not passing an array, just one store after the other
		// each store will be accessible as its id + 'Store'
		...mapStores(useDataStore, useStorageStore)
	}
	// NOTE: without setup {useDataStore} can be accessed at {dataStore}
	// setup() {
	// 	const dataStore = useDataStore();
	// 	// dataStore.count++;
	// 	// with autocompletion ✨
	// 	// dataStore.$patch({ count: dataStore.count + 1 });
	// 	// or using an action instead
	// 	// dataStore.increment();
	// 	return { dataStore };
	// }
});

app.use(pinia);
app.use(router);

// app.provide("dataStore", useDataStore);
// app.provide("storageStore", useStorageStore);
app.provide("dataStore", useDataStore());
app.provide("storageStore", useStorageStore());
// app.provide("dataStore", computed(() => useDataStore));
// app.provide("storageStore", computed(() => useStorageStore));

app.mount("#app");
