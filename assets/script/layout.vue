<template>
  <div>
    <div v-if="ready" class="zd primary">
      <div class="bar">
        <div>
          <div class="menu">
            <ul class="panel">
              <li class="icon-panel">Zaideih</li>
            </ul>
            <ul class="nav">
              <li>
                <router-link :to="{ path: '/' }" class="home icon-home-">
                  <span>Home</span>
                </router-link>
              </li>
              <li>
                <router-link :to="{ path: '/artist' }" class="icon-artist-">
                  <span>Artist</span>
                </router-link>
              </li>
              <router-link :to="{ path: '/album' }" class="icon-album-" v-slot="{ isActive, href, navigate }">
                <li :class="{ active: isActive }">
                  <a :href="href" @click="navigate">
                    <span>Album</span>
                  </a>
                </li>
              </router-link>
              <router-link :to="{ path: '/queue' }" :data-count="dataStore.totalQueue" class="icon-list-bullet-"
                v-slot="{ isActive, href, navigate }">
                <li :class="{ active: isActive }">
                  <a :href="href" @click="navigate">
                    <span>Queue</span>
                  </a>
                </li>
              </router-link>
            </ul>
          </div>

          <div class="opt">
            <ul>
              <li class="icon-config-"></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="sch">
        <form v-on:submit="search" name="search" method="get" action="#">
          <div class="logo">
            <span>Zaideih</span>
          </div>
          <div class="type">
            <input v-model="dataStore.searchQuery" placeholder=" Type here..." type="search">
          </div>
          <div class="option">
            <input v-model="dataStore.searchAt" value="title" id="title" type="radio">
            <label for="title" title="Title" class="icon-track">Title</label>
            <input v-model="dataStore.searchAt" value="artist" id="artist" type="radio">
            <label for="artist" title="Artist" class="icon-artist">Artist</label>
            <input v-model="dataStore.searchAt" value="album" id="album" type="radio">
            <label for="album" title="Album" class="icon-album">Album</label>
            <input v-model="dataStore.searchAt" value="avekpi" id="avekpi" type="radio">
            <label for="avekpi" title="All" class="icon-database">All</label>
          </div>
          <div class="submit">
            <button type="submit" title="Search" class="icon-search"></button>
          </div>
        </form>
      </div>
      <router-view class="wrapper"></router-view>
    </div>
    <div v-else class="zd fullscreen loading">
      <p class="t2 trial">one moment</p>
    </div>
    <div class="zd player">
      <Player ref="player" />
    </div>
  </div>
</template>

<script>
// @ts-ignore
import Player from "./player.vue";

export default {
  // name: 'App',
  // props: ['name'],

  inject: ["dataStore", "storageStore"],
  provide() {
    return {
      // dataStore: computed(() => this.dataStore),
      root: this,
      dataStore: this.dataStore,
      storageStore: this.storageStore,
    };
  },
  components: {
    Player,
  },
  methods: {
    search(e) {
      this.$router.push({
        path: "/music",
        query: { q: this.dataStore.searchQuery },
      });
      e.preventDefault();
    },

    play() {
      this.player.play();
    },
    playAlbum(ui) {
      // this.dataStore.queue=[];
      // this.dataStore.all.album.find(
      //   e => e.ui == ui
      // ).tk.forEach(i=>this.dataStore.queue.push(i));
      // this.dataStore.all.album.find(e => e.ui == ui).tk;
      this.playAll(this.dataStore.all.album.find((e) => e.ui == ui).tk);
    },
    // NOTE playAll: playArtist, playAlbum
    playAll(e) {
      this.dataStore.queue = [];
      e.forEach((i) => this.dataStore.queue.push(i));
      // this.play();
      this.playNow(this.dataStore.queue[0].i);
    },
    async playNow(id) {
      await this.setQueue(id).then(() => this.play());
    },
    async nextQueue() {
      if (this.dataStore.queue.length) {
        if (this.playerId) {
          var activeQueueIndex = this.dataStore.queue.findIndex(
            (track) => track.i == this.playerId
          );
          var index = (activeQueueIndex + 1) % this.dataStore.queue.length;
          if (this.dataStore.queue[index]) {
            return this.setQueue(this.dataStore.queue[index].i).then(() =>
              this.play()
            );
          }
        }
        this.play();
      }
    },
    async previousQueue() {
      if (this.dataStore.queue.length) {
        if (this.playerId) {
          var activeQueueIndex = this.dataStore.queue.findIndex(
            (track) => track.i == this.playerId
          );
          var index = (activeQueueIndex - 1) % this.dataStore.queue.length;
          if (this.dataStore.queue[index]) {
            return this.setQueue(this.dataStore.queue[index].i).then(() =>
              this.play()
            );
          }
        }
        this.play();
      }
    },
    async addQueue(e) {
      if (await this.isQueued(e.i)) return true;
      // this.dataStore.queue.push(this.track(e));
      this.dataStore.queue.push(e);
      return false;
    },
    async setQueue(Id) {
      // var e = await this.dataStore.queue.filter(track => track.i == Id);
      // if (e.length){
      //   this.player.track = e[0];
      //   return true;
      // }
      // return false;
      var e = await this.dataStore.queue.find((track) => track.i == Id);
      if (e) {
        this.player.track = e;
        return true;
      }
      return false;
    },

    isQueued(Id) {
      return this.dataStore.queue.filter((track) => track.i == Id).length;
    },

    albumArtist(album) {
      // var o = e.map((a) => a.ar );
      // return new Set([].concat.apply([], o));
      var o = [...new Set([].concat(...album.tk.map((i) => i.a)))];
      return o
        .map((i) => this.dataStore.all.artist[i])
        .map((a) => (album.lg == 2 && a.aka ? a.aka : a.name));
    },
    albumGenre(album) {
      return album.gr.map((i) => this.dataStore.all.genre[i].name);
    },
    albumByTrackId(id) {
      return this.dataStore.all.album.find(
        (album) => album.tk.filter((a) => a.i == id).length
      );
    },

    artistName(o) {
      return o.a.map((i) => {
        var artist = this.dataStore.all.artist[i];
        if (artist) {
          return artist.aka && this.dataStore.utf8(o.t)
            ? artist.aka
            : artist.name;
          // return (artist.aka && album && album.lg == 2)?artist.aka:artist.name
        }
        return i;
      });
    },
    track(o) {
      // var album = this.albumByTrackId(o.i)
      // var synonym = { i: 'id', t:'title',a:'artist',b:'album',n:'trackNumber',d:'duration',p:'plays' };
      // var synonym = {};
      // var trk = Object.keys(o).reduce(function(e, k){
      //   return {...e,...{[synonym[k] || k]: o[k]}}
      // },{});

      // var trk = Object.keys(o).reduce(
      //   (acc, key) => ({
      //     ...acc,
      //     ...{ [synonym[key] || key]: o[key] }
      //   }),
      //   {}
      // );
      // console.log(trk)

      var trk = Object.assign({}, o);
      // trk.b=this.trackAlbumName(o.i);
      // trk.b=(album)?album.ab:'testing'
      trk.a = this.artistName(o);
      return trk;
    },

    // sortTrackNumber(e){
    //   // return e.sort((a, b) => (a.n > b.n) ? 1 : -1)
    // },
    // sortTrackPlay(e){
    //   return e.sort((a, b) => (a.p > b.p) ? 1 : -1)
    // },
    // sortArrays(e) {
    //   return e.orderBy(e, 'n', 'asc');
    // }
  },
  computed: {
    ready() {
      // return this.$parent.ready;
      return this.dataStore.ready;
    },
    loading() {
      // return this.$parent.loading;
      return this.dataStore.loading;
    },
    // all() {
    // 	return this.$parent.all;
    // },
    player() {
      return this.$refs.player;
    },
    playerId() {
      // @ts-ignore
      return this.player.id;
    },
  },
  // beforeCreate() {},
  async created() {
    // console.log("layout.$parent.dataStore", this.$parent.dataStore);
    // this.dataStore.increment();
    // console.log("layout.dataStore.searchAt", this.dataStore.searchAt);
    // console.log("layout.created=1", this.dataStore.count);
    await this.$parent.init();
    // [
    //   {
    //     i:'Katie-Melua-If-You-Were-A-Sailboat.mp3',
    //     t:'If You Were A Sailboat',
    //     a:['Katie Melua'],
    //     n:'1',
    //     d:'22:00',
    //     p:'234',
    //   },
    //   {
    //     i:'rod-stewart-sailing.mp3',
    //     t:'sailing',
    //     a:['Rod Stewart'],
    //     p:'20'
    //   }
    // ].forEach(e=>{
    //   this.addQueue(e)
    // });

    this.dataStore.all.album
      .filter((e) => e.lg == 2)
      .slice(0, 10)
      .forEach((album) => {
        // album.tk.slice(0, 2).forEach(e=>{
        //   this.addQueue(this.track(e));
        // });
        album.tk
          .sort((a, b) => (a.p < b.p ? 1 : -1))
          .slice(0, 2)
          .forEach((e) => {
            this.addQueue(e);
            // this.addQueue(this.track(e));
          });
      });
    // console.log(this.dataStore.queue)
    // var abc = this.dataStore.all.album.filter(
    //   album=>album.tk.find(e=>e.i==4515)
    // );
    // var abc = this.dataStore.all.album.filter(
    //   album=>album.tk.some(
    //     e=>e.i == 4515
    //   )
    // );
    // var abc = this.dataStore.all.album.find(
    //   album=>album.tk.filter(
    //     e=>e.i == 4515
    //   ).length
    // );
    // var abc = [1,0].map(
    //   i=>this.dataStore.all.genre[i].name
    // );
    // console.log(abc)

    // var abc = this.dataStore.all.artist.filter(
    //   e=>e.id > 1 && e.lang.find(i=>i == 1)
    // ).sort((a, b) => (a.plays < b.plays) ? 1 : -1).slice(0, 10);
    // // console.log(abc)
    // abc.forEach(e=>console.log(e.name,e.plays))
  },
  // destroyed () {},
  // mounted () {},
};

</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./layout.css"; 
*/
</style>