import { createRouter, createWebHistory } from "vue-router";

import Home from "./home.vue";
import Queue from "./queue.vue";
import Music from "./music.vue";
import ArtistIndex from "./artist-index.vue";
import Artist from "./artist.vue";
import Album from "./album.vue";

const routes = [
	{
		path: "/",
		component: Home,
		name: "home",
	},
	{
		path: "/queue",
		component: Queue,
		name: "queue",
	},
	{
		// New canonical search route. Same component as the old /music.
		path: "/search",
		component: Music,
		name: "search",
		props: (route) => ({
			searchQuery: route.query.q,
			searchAt: route.query.at,
			language: route.query.language,
			genre: route.query.genre,
			year: route.query.year,
		}),
	},
	{
		// Backwards compat: any old bookmark to /music?q=... still works.
		// vue-router preserves query/hash by default on redirect.
		path: "/music",
		redirect: (to) => ({ path: "/search", query: to.query }),
	},
	{
		// Artist index (no name): the browse-all view.
		path: "/artist",
		component: ArtistIndex,
		name: "artist-index",
	},
	{
		// Per-artist detail.
		path: "/artist/:artistName",
		component: Artist,
		name: "artist",
		props: (route) => ({ artistName: route.params.artistName }),
	},
	{
		path: "/album/:albumId?",
		component: Album,
		name: "album",
		props: (route) => ({
			albumId: route.params.albumId,
			language: route.query.language,
		}),
	},
];

export default createRouter({
	history: createWebHistory(),
	routes,
});
