// import VueRouter from 'vue-router';

import Home from './home/index.vue';
import Queue from './queue/index.vue';
import Music from './music/index.vue';
import Artist from './artist/index.vue';
import Album from './album/index.vue';
// import Hello from './components/Hello';
// import Goodbye from './components/Goodbye';

Vue.use(VueRouter)

export default new VueRouter({
  mode: 'history',
  routes: [
    {
      path: '/',
      component: Home,
      name:'home'
      // redirect: '/home'
    },
    {
      path: '/queue',
      component: Queue,
      name:'queue'
    },
    {
      path: '/music',
      component: Music,
      name:'music',
      props: (route) => ({searchQuery: route.query.q, searchAt: route.query.at, language: route.query.language,genre: route.query.genre,year: route.query.year })
    },
    {
      path: '/artist/:artistName?',
      component: Artist,
      name:'artist',
      props: (route) => ({artistName:route.params.artistName})
    },
    {
      path: '/album/:albumId?',
      component: Album,
      name:'album',
      props: (route) => ({albumId:route.params.albumId, language: route.query.language })
      // props: true
    }
  ]
});

// var router = new VueRouter({
//  routes:[
//   //  { path:'/settings', component: Settings }
//  ]
// });
