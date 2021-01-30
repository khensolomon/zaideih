import {utility} from 'lethil';

import {store} from '../anchor/index.js';

const job={
  help:()=>console.table(Object.keys(job))
};
/**
 * check Track duplicates, trackNumber, empty, duration
 * check-:bucketName/:jobName
 * @param {any} req
 * node run check-zola/trackEmpty
 */
export default async function(req){

  var bucketName = req.params.bucketName;
  var jobName = req.params.jobName;

  store.bucket.id = bucketName;
  store.bucket.check();

  if (store.bucket.invalid) return store.bucket.invalid;

  await store.bucket.read();

  try {
    if (typeof job[jobName] == 'function') {
      return await job[jobName]() || 'Done';
    }
    return 'avaliable: '+ Object.keys(job).join(', ')
  } catch (error) {
    return error.message || error;
  }
}

job.trackEmpty = function(){
  const taskMain = store.bucket.data.filter(
    e => !e.track || !e.track.length
  );
  for (const active of taskMain) {
    console.dir(active.id, active.dir);
  }
}

job.albumId = async function(){
  store.bucket.data.filter(
    e => (!e.id)
  ).map(
    e => e.id=utility.createUniqueId()
  );
  store.bucket.data.filter(
    e => (!e.meta)
  ).map(
    e => e.meta={}
  );
  /*
  var idList =[
    '2d58191709bea03e5378'
  ];
  store.bucket.data.filter(e=>idList.includes(e.id)).map(
    e=>e.track.map(
      a=>{
        a.artist=[e.meta.artist]
        console.log(a.artist)
      }
    )
  );
  */

  store.bucket.data.filter(e=>(!e.track)).map(
    e=>e.track=[]
  );

  await store.bucket.write();

  const taskMain = store.bucket.data.map(e=>e.id)
  var albumIdDuplicates = taskMain.filter((item, index) => taskMain.indexOf(item) != index)
  if (albumIdDuplicates.length){
    console.log(albumIdDuplicates)
    return 'album Id Duplicates';
  }
}

job.trackDuration = async function(){
  var predicator = (row={}) => (!row.duration || row.duration.length <= 3);

  const taskMain = store.bucket.data.filter(
    e => e.track.length && e.track.filter(predicator).length
  );

  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(predicator));
  }
}

job.trackYear = async function(){
  var predicator = (row={}) => (!row.year || row.year.length <= 3 || row.year.length > 4 || isNaN(row.year) === true);

  const taskMain = store.bucket.data.filter(
    e => e.track.length && e.track.filter(predicator).length
  );

  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(predicator));
  }
}

job.trackArtist = async function(){
  var predicator = (row={}) => !row.artist || !row.artist.length;

  const taskMain = store.bucket.data.filter(
    e => e.track.length && e.track.filter(predicator).length
  );

  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(predicator));
  }
}

job.trackAlbum = async function(){
  var predicator = (row={}) => !row.album;

  const taskMain = store.bucket.data.filter(
    e => e.track.length && e.track.filter(predicator).length
  );

  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(predicator));
  }
}

job.trackNumber = async function(){
  var predicator = (row={}) => !row.track || isNaN(row.track) === true;

  const taskMain = store.bucket.data.filter(
    e => e.track.length && e.track.filter(predicator).length
  );

  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(predicator));
  }
}

job.trackTitle = async function(){
  var predicator = (row={}) => !row.title;

  const taskMain = store.bucket.data.filter(
    e => e.track.length && e.track.filter(predicator).length
  );

  for (const active of taskMain) {
    console.dir(active.dir);
    console.log(active.id);
    console.table(active.track.filter(predicator));
  }
}