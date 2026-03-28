import { createApp, h, markRaw } from "vue";
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
						? d[i].split(",").map((info) => info.trim())
						: parseInt(d[i]);
			// await this.$http.get('/api').then(e=>this.dataStore.meta = e.data, e=>this.error = e.statusText);
		},

		/**
		 * @param {string} id
		 */
		async json(id) {
			return axios.get("/api/" + id);
		},

		/**
		 * v = value, k = key, h = hash, u = url
		 * api/album
		 * api/albums
		 * @param {string} id
		 * kH kV
		 */
		async fetch(id) {
			const kH = id.split("").reverse().join("");
			// const kH = kH.concat("s");

			const uK = id;

			// console.log("identity:", id);
			// console.log("key (kH):", kH, ", hash (uK):", uK);

			// const kV = kH.concat("s");
			const kV = "s" + kH;
			const uV = kV.split("").reverse().join("");
			// console.log("key (kV):", kV, ", hash (uV):", uV);

			try {
				const localHash = this.storageStore.getItem(kH);
				const localData = await this.getItem(kV);

				const resp = await this.json(uK);
				const serverHash = resp.data.hash;

				// console.log("localHash", localHash, "for", kH, serverHash);

				if (serverHash) {
					if (serverHash != localHash) {
						// NOTE: localhash is outdated, update it to server hash. This happen when local storage has old data
						this.storageStore.setItem(kH, serverHash);
					}
					if (serverHash === localHash && localData) {
						// NOTE: local data is up to date, use it
						this.dataStore.all[id] = Array.isArray(localData) ? markRaw(localData) : localData;
					} else {
						// NOTE: throw error, so that catch can request a new data. This happen when local storage has no data
						this.error = "error";
						throw "error";
					}
				}
			} catch (error) {
				await this.json(uV)
					.then((response) => {
						this.dataStore.all[id] = Array.isArray(response.data) ? markRaw(response.data) : response.data;
					})
					.catch((error) => {
						this.error = error.statusText;
					});
				this.setItem(kV, this.dataStore.all[id]);
			}
		},
		/**
		 * /api/artist -> tsitra/ipa/
		 * /api/genre -> erneg/ipa/
		 * /api/album -> mubla/ipa
		 */
		async init() {
			this.metadata();
			await this.fetch("artist");
			await this.fetch("genre");
			await this.fetch("album");

			// =========================================================
			// FALLBACK METHOD: Runs if Web Worker fails to load or clone
			// =========================================================
			const runFallbackProcess = () => {
				console.warn("Web Worker failed or unavailable. Falling back to processBatch()...");
				
				const artistMap = new Map(this.dataStore.all.artist.map(a => [a.id, a]));
				const albums = this.dataStore.all.album;
				const batchSize = 500;
				let index = 0;

				const processBatch = () => {
					const end = Math.min(index + batchSize, albums.length);
					
					for (; index < end; index++) {
						const album = albums[index];
						for (const track of album.tk) {
							this.dataStore.total.track++;
							
							if (!this.dataStore.all.lang.find((e) => e.id == album.lg)) {
								this.dataStore.all.lang.push({
									id: album.lg,
									name: this.dataStore.meta.lang[album.lg],
								});
							}
							
							track.a.forEach((id) => {
								const artist = artistMap.get(id);
								if (artist) {
									if (!artist.plays) artist.plays = 0;
									if (!artist.track) artist.track = 0;
									if (!artist.l) artist.l = [];
									if (artist.l.indexOf(album.lg) < 0) {
										artist.l.push(album.lg);
									}
									artist.plays += track.p || 0;
									artist.track++;
								}
							});
						}
						album.tp = album.tk.reduce((a, b) => a + parseInt(b.p), 0);
					}

					if (index < albums.length) {
						requestAnimationFrame(processBatch);
					} else {
						this.dataStore.total.album = this.dataStore.all.album.length;
						this.dataStore.total.artist = this.dataStore.all.artist.length;
						this.dataStore.total.lang = this.dataStore.all.lang.length;
						this.dataStore.all.album = markRaw([...this.dataStore.all.album].sort((a, b) => (a.tp < b.tp ? 1 : -1)));
						this.dataStore.ready = true;
					}
				};

				processBatch();
			};

			// =========================================================
			// PRIMARY METHOD: Try using the highly optimized Web Worker
			// =========================================================
			try {
				// Depending on your bundler, you may need to adjust the path here to '/data-worker.js'
				// const worker = new Worker(new URL('./data-worker.js', import.meta.url), { type: 'module' });
				const worker = new Worker('/static/sw-album.js', { type: 'module' });

				worker.onmessage = (e) => {
					const { albums, artists, langs, totalTracks } = e.data;

					this.dataStore.all.album = markRaw(albums);
					this.dataStore.all.artist = markRaw(artists);
					this.dataStore.all.lang = markRaw(langs);

					this.dataStore.total.track = totalTracks;
					this.dataStore.total.album = albums.length;
					this.dataStore.total.artist = artists.length;
					this.dataStore.total.lang = langs.length;

					this.dataStore.ready = true;
					worker.terminate();
				};

				// If worker errors out after instantiation (e.g. clone errors, internal logic error)
				worker.onerror = (err) => {
					worker.terminate();
					runFallbackProcess();
				};

				// Strip Vue Reactivity using JSON.parse(JSON.stringify) before sending
				const cleanDataForWorker = JSON.parse(JSON.stringify({
					albums: this.dataStore.all.album,
					artists: this.dataStore.all.artist,
					metaLangs: this.dataStore.meta.lang
				}));

				worker.postMessage(cleanDataForWorker);

			} catch (err) {
				// If worker completely fails to initialize (e.g. Webpack path resolving error)
				runFallbackProcess();
			}
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
		},
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
		...mapStores(useDataStore, useStorageStore),
	},
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