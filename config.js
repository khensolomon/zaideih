module.exports = {
  config:{
    name: 'Zaideih',
    description: 'Zaideih Music Station',
    version: '1.0.3'
  },
  // NOTE just for development
  setting:{
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
    bucketFile:'bucket.?.json',
    bucketContent:[],

    albumFile:'album.json',
    albumContent:[],
    task:[],
    template:{
      bucket:{id:'?', dir:'?', raw:[], meta:{},track:[]},
      bucketTrack:{file:'', title:'', artist:[], albumartist:[], album:'', genre:[], track:0, year:0, duration:'',},

      album:{ui:'?', ab:'?', gr:[], yr:[], lg:0, tk:[]},
      // albumTrack:{i:'?', t:'?', a:[], n: 0, d: "?", p: 1, s:0}
      albumTrack:{i:'?', t:'?', a:[], d: "?", p: 1}
    },
    artistFile:'album.artist.json',
    artistContent:[],
    genreFile:'album.genre.json',
    genreContent:[],

  }
};