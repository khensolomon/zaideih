// import Vue from 'vue';

// @ts-ignore
import main from './main.vue';
import router from './router.js';
// import Timer from './timer';
// Vue.config.productionTip = false;
// Vue.config.devtools = false

// @ts-ignore
new Vue({
  router:router,
  data:{
    ready:false,
    loading:true,
    message:null,
    error:null,
    meta:{album:0,artist:0,genre:0,lang:[]},
    all:{
      // data:[],
      album:[],
      genre:[],
      artist:[],
      lang:[]
    },
    total:{
      track:0,
      album:0,
      artist:0
    }
  },

  methods:{
    // async fetchTmp(){
    //   await this.$http.get('/api/track').then(response=>{
    //     this.all.data = response.data;
    //   }, error=>{
    //     this.error = error.statusText;
    //   });
    // },
    metadata(){
      const d = document.head.querySelector("[name~=application-name]").dataset;
      // for (const i of Object.keys(d)) this.meta[i]=d[i].includes(',')?d[i].split(','):parseInt(d[i]);
      for (const i of Object.keys(this.meta)) if (d.hasOwnProperty(i)) this.meta[i]=d[i].includes(',')?d[i].split(','):parseInt(d[i]);
      // await this.$http.get('/api').then(e=>this.meta = e.data, e=>this.error = e.statusText);
    },
    async fetch(uri){
      uri = uri.split("").reverse().join('');
      var id = uri.split('/').slice(-1)[0], k = id.split("").reverse().join('');

      try {
        var o = await this.getItem(k);
        if (JSON.stringify(o).length == this.meta[id]) {
          this.all[id] = o;
        } else {
          // NOTE: throw error, so that catch can request a new data. This happen when local storage has no data
          this.error = 'eadsfasdfasdf';
          throw 'error';
        }
      } catch (error) {
        // NOTE: This happened because local storage is empty or user has modified. So we just simply request fresh data.
        await this.$http.get(uri).then(response=>{
          this.all[id] = response.data;
        }, error=>{
          this.error = error.statusText;
        });
        await this.setItem(k,this.all[id]);
      }
    },
    async init(){
      this.metadata();
      await this.fetch('tsitra/ipa/');
      await this.fetch('erneg/ipa/');
      await this.fetch('mubla/ipa');
      for (const album of this.all.album) {
        for (const track of album.tk) {
          this.total.track++;
          // if (this.all.lang.indexOf(album.lg) < 0){
          //   this.all.lang.push(album.lg)
          // }
          // track.l = album.lg;
          if (!this.all.lang.find(e=>e.id == album.lg)){
            this.all.lang.push({id:album.lg,name:this.meta.lang[album.lg]});
          }
          track.a.forEach(index => {
            var artist = this.all.artist[index];
            if (!artist.id) artist.id = index;
            if (!artist.plays) artist.plays = 0;
            // if (!artist.album) artist.album = 0;
            if (!artist.track) artist.track = 0;
            if (!artist.lang) artist.lang = [];
            if (artist.lang.indexOf(album.lg) < 0){
              artist.lang.push(album.lg)
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
      this.total.album = this.all.album.length;
      this.total.artist = this.all.artist.length;
      this.total.lang = this.all.lang.length;
      this.all.album.sort((a, b) => (a.tp < b.tp) ? 1 : -1);
      this.ready = true;
    },
    // async tmpartistSearch(artistName){
    //   var result = this.all.artist.filter(
    //     e=>e.thesaurus.find(
    //       s=> s.toLowerCase() == artistName.toLowerCase()
    //     ) || e.name.toLowerCase() == artistName.toLowerCase() || e.aka && e.aka == artistName || new RegExp(artistName, 'i').test(e.name)
    //   ).sort((a, b) => (a.plays < b.plays) ? 1 : -1);
    //   // console.log(this.all.artist[2]);

    //   result.forEach(e=>console.log(e.name));
    // },
    // async tmpartistName(artistName){
    //   var index = this.all.artist.findIndex(
    //     e=>e.thesaurus.find(
    //       s=> s.toLowerCase() == artistName.toLowerCase()
    //     ) || e.name.toLowerCase() == artistName.toLowerCase() || e.aka && e.aka == artistName
    //   );
    //   console.log(artistName,index)
    // },
    // async tmpAlbumList(langs){
    //   this.all.album.filter(
    //     album=>langs?album.lg == langs: true
    //   ).slice(0, 5).forEach(function(album,i){
    //     console.log(i,album.ab,album.tp)
    //   })
    // },
    async getItem(k){
      return await JSON.parse(localStorage.getItem(k));
    },
    async setItem(k,v){
      localStorage.setItem(k, JSON.stringify(v));
    }
  },
  watch: {
    // call again the method if the route changes
    // '$route': 'fetchTmp'
  },
  // async created() {
  //   await this.fetch('tsitra/ipa/');
  //   await this.fetch('erneg/ipa/');
  //   await this.fetch('mubla/ipa');
  //   await this.init();
  //   await this.tmpArtistSearch('zam');
  //   await this.tmpArtistName('jk kam');
  //   await this.tmpAlbumList();
  // },
  // beforeCreate() {},
  // created() {},
  // beforeMount() {},
  // mounted () {},
  render: h => h(main),
}).$mount('#app');
