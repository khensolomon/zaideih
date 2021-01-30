export const setting = {
  name: 'Zaideih',
  // description: 'package.description',
  // version: 'package.version',
  locale:[
    {id:'en',name:'English',default:true},
    // {id:'no',name:'Norwegian'},
    // {id:'my',name:'Myanmar'},
    // {id:'zo',name:'Zolai'}
  ],
  table:{
  },
  bucketAvailable:[
    'untitle', //0
    'zola', // 1
    'myanmar', // 2
    'mizo', // 3
    'falam', // 4
    'haka', // 5
    'english', // 6
    'chin', // 7
    'korea', // 8
    'norwegian', // 9
    'collection' // 10
  ],
  // titleTrack titleAlbum album.title album.track album.name album.track track.name album.name name.track name.album
  store:{
    album:'store/album.json',
    artist:'store/artist.json',
    genre:'store/genre.json',
    // title:'store/track.name.json',
    trackName:'store/track.name.json',
    albumName:'store/album.name.json',
    bucket:'store/bucket.?.json'
  },
  // context:{
  //   album:[],
  //   artist:[],
  //   genre:[],
  //   title:[],
  //   trackName:[],
  //   albumName:[],
  //   bucket:[]
  // },
  bucketActive:null,
  template:{
    bucket:{id:'?', dir:'?', raw:[], meta:{},track:[]},
    bucketTrack:{file:'', title:'', artist:[], albumartist:[], album:'', genre:[], track:0, year:0, duration:''},
    album:{ui:'?', ab:'?', gr:[], yr:[], lg:0, tk:[]},
    // albumTrack:{i:'?', t:'?', a:[], n: 0, d: "?", p: 1, s:0}
    albumTrack:{i:'?', t:'?', a:[], d: 0, p: 1}
  }
};

export default {setting};
