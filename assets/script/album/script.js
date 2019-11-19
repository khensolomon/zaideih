import trackRow from '../components/track-row.vue';
import albumRaw from '../components/album-raw.vue';
// album-box, album-detail album-list, album-row
export default {
  name: 'Album',
  props: ['albumId','language'],
  data: () => ({
    albumsLimit: 9,
    activeLang:null,
  }),
  components: {
    trackRow, albumRaw
  },
  watch:{
  },
  methods: {
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
  },
  // filters:{
  //   sumplay: function(e){
  //     return e.reduce((a, b) => a + parseInt(b.p), 0);
  //   }
  // },
  computed: {
    $(){
      return this.$parent;
    },
    albums(){
      return this.$.all.album.filter(
        e => this.activeLang?e.lg == this.activeLang:true
      );
    },
    activeAlbum(){
      if (this.albumId){
        var lg = this.$.all.lang.find(e=>e.name.toLowerCase() == this.albumId.toLowerCase());
        if (lg){
          this.activeLang=lg.id;
        } else {
          return this.$.all.album.filter(
            e => e.ui == this.albumId || e.ab.toLowerCase() == this.albumId.toLowerCase()
          ).filter(
            // e=>e.tk.sort((a, b) => (a.n > b.n) ? 1 : -1)
            e=>e.tk
          )
        }
      }
      return [];
    }
  },
  // created() {},
  // beforeMount() {}
  // mounted () {},
}