module.exports = {
  config:{
    name: 'Zaideih',
    // description: 'package.description',
    // version: 'package.version'
    bucketAvailable:[
      'untitle',
      'zola',
      'myanmar',
      'mizo',
      'falam',
      'haka',
      'english',
      'chin',
      'korea',
      'norwegian',
      'collection'
    ],
    store:{
      album:'store/album.json',
      artist:'store/album.artist.json',
      genre:'store/album.genre.json',
      bucket:'store/bucket.?.json'
    },
    context:{
      album:[],
      artist:[],
      genre:[],
      bucket:[]
    },
    bucketActive:null,
    template:{
      bucket:{id:'?', dir:'?', raw:[], meta:{},track:[]},
      bucketTrack:{file:'', title:'', artist:[], albumartist:[], album:'', genre:[], track:0, year:0, duration:''},
      album:{ui:'?', ab:'?', gr:[], yr:[], lg:0, tk:[]},
      // albumTrack:{i:'?', t:'?', a:[], n: 0, d: "?", p: 1, s:0}
      albumTrack:{i:'?', t:'?', a:[], d: "?", p: 1}
    }
  }
};
/*
bucketAvailable:[
  'untitle',
  'zola',
  'myanmar',
  'mizo',
  'falam',
  'haka',
  'english',
  'chin',
  'korea',
  'norwegian',
  'collection'
],
bucketActive:null,
bucketFile:'store/bucket.?.json',
bucketContent:[],

albumFile:'store/album.json',
albumContent:[],
task:[],
template:{
  bucket:{id:'?', dir:'?', raw:[], meta:{},track:[]},
  bucketTrack:{file:'', title:'', artist:[], albumartist:[], album:'', genre:[], track:0, year:0, duration:'',},

  album:{ui:'?', ab:'?', gr:[], yr:[], lg:0, tk:[]},
  // albumTrack:{i:'?', t:'?', a:[], n: 0, d: "?", p: 1, s:0}
  albumTrack:{i:'?', t:'?', a:[], d: "?", p: 1}
},
artistFile:'store/album.artist.json',
artistContent:[],
genreFile:'store/album.genre.json',
genreContent:[]
*/