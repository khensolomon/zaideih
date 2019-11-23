import Player from './player/index.vue';
import Timer from './timer';
export default {
  // name: 'App',
  // props: ['name'],
  data: () => ({
		searchQuery: '',
    searchAt: 'avekpi',
    queueActive:{},
    // testPlayerEvent:[],
    api:{
      // audio_test:'*/yalp/oidua/ipa/moc.hiediaz//:ptth'.split("").reverse().join(""),
      audio:'*/oidua/ipa/'.split("").reverse().join("")
    },
    queue:[],
    playing:false
	}),
  components: {
    Player
  },
  methods:{
    search(e){
      // console.log(this.searchQuery, this.searchAt);
      // this.$router.push("/music?");
      var searchQuery = this.searchQuery;
      // var searchAt = this.searchAt;
      // ,query: { q: searchQuery, at:searchAt }
      this.$router.push({path:'/music',query:{q: searchQuery}});
      e.preventDefault();
    },

    play(){
      this.player.play();
    },
    playAlbum(ui){
      // this.queue=[];
      // this.all.album.find(
      //   e => e.ui == ui
      // ).tk.forEach(i=>this.queue.push(i));
      // this.all.album.find(e => e.ui == ui).tk;
      this.playAll(this.all.album.find(e => e.ui == ui).tk)
    },
    // NOTE playAll: playArtist, playAlbum
    playAll(e){
      this.queue=[];
      e.forEach(i=>this.queue.push(i));
      // this.play();
      this.playNow(this.queue[0].i)
    },
    async playNow(id){
      await this.setQueue(id).then(
        () => this.play()
      );
    },
    async nextQueue(){
      if (this.queue.length){
        if (this.queueId){
          var activeQueueIndex = this.queue.findIndex(track => track.i == this.queueId);
          var index = (activeQueueIndex + 1) % this.queue.length;
          if (this.queue[index]){
            return this.setQueue(this.queue[index].i).then(()=>this.play());
          }
        }
        this.play();
      }
    },
    async previousQueue(){
      if (this.queue.length){
        if (this.queueId){
          var activeQueueIndex = this.queue.findIndex(track => track.i == this.queueId);
          var index = (activeQueueIndex - 1) % this.queue.length;
          if (this.queue[index]){
            return this.setQueue(this.queue[index].i).then(()=>this.play());
          }
        }
        this.play();
      }
    },
    async addQueue(e){
      if (await this.isQueued(e.i)) return true;
      // this.queue.push(this.track(e));
      this.queue.push(e);
      return false;
    },
    async setQueue(Id){
      // var e = await this.queue.filter(track => track.i == Id);
      // if (e.length){
      //   this.player.track = e[0];
      //   return true;
      // }
      // return false;
      var e = await this.queue.find(track => track.i == Id);
      if (e){
        this.player.track = e;
        return true;
      }
      return false;
    },

    isQueued(Id){
      return this.queue.filter(track => track.i == Id).length;
    },
    async randamQueue(){
      return await this.queue[Math.floor(Math.random()*this.queue.length)];
    },

    arrayComparer(otherArray){
      return function(current){
        return otherArray.filter(function(other){
          return other == current
          // return other.toString().toLowerCase()  == current.toString().toLowerCase()
          // return other.value == current.value && other.display == current.display
        }).length == 0;
      }
    },
    arrayComparerID_notInUseds(otherArray){
      return function(current){
        return otherArray.filter(function(other){
          return other.id  == current.id
        }).length == 0;
      }
    },
    arrayComparerUI_notInUseds(otherArray){
      return function(current){
        return otherArray.filter(function(other){
          return other.ui  == current.ui
        }).length == 0;
      }
    },
    artistAlphabetically(filters){
      var row = this.all.artist.filter(filters).reduce((e, k) => {
        let cluster = k.name[0].toUpperCase();
        if(!e[cluster]) {
          e[cluster] = {cluster:cluster, artists: []}
        }
        e[cluster].artists.push(k);
        return e
      }, {});
      return Object.values(row).sort((a, b) => (a.cluster > b.cluster) ? 1 : -1);
    },
    albumDuration(album){
      try {
        return new Timer(album.tk.map(e=>e.d)).format();
      } catch (error) {
        console.log('time error',album.ab);
      }
    },
    albumArtist(album){
      // var o = e.map((a) => a.ar );
      // return new Set([].concat.apply([], o));
      var o = [...new Set([].concat(...album.tk.map(i => i.a)))];
      return o.map(
        i => this.all.artist[i]
      ).map(
        a => (album.lg == 2 && a.aka)?a.aka:a.name
      );
    },
    albumGenre(album){
      return album.gr.map(
        i=>this.all.genre[i].name
      );
    },
    albumByTrackId(id){
      return this.all.album.find(
        album=>album.tk.filter(
          a=>a.i == id
        ).length
      );
    },


    utf8(str){
      // for (var i = 0; i < str.length; i++) if (str.charCodeAt(i) > 127) return true;
      // return false;
      return /[^\u0000-\u007f]/.test(str);
    },
    artistName(o){
      return o.a.map(
        i => {
          var artist = this.all.artist[i];
          if (artist){
            return (artist.aka && this.utf8(o.t))?artist.aka:artist.name
            // return (artist.aka && album && album.lg == 2)?artist.aka:artist.name
          }
          return i
        }
      );
    },
    track(o){
      // var album = this.albumByTrackId(o.i)
      // var synonym = { i: 'id', t:'title',a:'artist',b:'album',n:'trackNumber',d:'duration',p:'plays' };
      var synonym = {};
      var trk = Object.keys(o).reduce(function(e, k){
        return {...e,...{[synonym[k] || k]: o[k]}}
      },{});
      // trk.b=this.trackAlbumName(o.i);
      // trk.b=(album)?album.ab:'testing'
      trk.a=this.artistName(o);
      return trk;
    },
    trackDuration(e){
      return new Timer(e.map(track => track.d)).format();
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
    ready(){
      return this.$parent.ready;
    },
    loading(){
      return this.$parent.loading;
    },
    all(){
      return this.$parent.all;
    },
    player(){
      return this.$refs.player;
    },
    queueId(){
      return this.player.id;
    }

  },
  // beforeCreate() {},
  async created(){
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

    this.all.album.filter(
      e=>e.lg == 2
    ).slice(0, 10).forEach((album) =>{
      // album.tk.slice(0, 2).forEach(e=>{
      //   this.addQueue(this.track(e));
      // });
      album.tk.sort((a, b) => (a.p < b.p) ? 1 : -1).slice(0, 2).forEach(e=>{
        this.addQueue(e);
        // this.addQueue(this.track(e));
      });
    });
    // console.log(this.queue)
    // var abc = this.all.album.filter(
    //   album=>album.tk.find(e=>e.i==4515)
    // );
    // var abc = this.all.album.filter(
    //   album=>album.tk.some(
    //     e=>e.i == 4515
    //   )
    // );
    // var abc = this.all.album.find(
    //   album=>album.tk.filter(
    //     e=>e.i == 4515
    //   ).length
    // );
    // var abc = [1,0].map(
    //   i=>this.all.genre[i].name
    // );
    // console.log(abc)

    // var abc = this.all.artist.filter(
    //   e=>e.id > 1 && e.lang.find(i=>i == 1)
    // ).sort((a, b) => (a.plays < b.plays) ? 1 : -1).slice(0, 10);
    // // console.log(abc)
    // abc.forEach(e=>console.log(e.name,e.plays))

  },
  // destroyed () {},
  // mounted () {}
}