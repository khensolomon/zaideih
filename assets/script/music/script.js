import trackRow from '../components/track-row.vue';
import albumRaw from '../components/album-raw.vue';
export default {
  name: 'Track',
  props: ['year','language','genre','searchQuery','searchAt'],
  data: () => ({
    // limitResult: 30,
    albumLimit:9,
    albumsRelatedLimit: 9,
    albumsRecommendedLimit: 9,
    tracksLimit:9,
    tracksByArtistLimit:9,
    results:[],
    artistList:[],
    tracksByArtistName:'',
    trackList:[],
    albumList:[]
  }),
  components: {
    trackRow, albumRaw
  },
  methods: {
    searchPattern(query){
      return new RegExp(this.searchQuery, 'i').test(query);
    },
    playTrack(track){
      console.log(track);
    }
  },
  watch: {
    tracksLimit(e){
      this.tracksLimit = e<this.tracks.length?e:this.tracks.length;
    },
    tracksByArtistLimit(e){
      this.tracksByArtistLimit = e<this.tracksByArtist.length?e:this.tracksByArtist.length;
    },
  },
  computed: {
    $(){
      return this.$parent;
    },
    searchResult(){
      // TODO temp

      // this.results = this.$parent.old.filter(
      //   album => this.searchPattern(album.ab) || album.tk.some(
      //     track => this.searchPattern(track.tl) || track.ar.some(
      //       artist => this.searchPattern(artist)
      //     )
      //   )
      // );
      this.artistList = this.$.all.artist.filter(
        e=>e.thesaurus.find(
          s=> this.searchPattern(s)
        ) || this.searchPattern(e.name) || e.aka && this.searchPattern(e.aka)
      ).sort((a, b) => (a.plays < b.plays) ? 1 : -1);
      // var artistsearch = [172,4].filter(
      //   e=>artistIndex.find(i=>i.id == e)
      // );
      this.results = this.$.all.album.filter(
        album => this.searchPattern(album.ab) || album.tk.some(
          track => this.searchPattern(track.t) || track.a.find(
            id => this.artistList.find(i=> id == i.id)
          )
        )
      );
      this.trackList = this.results.map(
        album => album.tk
      ).reduce((prev, next) => prev.concat(next),[]);

      this.albumLimit=9;
      this.albumsRelatedLimit= 9;
      this.albumsRecommendedLimit= 9;
      this.tracksLimit=9;
      this.tracksByArtistLimit=9;

      return this.results.length;
    },

    tracks(){
      console.log('tracks')
      this.trackList = this.results.map(
        album => album.tk
      ).reduce((prev, next) => prev.concat(next),[]);

      return this.trackList.filter(
        track => this.searchPattern(track.t)
      );
    },

    artists(){
      // this.artistList = this.results.map(
      //   album => album.tk.map(
      //     track => track.ar
      //   ).reduce((prev, next) => prev.concat(next),[])
      // ).reduce((prev, next) => prev.concat(next),[]).filter((value, index, self) => self.indexOf(value) === index);
      // var tmp = this.artistList.filter(artist=>this.searchPattern(artist));
      // if (tmp.length) this.tracksByArtistName = tmp[0];
      // return tmp;
      return this.artistList;
    },

    tracksByArtist(){
      return this.trackList.filter(
        // track => track.a.findIndex(artist => this.tracksByArtistName.toLowerCase() === artist.toLowerCase()) >= 0
        track => track.a.find(
          id => this.artistList.find(i=> id == i.id)
        )
      ).filter(current => this.tracks.filter(other => other.i  == current.i).length == 0);
    },
    albums(){
      this.albumList = this.results.filter(
        album => this.searchPattern(album.ab)
      );
      return this.albumList;
    },
    albumsRecommended(){
      return this.results.filter(
        current => this.albumList.filter(
          other => other.ui == current.ui
        ).length == 0
      );
    },
    albumsRelated(){
      return this.results.filter(
        current => this.albumList.concat(this.albumsRecommended).filter(
          other => other.ui  == current.ui
        ).length == 0
      );
    }
  },
  // created() {},
  // beforeMount() {},
  mounted () {
    // console.log(this.genre,this.language,this.year,this.searchQuery,this.searchAt);
  },
}
/*
var str = "Hello world, welcome to the universe.";
var n = str.includes("world");

if (stringToCheck.substr(0, query.length).toUpperCase() == query.toUpperCase())

var searchPattern = new RegExp('^' + query);
if (searchPattern.test(stringToCheck)) {}
*/