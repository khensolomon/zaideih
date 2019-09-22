import Player from './player/index.vue';
import Timer from './timer';
export default {
  name: 'App',
  props: ['name'],
  data: () => ({
		searchQuery: '',
    searchAt: 'avekpi',
    langList:[],
    langName:[
      'untitle',
      'zola',
      'myanmar',
      'mizo',
      'english',
      'chin',
      'haka',
      'falam',
      'korea',
      'norwegian',
      'collection'
    ],
    albumList:[],
    artistList:[],
    queueActive:{},
    testPlayerEvent:[],
    api:{
      audio_test:'*/yalp/oidua/ipa/moc.hiediaz//:ptth'.split("").reverse().join(""),
      audio:'*/oidua/ipa/'.split("").reverse().join("")
    },
    queue:[
      {
        id:'Katie-Melua-If-You-Were-A-Sailboat.mp3',
        tl:'If You Were A Sailboat',
        ar:['Katie Melua'],
        ab:'testing',
        n:'1',
        t:'2',
        l:'22:00',
        p:'234',
        s:'343'
      },
      {
        tl:'sailing',
        ar:['Rod Stewart'],
        ab:'testing',
        id:'rod-stewart-sailing.mp3'
      },
      // {
      //   tl:'Have I Told You Lately That I Love',
      //   ar:['Rod Stewart'],
      //   ab:'testing',
      //   id:'/rod-stewart-have-i-told-you-lately.mp3'
      // },
      // {
      //   tl:'You\'re In My Heart',
      //   ar:['Rod Stewart'],
      //   ab:'testing',
      //   id:'/rod-stewart-you-are-in-my-heart.mp3'
      // },
      // {
      //   tl:'I Was Only Joking',
      //   ar:['Rod Stewart'],
      //   ab:'testing',
      //   id:'/rod-stewart-i-was-only-joking.mp3'
      // },
      // {
      //   tl:'I Dont Want To Talk About It',
      //   ar:['Rod Stewart','Amy-Bell'],
      //   ab:'testing',
      //   id:'/rod-stewart-amy-belle-IDontWantToTalkAboutIt.mp3'
      // },
      // {
      //   tl:'Lentement',
      //   ar:['Miaow'],
      //   ab:'testing',
      //   id:'/Miaow - Lentement.mp3'
      // },
      // {
      //   tl:'Song',
      //   ar:['Miaow'],
      //   ab:'testing',
      //   id:'/Miaow - Song.mp3'
      // }
    ],
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
    async playNow(id){
      await this.setQueue(id).then(
        () => this.play()
      );
    },
    async nextQueue(){
      if (this.queue.length){
        if (this.queueId){
          var activeQueueIndex = this.queue.findIndex(track => track.id == this.queueId);
          var index = (activeQueueIndex + 1) % this.queue.length;
          if (this.queue[index]){
            return this.setQueue(this.queue[index].id).then(()=>this.play());
          }
        }
        this.play();
      }
    },
    async previousQueue(){
      if (this.queue.length){
        if (this.queueId){
          var activeQueueIndex = this.queue.findIndex(track => track.id == this.queueId);
          var index = (activeQueueIndex - 1) % this.queue.length;
          if (this.queue[index]){
            return this.setQueue(this.queue[index].id).then(()=>this.play());
          }
        }
        this.play();
      }
    },
    async addQueue(e){
      // if (await this.queue.filter(track => track.id == e.id).length < 1){
      //   this.queue.push(e);
      //   return false;
      // }
      // return true;
      if (await this.isQueued(e.id)) return true;
      this.queue.push(e);
      return false;
      // return await this.isQueued(e).then(
      //   (yes) => {
      //     if (yes) return true;
      //     this.queue.push(e);
      //     return false;
      //   }
      // );
    },
    async setQueue(Id){
      var e = await this.queue.filter(track => track.id == Id);
      if (e.length){
        this.player.track = e[0];
        return true;
      }
      return false;
    },

    isQueued(Id){
      return this.queue.filter(track => track.id == Id).length;
    },
    async randamQueue(){
      return await this.queue[Math.floor(Math.random()*this.queue.length)];
    },

    formatTimer(e){
      return new Timer(e).format();
    },

    arrayComparer(otherArray){
      return function(current){
        return otherArray.filter(function(other){
          return other.toLowerCase()  == current.toLowerCase()
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
    arrayGroupby(raw){
      let row = raw.reduce((r, e) => {
        // get first letter of name of current element
        let group = e[0].toUpperCase();
        // if there is no property in accumulator with this letter create it
        if(!r[group]) r[group] = {name:group, artists: [e]}
        // if there is push current element to children array for that letter
        else r[group].artists.push(e);
        // return accumulator
        return r;
      }, {});
      return Object.values(row);
    },

  },
  computed: {
    ready(){
      return this.$parent.ready;
    },
    loading(){
      return this.$parent.loading;
    },
    player(){
      return this.$refs.player;
    },
    queueId(){
      return this.player.id;
    },
    all(){
      return this.$parent.all;
    },
    artists(){
      if (!this.artistList.length){
        var arr = this.all.data.map(
          album => album.tk.map(
            track => track.ar
          ).reduce((prev, next) => prev.concat(next),[])
        ).reduce((prev, next) => prev.concat(next),[]);
        this.artistList = [...new Set(arr)].sort();
      }
      return this.artistList;
    },
    albums(){
      if (!this.albumList.length){
        var arr = this.all.data.map(
          album => album.ab
        ).reduce((prev, next) => prev.concat(next),[]);
        this.albumList = [...new Set(arr)].sort();
      }
      return this.albumList;
    },
    todos(){
      return this.$parent.todo;
    },
    langs(){
      // var l = [];
      // var o = this.$parent.all.data.map((a) => a.lg );
      // o = new Set([].concat.apply([], o));
      if (!this.langList.length){
        var lg = this.all.data.map(
          album => album.lg
        ).reduce((prev, next) => prev.concat(next),[]).filter((value, index, self) => self.indexOf(value) === index);
        for (const id of lg) {
          if (this.langName[id]) this.langList.push({id:id,name:this.langName[id]});
        }
      }
      return this.langList;
    }
  },
  created() {
  },
  mounted () {
  }
}