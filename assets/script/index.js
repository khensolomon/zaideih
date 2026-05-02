import { createApp, h, markRaw } from "vue";
import { createPinia, mapStores } from "pinia";

import axios from "axios";

import { useDataStore } from "./store-data.js";
import { useStorageStore } from "./store-storage.js";

// @ts-ignore
import layout from "./layout.vue";

import router from "./router.js";

const pinia = createPinia();

/**
 * Compute the per-artist precomputed fields used by artist-index.vue.
 * Must stay in lockstep with the same logic in sw-album.js.
 *
 * @param {object} artist
 */
function annotateArtist(artist) {
	const name = artist.name || "";
	const cleaned = name
		.trim()
		.replace(/^(the|a|an|le|la|el|der|die|das)\s+/i, "");
	const first = cleaned.charAt(0).toUpperCase();
	artist.fl = /^[A-Z]$/.test(first) ? first : "#";
	artist.ck = Math.abs(artist.id | 0) % 9;
}

/**
 * Normalize album.yr: dedupe + sort ascending. Same logic as sw-album.js.
 *
 * @param {object} album
 */
function normalizeAlbumYears(album) {
	if (Array.isArray(album.yr)) {
		album.yr = [...new Set(album.yr.filter(Number))].sort();
	} else if (album.yr) {
		album.yr = [album.yr];
	} else {
		album.yr = [];
	}
}

const app = createApp({
	components: {},
	methods: {
		test() {},
		metadata() {
			var d = {};
			var elHead = document.head.querySelector("[name~=application-name]");

			if (elHead instanceof HTMLElement) {
				d = elHead.dataset;
			}
			for (const i of Object.keys(this.dataStore.meta))
				if (d.hasOwnProperty(i))
					this.dataStore.meta[i] = d[i].includes(",")
						? d[i].split(",").map((info) => info.trim())
						: parseInt(d[i]);
		},

		/**
		 * @param {string} id
		 */
		async json(id) {
			return axios.get("/api/" + id);
		},

		/**
		 * @param {string} id
		 */
		async fetch(id) {
			const kH = id.split("").reverse().join("");
			const uK = id;
			const kV = "s" + kH;
			const uV = kV.split("").reverse().join("");

			try {
				const localHash = this.storageStore.getItem(kH);
				const localData = await this.getItem(kV);

				const resp = await this.json(uK);
				const serverHash = resp.data.hash;

				if (serverHash) {
					if (serverHash != localHash) {
						this.storageStore.setItem(kH, serverHash);
					}
					if (serverHash === localHash && localData) {
						this.dataStore.all[id] = Array.isArray(localData) ? markRaw(localData) : localData;
					} else {
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

		async init() {
			this.metadata();
			await this.fetch("artist");
			await this.fetch("genre");
			await this.fetch("album");

			// =========================================================
			// FALLBACK: must produce the same shape as sw-album.js.
			// MIRROR_IN: ../script/sw-album.js
			// =========================================================
			const runFallbackProcess = () => {
				console.warn("Web Worker failed or unavailable. Falling back to main-thread processing.");

				const artistMap = new Map(this.dataStore.all.artist.map(a => [a.id, a]));
				const albums = this.dataStore.all.album;
				const batchSize = 500;
				let index = 0;

				for (const artist of this.dataStore.all.artist) {
					artist.plays = 0;
					artist.track = 0;
					artist._langSet = new Set();
				}

				const processBatch = () => {
					const end = Math.min(index + batchSize, albums.length);

					for (; index < end; index++) {
						const album = albums[index];
						let albumTotalPlays = 0;

						normalizeAlbumYears(album);

						for (const track of album.tk) {
							const trackPlays = parseInt(track.p) || 0;
							this.dataStore.total.track++;
							albumTotalPlays += trackPlays;

							if (!this.dataStore.all.lang.find((e) => e.id == album.lg)) {
								this.dataStore.all.lang.push({
									id: album.lg,
									name: this.dataStore.meta.lang[album.lg],
								});
							}

							for (const aid of track.a) {
								const artist = artistMap.get(aid);
								if (artist) {
									artist.plays += trackPlays;
									artist.track++;
									artist._langSet.add(album.lg);
								}
							}
						}
						album.tp = albumTotalPlays;
					}

					if (index < albums.length) {
						requestAnimationFrame(processBatch);
					} else {
						for (const artist of this.dataStore.all.artist) {
							artist.l = Array.from(artist._langSet || []);
							delete artist._langSet;
							annotateArtist(artist);
						}

						this.dataStore.total.album = this.dataStore.all.album.length;
						this.dataStore.total.artist = this.dataStore.all.artist.length;
						this.dataStore.total.lang = this.dataStore.all.lang.length;

						this.dataStore.all.album = markRaw(
							[...this.dataStore.all.album].sort((a, b) => (a.tp < b.tp ? 1 : -1))
						);
						this.dataStore.ready = true;
					}
				};

				processBatch();
			};

			try {
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

				worker.onerror = (err) => {
					console.warn("Worker error, falling back:", err);
					worker.terminate();
					runFallbackProcess();
				};

				const cleanDataForWorker = JSON.parse(JSON.stringify({
					albums: this.dataStore.all.album,
					artists: this.dataStore.all.artist,
					metaLangs: this.dataStore.meta.lang
				}));

				worker.postMessage(cleanDataForWorker);

			} catch (err) {
				console.warn("Worker instantiation failed, falling back:", err);
				runFallbackProcess();
			}
		},

		async getItem(k) {
			return this.storageStore.getItemAsObject(k);
		},

		async setItem(k, v) {
			this.storageStore.setItemAsObject(k, v);
		},

		testDelete() {
			console.log("testDelete from index");
		},
	},
	watch: {},
	created() {},
	mounted() {},
	render: () => h(layout),
	computed: {
		...mapStores(useDataStore, useStorageStore),
	},
});

app.use(pinia);
app.use(router);

app.provide("dataStore", useDataStore());
app.provide("storageStore", useStorageStore());

app.mount("#app");
