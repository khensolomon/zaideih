import trackRow from '../components/track-row.vue';
import albumRaw from '../components/album-raw.vue';
export default {
  name: 'Track',
  props: ['year','language','genre','searchQuery','searchAt'],
  data: () => ({
    // limitResult: 30,
    limitAlbum:9,
    limitAlbumRelated: 9,
    limitAlbumRecommended: 9,
    limitTrack:9,
    limitTrackByArtist:9,
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
      var searchPattern = new RegExp(this.searchQuery, 'i');
      return searchPattern.test(query);
    },
    playTrack(track){
      console.log(track);
    }
  },
  computed: {
    searchResult(){
      // TODO temp
      this.limitAlbum=9;
      this.limitAlbumRelated= 9;
      this.limitAlbumRecommended= 9;
      this.limitTrack=9;
      this.limitTrackByArtist=9;
      this.results = this.$parent.all.data.filter(
        album => this.searchPattern(album.ab) || album.tk.some(
          track => this.searchPattern(track.tl) || track.ar.some(
            artist => this.searchPattern(artist)
          )
        )
      );
      return this.results.length;
    },
    artists(){
      this.artistList = this.results.map(
        album => album.tk.map(
          track => track.ar
        ).reduce((prev, next) => prev.concat(next),[])
      ).reduce((prev, next) => prev.concat(next),[]).filter((value, index, self) => self.indexOf(value) === index);
      var tmp = this.artistList.filter(artist=>this.searchPattern(artist));
      if (tmp.length) this.tracksByArtistName = tmp[0];
      return tmp;
    },
    tracks(){
      this.trackList = this.results.map(
        album => album.tk
      ).reduce((prev, next) => prev.concat(next),[]);

      return this.trackList.filter(
        track => this.searchPattern(track.tl)
      );
    },
    tracksByArtist(){
      return this.trackList.filter(
        track => track.ar.findIndex(artist => this.tracksByArtistName.toLowerCase() === artist.toLowerCase()) >= 0
      ).filter(current => this.tracks.filter(other => other.id  == current.id).length == 0);
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