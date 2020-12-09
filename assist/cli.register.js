const app = require('..');
const path = require('path');
const {bucketActive,context,bucketAvailable,template} = app.Config;

const {readBucket,readAlbum,readArtist,writeArtist,readGenre,writeGenre,writeAlbum,selectDatabase,insertDatabase,selectAllTrack,readTitle} = require('./data');

function throwError() {
  if (!app.Param.length) throw '> require bucket';
  if (!app.Config.bucketActive) throw '> no such "?" bucket'.replace('?',app.Param.join('/'));
}

exports.main = async function(){
  throwError();

  await readBucket();
  // const taskBucket = context.bucket;
  const taskBucket = context.bucket.filter(
    e=>(app.Param[1] && app.Param[1] == e.id) || (e.track.length && !app.Param[1])
  );

  await readTitle();
  await readArtist();
  await readGenre();
  await readAlbum();

  // var select = [];
  var select = await selectAllTrack();

  for (const album of taskBucket) {
    console.log('>',album.id,album.dir);
    var update = 0, insert = 0;
    const language = await bucketAvailable.findIndex(e=>e == album.dir.split('/')[1].toLowerCase());
    for (const track of album.track) {
      var dir = [album.dir,track.file].join('/');
      // var dir = path.join(album.dir,track.file);
      // var dir = path.join(album.dir,track.file).replace(/\\/g,"/");
      // var dir = album.dir+'/'+track.file;
      track.lang = language;
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

      var row = await select.find(
        e => e.uid == album.id && e.dir == dir
      );
      if (row) {
        update++;
        track.id=row.id;
        track.plays=row.plays;
        track.status=row.status;
      } else {
        var row = await insertDatabase(album.id,dir);
        insert++;
        track.id=row.insertId;
        track.plays=0;
        track.status=0;
      }

    }
    var isOk = album.track.length == (update + insert);
    var msgTemplate = 'total:insert/update status';
    console.log(' ','db',msgTemplate,msgTemplate.replace('total',album.track.length).replace('insert',insert).replace('update',update).replace('status',isOk))
  }

  await taskAlbum(taskBucket);
  await writeArtist();
  await writeGenre();
  await writeAlbum();
  return taskBucket.length?'done':'nothing todo'
}

async function taskAlbum(taskBucket){
  for (const album of taskBucket) {
    if (album.track.length) {
      var albumTemplate = Object.assign({},template.album);
      // album:{ui:'?', ab:'?', gr:[], yr:[], lg:0, tk:[]},
      albumTemplate.ui = album.id;
      albumTemplate.ab = album.track[0].album;

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
        trackTemplate.t= await titleCorrention(track.title);
        trackTemplate.a=track.artist;
        // trackTemplate.n=track.track;
        // trackTemplate.n=parseInt(track.track||0);
        trackTemplate.d=convert2Seconds(track.duration);
        trackTemplate.p=track.plays;
        // trackTemplate.s=track.status;
        albumTemplate.tk.push(trackTemplate)
      }

      var index = context.album.findIndex(e=>e.ui == album.id);
      if (index >= 0 ){
        // console.log(' json:',album.id,'-> updated')
        context.album[index]=albumTemplate;
      } else {
        // console.log(' json:',album.id,'-> inserted')
        context.album.push(albumTemplate)
      }
    }
  }

}

async function indexArtists (artists){
  var result = artists.map(
    i=> {
      var name = i.trim().replace(/ {1,}/g," ");
      var nameLC = name.toLowerCase();
      var nameWD = nameLC.includes(".")?nameLC.replace(/\./g, ""):null

      var index = context.artist.findIndex(
        e=>e.thesaurus.find(s=> s.toLowerCase() == nameLC ) || nameWD && e.thesaurus.includes(nameWD) || e.name.toLowerCase() == name.toLowerCase() || e.aka && e.aka == name
        // e=>e.thesaurus.includes(nameLC) || nameWD && e.thesaurus.includes(nameWD) || e.name.toLowerCase() == name.toLowerCase() || e.aka && e.aka == name
      );
      if (index < 0){
        var thesaurus = [];
        if (nameWD){
          thesaurus.push(nameWD)
        }
        context.artist.push({name:name,thesaurus:thesaurus});
        index = context.artist.length - 1
      }
      return index;
    }
  );
  return [...new Set(result)];
}

async function titleCorrention(i){

  var name = i.trim().replace(/ {1,}/g," ");
  var nameLC = name.toLowerCase();
  var nameWD = nameLC.includes(".")?nameLC.replace(/\./g, ""):null

  var index = context.title.find(
    e=>e.thesaurus.find(s=> s.toLowerCase() == nameLC ) || nameWD && e.thesaurus.includes(nameWD) || e.name.toLowerCase() == name.toLowerCase()
  );
  if (index){
    return index.name;
  }
  return name;
}

async function indexGenres (genres){
  var result = genres.map(
    i=> {
      var name = i.trim().replace(/ {1,}/g," ");
      var nameLC = name.toLowerCase();
      var nameWD = nameLC.includes(".")?nameLC.replace(/\./g, ""):null

      var index = context.genre.findIndex(
        e=>e.thesaurus.find(s=> s.toLowerCase() == nameLC ) || nameWD && e.thesaurus.includes(nameWD) || e.name.toLowerCase() == name.toLowerCase()
      );
      if (index < 0){
        var thesaurus = [];
        if (nameWD){
          thesaurus.push(nameWD)
        }
        context.genre.push({name:name,thesaurus:thesaurus});
        index = context.genre.length - 1
      }
      return index;
    }
  );
  return [...new Set(result)];
}

function convert2Seconds(time) {
  // var time = "00:3:50";
  if (!time) return 0;
  var i = time.split(":");
  if (i.length > 2) {
    return (parseInt(i[0], 10) * 60 * 60) + (parseInt(i[1], 10) * 60) + parseInt(i[2], 10)
  } else if (i.length == 2) {
    return (parseInt(i[0], 10) * 60) + parseInt(i[1], 10)
  } else if (isNaN(i[0])) {
    return 0
  } else {
    return parseInt(i[0], 10);
  }
}


/*
exports.playsupdate = async function(){
  throw 'playsupdate has only one responsibility, which is to import Old playsCount data';
  throwError();

  //SELECT distinct t.PLAYS AS plays, concat_ws('/', 'music',a.`PATH`, t.`PATH`) AS dir FROM zd_track AS t, zd_album AS a WHERE t.UNIQUEID = a.UNIQUEID LIMIT ? OFFSET ?;
  var query = "SELECT * FROM zd_track AS t, zd_album AS a WHERE a.PATH LIKE '?/%' AND t.UNIQUEID = a.UNIQUEID AND t.PLAYS > 1;".replace('?',app.Param[0]);
  var raw = await app.sql.query(query.replace('*','count(0) AS totalRow'))
  var limit = 1;
  var totalRow = 0;

  async function update(limit,offset){
    var selector = query.replace('*',"distinct t.PLAYS AS plays, concat_ws('/', 'music',a.`PATH`, t.`PATH`) AS dir").replace(';',' LIMIT ? OFFSET ?;')
    var row = await app.sql.query(selector,[limit,offset]);

    if (row.length){
      var data = row[0];
      var updateStatus = await app.sql.query("UPDATE track SET plays = ? WHERE dir LIKE ?",[data.plays,data.dir]);
      console.log('update(total/current)'.replace('total',totalRow).replace('current',offset),updateStatus.affectedRows,data.dir,data.plays);
    }
  }
  if (raw.length){
    totalRow = raw[0].totalRow;
    for (let activePage = 0; activePage < totalRow; activePage++) {
      var offset = limit * activePage;
      await update(limit,offset);
    }
  } else {
    console.log('none')
  }
}
*/

/*
exports.main = async function(){
  if (!app.Param.length) throw {code:'require',message:'directory'};
  if (!bucketActive) throw {code:'unavailable',message:app.Param.join('/')};

  await readBucket();
  await readAlbum();

  const taskBucket = context.bucket.filter(
    e=>(app.Param[1] && app.Param[1] == e.id) || (e.track.length && !app.Param[1])
  );
  // const taskBucket = context.bucket;

  for (const album of taskBucket) {
    utility.log.msg({code:album.id,message:album.dir})
    var update = 0, insert = 0;
    const language = bucketAvailable.findIndex(e=>e == album.dir.split('/')[1].toLowerCase());
    for (const track of album.track) {
      var dir = [album.dir,track.file];
      // var dir = path.join(album.dir,track.file);
      // var dir = path.join(album.dir,track.file).replace(/\\/g,"/");
      // var dir = album.dir+'/'+track.file;
      track.language = language;
      var select = await selectDatabase(album.id,dir.join('/'));
      if (!select.length){
        var row = await insertDatabase(album.id,dir.join('/'));
        insert++;
        track.id=row.insertId;
        track.plays=1;
        track.status=0;
      } else {
        update++;
        track.id=select[0].id;
        track.plays=select[0].plays;
        track.status=select[0].status;
      }
    }
    var isOk = album.track.length == (update + insert);
    var msgTemplate = 'total:update/insert status';
    console.log(' ','db',msgTemplate,msgTemplate.replace('total',album.track.length).replace('update',update).replace('insert',insert).replace('status',isOk))
  }

  for (const album of taskBucket) {

    var albumTemplate = Object.assign({},template.album);
    albumTemplate.ui = album.id;
    albumTemplate.ab = album.track[0].album;

    var albumYear = album.track.map(row => row.year).reduce((prev, next) => prev.concat(next),[])
    albumTemplate.yr = [...new Set(albumYear)].sort();

    var albumGenre = album.track.map(row => row.genre).reduce((prev, next) => prev.concat(next),[])
    albumTemplate.gr = [...new Set(albumGenre)].sort();

    var albumLanguage = album.track.map(row => row.language).reduce((prev, next) => prev.concat(next),[])
    albumTemplate.lg = [...new Set(albumLanguage)].sort();

    var albumPlays = album.track.map(row => row.plays).reduce((prev, next) => prev.concat(next),[])
    albumTemplate.tp = albumPlays.reduce((total,num)=> total+num);


    albumTemplate.tk = [];
    for (const track of album.track) {
      var trackTemplate = Object.assign({},template.albumTrack);
      // {id:'?', tl:'?', ar:[], n: 0, t: 0, l: "?", p: 1, s:0}
      trackTemplate.id=track.id;
      trackTemplate.tl=track.title;

      var artistResult = track.artist.map(
        i=> {
          var name = i.trim().replace(/ {1,}/g," ");
          return artistsName.filter(
            e=>e.thesaurus.includes(name.toLowerCase())
          ).map(e=>e.name)[0] || name
        }
      );

      trackTemplate.ar=[...new Set(artistResult)];
      // console.log(trackTemplate.ar)
      trackTemplate.n=parseInt(track.track);
      trackTemplate.l=track.duration;
      trackTemplate.p=track.plays;
      trackTemplate.s=track.status;
      albumTemplate.tk.push(trackTemplate)
    }

    var index = context.album.findIndex(e=>e.ui == album.id);
    if (index >= 0 ){
      // console.log(' json:',album.id,'-> updated')
      context.album[index]=albumTemplate;
    } else {
      // console.log(' json:',album.id,'-> inserted')
      context.album.push(albumTemplate)
    }
  }
  await writeAlbum();
  return taskBucket.length?'done':'nothing todo'
}
*/