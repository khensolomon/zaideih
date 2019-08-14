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
    queueIndex:-1,
    queueId:'0',
    queueActive:{},
    queue:[
      {
        tl:'If You Were A Sailboat If You Were A Sailboat If You Were A Sailboat',
        ar:['Katie Melua'],
        ab:'testing',
        id:'/Katie Melua - If You Were A Sailboat.mp3'
      },
      {
        tl:'sailing',
        ar:['Rod Stewart'],
        ab:'testing',
        id:'/rod-stewart-sailing.mp3'
      },
      {
        tl:'Have I Told You Lately That I Love',
        ar:['Rod Stewart'],
        ab:'testing',
        id:'/rod-stewart-have-i-told-you-lately.mp3'
      },
      {
        tl:'You\'re In My Heart',
        ar:['Rod Stewart'],
        ab:'testing',
        id:'/rod-stewart-you-are-in-my-heart.mp3'
      },
      {
        tl:'I Was Only Joking',
        ar:['Rod Stewart'],
        ab:'testing',
        id:'/rod-stewart-i-was-only-joking.mp3'
      },
      {
        tl:'I Dont Want To Talk About It',
        ar:['Rod Stewart','Amy-Bell'],
        ab:'testing',
        id:'/rod-stewart-amy-belle-IDontWantToTalkAboutIt.mp3'
      },
      {
        tl:'Lentement',
        ar:['Miaow'],
        ab:'testing',
        id:'/Miaow - Lentement.mp3'
      },
      {
        tl:'Song',
        ar:['Miaow'],
        ab:'testing',
        id:'/Miaow - Song.mp3'
      }
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
    todoInsert(e){
      var r = e || Math.random().toString(36).substring(7);
      this.$parent.todo.push({title:r});
    },
    todoDelete(index){
      this.$parent.todo.splice(index, 1);
    },
    todoUpdate(index,v){
      this.$parent.todo[index]=v;
    },
    play(Id){
      if (this.queue.length){
        if (Id){
          if (Id == this.queueId){
            if (this.playing){
              this.$refs.player.pause();
            } else {
              this.$refs.player.play();
            }
          } else {
            var selected = this.queue.filter(track => track.id == Id);
            if (selected.length){
              var track = selected[0];
              this.queueId=track.id;
              this.$refs.player.track = track;
            }
          }
          console.log(Id,'yes')
        } else {
          var track = this.queue[0];
          this.queueId=track.id;
          this.$refs.player.track = track;
          console.log(Id,'no')
        }
      }
    },
    next(){
      if (this.queue.length){
        if (this.queueId){
          var currentIndex = this.queue.findIndex(track => track.id == this.queueId);
          var nextIndex = (currentIndex + 1) % this.queue.length;
          if (this.queue[nextIndex]){
            return this.play(this.queue[nextIndex].id);
          }
        }
        this.play();
      }
    },
    previous(){
      if (this.queue.length){
        if (this.queueId){
          var currentIndex = this.queue.findIndex(track => track.id == this.queueId);
          var nextIndex = (currentIndex - 1) % this.queue.length;
          if (this.queue[nextIndex]){
            return this.play(this.queue[nextIndex].id);
          }
        }
        this.play();
      }
    },
    addQueue(e){
      var selected = this.queue.filter(track => track.id == e.id);
      if (selected.length < 1){
        this.queue.push(e);
        // this.queue.push({
        //   title:e.tl,
        //   artist:e.ar.join(', '),
        //   album:e.ab,
        //   id:e.id
        // });
      }
      this.play(e.id);
    },
    formatTimer(e){
      return new Timer(e).format();
    },

    arrayComparer(otherArray){
      // var onlyInA = a.filter(comparer(b));
      // var onlyInB = b.filter(comparer(a));
      // result = onlyInA.concat(onlyInB);
      return function(current){
        return otherArray.filter(function(other){
          return other.toLowerCase()  == current.toLowerCase()
          // return other.value == current.value && other.display == current.display
        }).length == 0;
      }
    },
    // arrayComparerID(otherArray){
    //   return function(current){
    //     return otherArray.filter(function(other){
    //       return other.id  == current.id
    //     }).length == 0;
    //   }
    // },
    // arrayComparerUI(otherArray){
    //   return function(current){
    //     return otherArray.filter(function(other){
    //       return other.ui  == current.ui
    //     }).length == 0;
    //   }
    // },
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
    // msg () {
    //   return `Goodbye, ${ this.name }!`
    // },
    // message:{
    //   get: () => this.$parent.message,
    //   set: (value) => this.$parent.commit('message', value )
    // },
    // message: {
    //   get : function() { return this.$parent.message; },
    //   set : function(name) { this.$parent.message = name; }
    // }
    loading(){
      return this.$parent.loading;
    },
    all(){
      return this.$parent.all;
    },
    artists(){
      // var arr = [];
      // for (var album of this.all.data)
      //   for (var track of album.tk)
      //     for (var artist of track.ar) arr.push(artist);
      // return [...new Set(arr)];
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