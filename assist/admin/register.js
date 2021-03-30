import path from 'path';
import {config,store,db} from '../anchor/index.js';

const {template,bucketAvailable} = config.setting;

/**
 * track and its plays count
 * register-:bucketName/:albumId?
 * @param {any} req
 * `node run register [bucket] [albumID(optional)]`
 * zola e8b619fa098dd5039452
 * [bucket] [albumID(optional)]
 */
export default async function(req){

  var bucketName = req.params.bucketName;
  var albumId = req.params.albumId;

  store.bucket.id = bucketName;
  store.bucket.check();

  if (store.bucket.invalid) return store.bucket.invalid;

  await store.bucket.read();
  const taskBucket = store.bucket.data.filter(
    e=>(albumId && albumId == e.id) || (e.track.length && !albumId)
  );

  await store.album.also.name.read();
  await store.album.read();
  await store.track.also.name.read();
  await store.artist.read();
  await store.genre.read();

  var select = await db.selectTrackAll();

  for (const album of taskBucket) {
    var update = 0, insert = 0;
    // NOTE: music/zola/...
    var dirAlbum = album.dir.split('/');
    dirAlbum.shift();
    const langName = dirAlbum.shift();
    const langId = bucketAvailable.findIndex(e=>e == langName.toLowerCase());

    // dirAlbum = dirAlbum.join('/');
    console.log('>',album.id,langId,album.dir);

    for (const track of album.track) {
      // var dir = [album.dir,track.file].join('/');
      // var dir = path.join(album.dir,track.file);
      // var dir = path.join(album.dir,track.file).replace(/\\/g,"/");
      // var dir = album.dir+'/'+track.file;
      var dir = dirAlbum.join('/')+'/'+track.file;
      track.lang = langId;
      if (!track.title){
        track.title=path.parse(track.file).name;
      }
      if (!track.artist.length && album.meta.artist){
        track.artist=album.meta.artist.split(/(?:,|;)+/);
      }
      if (!track.genre.length && album.meta.genre){
        track.genre=album.meta.genre.split(/(?:,|;)+/);
      }
      if (!track.album && album.meta.album){
        track.album=album.meta.album;
      }
      if (!track.year && album.meta.year){
        track.year=album.meta.year;
      }
      track.track = parseInt(track.track||0);
      track.artist = await indexArtists(track.artist);
      track.genre = await indexGenres(track.genre);

      var row = select.find(
        e => e.uid == album.id && e.lang == langId && e.dir == dir
      );
      if (row) {
        update++;
        track.id=row.id;
        track.plays=row.plays;
        // track.status=row.status;
      } else {
        insert++;
        var row = await db.insertTrack(album.id,langId,dir);
        track.id=row.insertId;
        track.plays=0;
        // track.status=0;
      }
    }
    var isOk = album.track.length == (update + insert);
    var msgTemplate = 'total:insert/update status';
    console.log(' ',
      msgTemplate,msgTemplate.replace(
        'total',album.track.length
      ).replace(
        'insert',insert.toString()
      ).replace(
        'update',update.toString()
      ).replace(
        'status',isOk.toString()
      )
    )
  }

  await taskAlbum(taskBucket);
  await store.artist.write();
  await store.genre.write();
  await store.album.write();
  return taskBucket.length?'done':'nothing todo';
}

/**
 * @param {*} taskBucket
 */
async function taskAlbum(taskBucket){
  for (const album of taskBucket) {
    if (album.track.length) {
      var albumTemplate = Object.assign({},template.album);
      // album:{ui:'?', ab:'?', gr:[], yr:[], lg:0, tk:[]},
      albumTemplate.ui = album.id;
      albumTemplate.ab = await albumNameCollection(album.track[0].album);

      var albumGenre = album.track.map(row => row.genre).reduce((prev, next) => prev.concat(next),[])
      albumTemplate.gr = [...new Set(albumGenre)].sort();

      var albumYear = album.track.map(row => parseInt(row.year)).reduce((prev, next) => prev.concat(next),[])
      albumTemplate.yr = [...new Set(albumYear)].sort();

      albumTemplate.lg = album.track[0].lang;
      // var albumLanguage = album.track.map(row => row.language).reduce((prev, next) => prev.concat(next),[])
      // albumTemplate.lg = [...new Set(albumLanguage)].sort();

      // var albumPlays = album.track.map(row => row.plays).reduce((prev, next) => prev.concat(next),[])
      // albumTemplate.p = albumPlays.reduce((total,num)=> total+num);

      albumTemplate.tk = [];
      album.track.sort((a, b) => (a.track > b.track) ? 1 : -1);
      // album.track.sort((a, b) => a.track - b.track);
      for (const track of album.track) {
        var trackTemplate = Object.assign({},template.albumTrack);
        // albumTrack:{i:'?', t:'?', a:[], n: 0, d: "?", p: 1, s:0}
        trackTemplate.i=track.id;
        trackTemplate.t= await trackNameCollection(track.title);
        trackTemplate.a=track.artist;
        // trackTemplate.n=track.track;
        // trackTemplate.n=parseInt(track.track||0);
        trackTemplate.d=convert2Seconds(track.duration);
        trackTemplate.p=track.plays;
        // trackTemplate.s=track.status;
        albumTemplate.tk.push(trackTemplate)
      }

      var index = store.album.data.findIndex(e=>e.ui == album.id);
      if (index >= 0 ){
        // console.log(' json:',album.id,'-> updated')
        store.album.data[index]=albumTemplate;
      } else {
        // console.log(' json:',album.id,'-> inserted')
        store.album.data.push(albumTemplate)
      }
    }
  }

}

/**
 * @param {*} i
 */
async function albumNameCollection(i){
  var name = i.trim().replace(/ {1,}/g," ");
  var nlc = name.toLowerCase();
  var nwd = nlc.includes(".")?nlc.replace(/\./g, ""):null;

  var index = store.album.also.name.data.find(
    e=>e.correction.find(s=> s.toLowerCase() == nlc ) || nwd && e.correction.includes(nwd) || e.name.toLowerCase() == name.toLowerCase()
  );
  if (index){
    return index.name;
  }
  return name;
}

/**
 * @param {*} i
 */
async function trackNameCollection(i){
  var name = i.trim().replace(/ {1,}/g," ");
  var nlc = name.toLowerCase();
  var nwd = nlc.includes(".")?nlc.replace(/\./g, ""):null;

  var index = store.track.also.name.data.find(
    e=>e.correction.find(s=> s.toLowerCase() == nlc ) || nwd && e.correction.includes(nwd) || e.name.toLowerCase() == name.toLowerCase()
  );
  if (index){
    return index.name;
  }
  return name;
}

/**
 * @param {*} artists
 */
async function indexArtists(artists){
  var result = artists.map(
    i => {
      var name = i.trim().replace(/ {1,}/g," ");
      var nlc = name.toLowerCase();
      var nwd = nlc.includes(".")?nlc.replace(/\./g, ""):null;

      // store.artist.data;

      // var index = store.artist.data.findIndex(
      //   e=>e.thesaurus.find(s=> s.toLowerCase() == nlc ) || nwd && e.thesaurus.includes(nwd) || e.name.toLowerCase() == name.toLowerCase() || e.aka && e.aka == name
      //   // e=>e.thesaurus.includes(nlc) || nwd && e.thesaurus.includes(nwd) || e.name.toLowerCase() == name.toLowerCase() || e.aka && e.aka == name
      // );
      var index = store.artist.data.findIndex(
        e => e.name.toLowerCase() == name.toLowerCase() || e.aka && e.aka == name || e.correction.find(
          s=> s.toLowerCase() == nlc || nwd && s.toLowerCase() == nwd
        ) || e.thesaurus.find(
          s=> s.toLowerCase() == nlc || nwd && s.toLowerCase() == nwd
        )
      );
      if (index < 0){
        var correction = [];
        if (nwd){
          correction.push(nwd)
        }
        store.artist.data.push({name:name,correction:correction,thesaurus:[]});
        index = store.artist.data.length - 1
      }
      return index;
    }
  );
  return [...new Set(result)];
}

/**
 * @param {*} genres
 */
async function indexGenres(genres){
  var result = genres.map(
    i=> {
      var name = i.trim().replace(/ {1,}/g," ");
      var nlc = name.toLowerCase();
      var nwd = nlc.includes(".")?nlc.replace(/\./g, ""):null;

      var index = store.genre.data.findIndex(
        // e=>e.correction.find(s=> s.toLowerCase() == nlc ) || nwd && e.correction.includes(nwd) || e.name.toLowerCase() == name.toLowerCase()
        e => e.name.toLowerCase() == name.toLowerCase() || e.correction.find(
          s=> s.toLowerCase() == nlc || nwd && s.toLowerCase() == nwd
        ) || e.thesaurus.find(
          s=> s.toLowerCase() == nlc || nwd && s.toLowerCase() == nwd
        )
      );
      if (index < 0){
        var correction = [];
        if (nwd){
          correction.push(nwd)
        }
        store.genre.data.push({name:name,correction:correction,thesaurus:[]});
        index = store.genre.data.length - 1
      }
      return index;
    }
  );
  return [...new Set(result)];
}

/**
 * eg. (HH:MM:SS) 3:23 to 203
 * @param {*} time
 */
function convert2Seconds(time) {
  var num = parseInt(time.toString().split(':').reduce(
    (a,b) => (60 * a)+ +b
    )
  );
  return isNaN(num)?0:num;
}