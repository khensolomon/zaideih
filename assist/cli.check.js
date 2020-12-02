const app = require('..');
const {utility} = app.Common;
const {context} = app.Config;

var {setting} = require('../config');
const {readBucket,writeBucket} = require('./data');

exports.checkAlbumId = async function(){
  await readBucket();
  context.bucket.filter(e=>(!e.id)).map(
    e=>e.id=utility.createUniqueId()
  );
  context.bucket.filter(e=>(!e.meta)).map(
    e=>e.meta={}
  );
  /*
  var idList =[
    '2d58191709bea03e5378'
  ];
  context.bucket.filter(e=>idList.includes(e.id)).map(
    e=>e.track.map(
      a=>{
        a.artist=[e.meta.artist]
        console.log(a.artist)
      }
    )
  );
  */

  context.bucket.filter(e=>(!e.track)).map(
    e=>e.track=[]
  );
  await writeBucket();
  const taskMain = context.bucket.map(e=>e.id)
  var albumIdDuplicates = taskMain.filter((item, index) => taskMain.indexOf(item) != index)
  if (albumIdDuplicates.length){
    console.log(albumIdDuplicates)
    return '.... album Id Duplicates'
  }
}

exports.checkTrackEmpty = async function(){
  await readBucket();
  const taskMain = context.bucket.filter(
    e => !e.track || !e.track.length
  );
  for (const active of taskMain) {
    console.dir(active.id, active.dir);
  }
}

exports.checkTrackDuration = async function(){
  await readBucket();
  var trackFilter = (row) => (!row.duration || row.duration.length <= 3);
  const taskMain = context.bucket.filter(
    e => e.track.length && e.track.filter(trackFilter).length
  );
  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(trackFilter));
  }
}

exports.checkTrackYear = async function(){
  await readBucket();
  var trackFilter = (row) => (!row.year || row.year.length <= 3 || row.year.length > 4 || isNaN(row.year) === true);
  const taskMain = context.bucket.filter(
    e => e.track.length && e.track.filter(trackFilter).length
  );
  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(trackFilter));
  }
}

exports.checkTrackArtist = async function(){
  await readBucket();
  var trackFilter = (row) => !row.artist || !row.artist.length;
  const taskMain = context.bucket.filter(
    e => e.track.length && e.track.filter(trackFilter).length
  );
  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(trackFilter));
  }
}

exports.checkTrackAlbum = async function(){
  await readBucket();
  var trackFilter = (row) => !row.album;
  const taskMain = context.bucket.filter(
    e => e.track.length && e.track.filter(trackFilter).length
  );
  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(trackFilter));
  }
}

exports.checkTrackNumber = async function(){
  await readBucket();
  var trackFilter = (row) => !row.track || isNaN(row.track) === true;
  const taskMain = context.bucket.filter(
    e => e.track.length && e.track.filter(trackFilter).length
  );
  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(trackFilter));
  }
}

exports.checkTrackTitle = async function(){
  await readBucket();
  var trackFilter = (row) => !row.title;
  const taskMain = context.bucket.filter(
    e => e.track.length && e.track.filter(trackFilter).length
  );
  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    // console.log(active.track)
    console.table(active.track.filter(trackFilter));
  }
}
