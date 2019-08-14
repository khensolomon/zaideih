import trackRow from '../components/track-row.vue';
import albumRow from '../components/album-row.vue';
export default {
  name: 'Artist',
  props: ['artistName','language'],
  data: () => ({
    limitShow: 30,
    albums:[],
    artistRelatedAll:[],
    artistRecommendedAll:[]
  }),
  components: {
    trackRow, albumRow
  },
  filters:{
    sumplay: function(e){
      return e.reduce((a, b) => a + parseInt(b.p), 0);
    }
  },
  methods: {
    showMore(){
      this.limitShow += 5;
    },
    albumArtist: function(e){
      var o = e.map((a) => a.ar );
      return new Set([].concat.apply([], o));
    },
    playTrack: function(e){
      this.$parent.addQueue(e);
    },
    playAlbum(ui){
      var albums = this.$parent.all.data.filter((e) => {
        return e.ui == ui;
      });
      this.$parent.queue=[];
      for (const album of albums) {
        for (const trk of album.tk) {
          this.$parent.queue.push(trk);
        }
      }
    },
    playArtist(){
      this.$parent.queue = this.tracks;
    }
  },
  computed: {
    init(){
      this.albums = this.$parent.all.data.filter(
        album => album.tk.some(
          // track => track.ar.indexOf(this.artistName) >= 0
          track => track.ar.findIndex(artist => this.artistName.toLowerCase() === artist.toLowerCase()) >= 0
        )
      );
      return this.albums.length;
    },
    tracks(){
      return this.albums.map(
        album => album.tk.filter(
          track => track.ar.findIndex(artist => this.artistName.toLowerCase() === artist.toLowerCase()) >= 0
        )
      ).reduce((prev, next) => prev.concat(next),[]);
    },
    artistRelated(){
      var arr = this.albums.map(
        album => album.tk.map(
          track => track.ar
        ).reduce((prev, next) => prev.concat(next),[])
      ).reduce((prev, next) => prev.concat(next),[]);
      // console.log([...new Set(arr)].sort());
      this.artistRelatedAll = [...new Set(arr)];
      return this.artistRelatedAll.filter(this.$parent.arrayComparer(this.artistRecommendedAll));
    },
    artistRecommended(){
      var arr = this.tracks.map(
        track => track.ar
      ).reduce((prev, next) => prev.concat(next),[]);
      this.artistRecommendedAll = [...new Set(arr)];
      // return this.artistRecommendedAll;
      return this.artistRecommendedAll.filter(this.$parent.arrayComparer([this.artistName]));
    },
    artistCurrent(){
      return this.artistRecommendedAll.filter(
        artist => this.artistName.toLowerCase() === artist.toLowerCase()
      );
    },
    artistGrouped(){
      var abc = this.$parent.arrayGroupby(this.$parent.artists);
      // console.log(abc)
      return abc;
      // return this.$parent.arrayGroupby();
      // return ['working'];
    },
    playsAlbum(){
      // [1, 2, 3, 4].reduce((a, b) => a + b, 0)
      return this.albums.reduce((a,b) => a + parseInt(b.tp),0);
    },
    playsTrack(){
      // [1, 2, 3, 4].reduce((a, b) => a + b, 0)
      // return this.tracks.reduce((a,b) => a + parseInt(b.p),0);
      // var arr = this.albums.map((a) => a.tk.map(s => s.p) );
      // return this.albums.map(
      //   album => album.tk.map(
      //     track => parseInt(track.p)
      //   ).reduce((a,b) => a + b,0)
      // ).reduce((a,b) => a + b,0);

      return this.tracks.reduce((a,b) => a + parseInt(b.p),0);
    },

    years(){
      var arr = this.albums.map((a) => a.yr );
      var yrs = arr.reduce((prev, next) => prev.concat(next),[]);
      return [...new Set(yrs)].sort();
    },
    totalTrack(){
      return this.tracks.length;
    },
    totalAlbum(){
      return this.albums.length;
    },
    totalLength(){
      var lengths = this.tracks.map(
        track => track.l
      );
      return this.$parent.formatTimer(lengths);
    },
  },
  // created() {},
  // beforeMount() {},
  // mounted () {},
}