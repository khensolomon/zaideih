import trackRow from '../components/track-row.vue';
import albumRow from '../components/album-row.vue';
import albumRaw from '../components/album-raw.vue';
export default {
  name: 'Artist',
  props: ['artistName','language'],
  data: () => ({
    activeLang:null,
    limitShow: 30,
    tracksLimit:99,
    artist:{},
    albums:[],
    tracks:[],
    artistRelatedIndex:[],
    artistRecommendedIndex:[]
  }),
  components: {
    trackRow, albumRow, albumRaw
  },

  // filters:{
  //   sumplay: function(e){
  //     return e.reduce((a, b) => a + parseInt(b.p), 0);
  //   }
  // },
  methods: {
    // showMore(){
    //   this.limitShow += 5;
    // },
    // albumArtist: function(e){
    //   var o = e.map((a) => a.ar );
    //   return new Set([].concat.apply([], o));
    // },
    // playTrack: function(e){
    //   this.$.addQueue(e);
    // },
    // playAlbum(ui){
    //   var albums = this.$parent.old.filter((e) => {
    //     return e.ui == ui;
    //   });
    //   this.$parent.queue=[];
    //   for (const album of albums) {
    //     for (const trk of album.tk) {
    //       this.$parent.queue.push(trk);
    //     }
    //   }
    // },
    playArtist(){
      // this.$parent.queue = this.tracks;
      // this.$.queue=[];
      // await this.tracks.forEach(e=>this.$.addQueue(e))
      // this.$.play();
      this.$.playAll(this.tracks);
    },
  },
  watch: {
    tracksLimit(e){
      this.tracksLimit = e<this.tracks.length?e:this.tracks.length;
    },
    // tracksByArtistLimit(e){
    //   this.tracksByArtistLimit = e<this.tracksByArtist.length?e:this.tracksByArtist.length;
    // },
  },
  computed: {
    $(){
      return this.$parent;
    },
    init(){

      var lg = this.$.all.lang.find(e=>e.name.toLowerCase() == this.artistName.toLowerCase());
      if (lg){
        this.activeLang=lg.id;
        return null;
      }

      this.artist = this.$.all.artist.find(
        artist=> this.artistName.toLowerCase() === artist.name.toLowerCase() || artist.aka && new RegExp(this.artistName, 'i').test(artist.aka)
      );
      if (!this.artist) return null;
      // console.log(artist)
      this.albums = this.$.all.album.filter(
        album => album.tk.some(
          // track => track.ar.indexOf(this.artistName) >= 0
          track => track.a.find(
            e=>e==this.artist.id
          )
        )
      );

      this.tracks = this.albums.map(
        album => album.tk.filter(
          track => track.a.find(
            e=>e==this.artist.id
          )
        )
      ).reduce((prev, next) => prev.concat(next),[]).sort((a, b) => (a.p < b.p) ? 1 : -1);


      var artRed = this.albums.map(
        album => album.tk.map(
          track => track.a
        ).reduce((prev, next) => prev.concat(next),[])
      ).reduce((prev, next) => prev.concat(next),[]);
      this.artistRelatedIndex = [...new Set(artRed)].filter(
        i=> i > 1 && i !== this.artist.id
      );

      var artRmd = this.tracks.map(
        track => track.a
      ).reduce((prev, next) => prev.concat(next),[]);
      this.artistRecommendedIndex = [...new Set(artRmd)].filter(
        i => i > 1 && i !== this.artist.id
      );

      this.artistRelated = this.artistRelatedIndex.filter(this.$.arrayComparer(this.artistRecommendedIndex)).map(
        i => this.$.all.artist.find(e=>e.id == i)
      ).sort((a, b) => (a.plays < b.plays) ? 1 : -1).map(
        e => (this.$.utf8(this.artistName) || this.artist.lang.find(e=>e == 2)) && e.aka?e.aka:e.name
        // e=>this.$.utf8(this.artistName) && e.aka?e.aka:e.name
        // e=>this.artist.lang.find(e=>e == 2) && e.aka?e.aka:e.name
      );

      this.artistRecommended = this.artistRecommendedIndex.map(
        i => this.$.all.artist.find(e=>e.id == i)
      ).sort((a, b) => (a.plays < b.plays) ? 1 : -1).map(
        e => this.$.utf8(this.artistName) && e.aka?e.aka:e.name
      );
      return this.albums.length;
    },
    artistCategory(){
      return this.$.artistAlphabetically(
        artist=> artist.id > 1 && artist.lang.find(e=> this.activeLang?e == this.activeLang:true)
        // artist=> artist.id > 1 && artist.lang.find(e=> this.activeLang?e == this.activeLang:true) && artist.plays > 3000
        // artist=> artist.id > 1 && this.activeLang?artist.lang.find(e=>e == this.activeLang):true
      );
      // return this.$.artistAlphabetically(
      //   artist=> artist.id > 1 && artist.lang && artist.lang.find(
      //     e => e == 1
      //   )
      // );
    },
    albumPlays(){
      return this.albums.reduce((a,b) => a + parseInt(b.tp),0);
    },
    trackPlays(){
      return this.tracks.reduce((a,b) => a + parseInt(b.p),0);
    },
    artistYear(){
      var yrs = this.albums.map(
        a => a.yr
      ).reduce((prev, next) => prev.concat(next),[]);
      return [...new Set(yrs)].sort().filter(Number);
    },
    trackCount(){
      return this.tracks.length;
    },
    albumCount(){
      return this.albums.length;
    },
    trackDuration(){
      // return this.$.trackDuration(this.tracks);
      return this.$.trackDuration(this.tracks.map(track => track.d));
    }
  }
}