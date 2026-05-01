import { createRouter, createWebHistory } from "vue-router";

import Home from "./home.vue";
import Queue from "./queue.vue";
import Music from "./music.vue";
import Artist from "./artist.vue";
import Album from "./album.vue";
// import Hello from './components/Hello';
// import Goodbye from './components/Goodbye';

const routes = [
	{
		path: "/",
		component: Home,
		name: "home"
		// redirect: '/home'
	},
	{
		path: "/queue",
		component: Queue,
		name: "queue"
	},
	{
		path: "/music",
		component: Music,
		name: "music",
		props: route => ({
			searchQuery: route.query.q,
			searchAt: route.query.at,
			language: route.query.language,
			genre: route.query.genre,
			year: route.query.year
		})
	},
	{
		path: "/artist/:artistName?",
		component: Artist,
		name: "artist",
		props: route => ({ artistName: route.params.artistName })
	},
	{
		path: "/album/:albumId?",
		component: Album,
		name: "album",
		props: route => ({
			albumId: route.params.albumId,
			language: route.query.language
		})
		// props: true
	}
];

export default createRouter({
	history: createWebHistory(),
	routes // short for `routes: routes`
});

// Vue.use(VueRouter);

// export default new VueRouter({
// 	mode: "history",
// 	routes: routes
// });

// var router = new VueRouter({
//  routes:[
//   //  { path:'/settings', component: Settings }
//  ]
// });
