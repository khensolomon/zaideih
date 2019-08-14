import trackRow from '../components/track-row.vue';
import albumRaw from '../components/album-raw.vue';
// album-box, album-detail album-list, album-row
export default {
  name: 'Album',
  props: ['albumId','language'],
  data: () => ({
    limitAlbum: 9,
    activeLang:null,
  }),
  components: {
    trackRow,
    albumRaw
  },
  watch:{
  },
  methods: {

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
    playTrack: function(e){
      this.$parent.addQueue(e);
    },
    albumArtist: function(e){
      var o = e.map((a) => a.ar );
      return new Set([].concat.apply([], o));
    },
    formatTimer(e){
      // return new Timer(e.map(e=>e.l)).format();
      return this.$parent.formatTimer(e.map(i=>i.l));
    }
  },
  filters:{
    sumplay: function(e){
      return e.reduce((a, b) => a + parseInt(b.p), 0);
    }
  },
  computed: {
    albums(){
      return this.$parent.all.data.filter((e) => {
        return this.activeLang?e.lg.indexOf(this.activeLang.toString()) >= 0:true;
      });
    },
    langs(){
      return this.$parent.langs;
    },
    activeAlbum(){
      if (this.albumId){
        var lg = this.langs.filter(e=>e.name.toLowerCase() == this.albumId.toLowerCase());
        if (lg.length){
          this.activeLang=lg[0].id;
        } else {
          return this.$parent.all.data.filter((e) => {
            return e.ui == this.albumId || e.ab.toLowerCase() == this.albumId.toLowerCase()
          });
        }
      }
      return [];
      // return this.$parent.all.data.filter((e) => {
      //   return e.ui == this.albumId || e.ab == this.albumId
      // });
    }
  },
  // created() {},
  // beforeMount() {}
  // mounted () {},
}