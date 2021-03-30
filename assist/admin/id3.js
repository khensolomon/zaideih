import path from 'path';
import fs from 'fs';
import {utility,timer} from 'lethil';
import {config,store,cloud} from '../anchor/index.js';

import NodeID3 from 'node-id3';
import NodeMP3Duration from 'get-mp3-duration';

const job={
  help:()=>console.table(Object.keys(job)),
  // params:{} -> req.params,
  // reader:{} -> id3 reader method
};
/**
 * need to remove - NodeMP3Duration
 * id3-:jobName/:bucketName/:albumId?
 * @param {any} req
 * node run id3-cloud/zola
 * node run id3-cloud/zola/617119a809b161d81cee
 * node run id3-local/myanmar/3f47207211bbc340a36f
 *
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
      job.params = req.params;
      return await job[jobName]() || 'Done';
    }
    return 'avaliable: '+ Object.keys(job).join(', ')
  } catch (error) {
    return error.message || error;
  }
}

job.cloud = async function(){
  job.reader=readCloudID3;
  await processor();
}

job.local = async function(){
  job.reader=readLocalID3;
  await processor();
}

async function processor(){
  // throw 'please check the script and uncomment?';
  store.bucket.data.filter(e=>(!e.id)).map(
    e => e.id=utility.createUniqueId()
  );

  // store.bucket.data.filter(e=>(!e.meta)).map(
  //   e => e.meta={}
  // );

  store.bucket.data.filter(e=>(!e.track)).map(
    e => e.track=[]
  );

  // const taskList = store.bucket.data.filter(e=>e.id == "a63b197309a5dcebd812")

  const taskMain = store.bucket.data.filter(
    e => (job.params.albumId && job.params.albumId == e.id) || (!e.track.length && !job.params.albumId)
  ).map(e=>{
    e.task=[];
    e.track=[];
    e.raw.map(
      file => {
        e.task.push(file)
      }
    );
    return e;
  });

  var scan = async function(active){
    if (active.task.length){
      var file = active.task.shift();
      if (file.split('.').pop().toLowerCase()=='mp3'){
        // var dir = [active.dir,file];
        // path.join(active.dir,file)
        await job.reader([active.dir,file].join('/')).then(
          tag => active.track.push(tag.tmp)
        ).catch(
          error => console.log(error)
        );
        console.log('.....',file);
      }
      await scan(active);
    }
  };
  var taskTotal = taskMain.length;
  var taskCurrent = 0;

  for (const active of taskMain) {
    taskCurrent++;
    console.log(`....(${taskTotal},${taskCurrent}) ${active.dir}`);
    await scan(active);
    await store.bucket.write();
  }
}

async function readCloudID3(file=''){
  return await cloud.bucket.file(file).download().then(
    (buffer) => readId3(buffer[0],file)
  ).catch(
    e=> {
      throw e
    }
  );
};

async function readLocalID3(file=''){
  // file = file.replace('music/myanmar/','d:/music/myanmar/');
  // file = file.replace('music/zola/','d:/music/zola/');
  file = 'd:/'+file;
  return await fs.promises.readFile(file).then(
    buffer => readId3(buffer,file)
  ).catch(
    e=> {
      throw e
    }
  );
};

/**
 * @param {Buffer} buffer
 * @param {string} file
 */
async function readId3(buffer,file){
  try {
    // var tag = NodeID3.read(buffer[0]);

    var tag = await NodeID3.Promise.read(buffer);
    var meta = Object.assign({},config.setting.template.bucketTrack,{ track:tag.trackNumber, year:tag.year});
    if (tag.title) meta.title=tag.title.trim();
    if (tag.album) meta.album=tag.album.trim();
    if (tag.artist) meta.artist=tag.artist.toString().split(/(?:,|;)+/).map(s => s.trim())
    if (tag.genre) meta.genre=tag.genre.toString().split(/(?:,|;)+/).map(s => s.trim())
    if (tag.performerInfo) meta.albumartist=tag.performerInfo.toString().split(/(?:,|;)+/).map(s => s.trim());

    // var tag = NodeId3Parser.parse(buffer[0]);
    // var meta = Object.assign({},template.bucketTrack,{track:tag.track || tag.trackNumber, year:tag.year||tag['recording-time']});
    // if (tag.title) meta.title=tag.title.trim();
    // if (tag.album) meta.album=tag.album.trim();
    // if (tag.artist) meta.artist=tag.artist.toString().split(',').map(s => s.trim())
    // if (tag.genre) meta.genre=tag.genre.toString().split(',').map(s => s.trim())
    // if (tag.composer) meta.albumartist=tag.composer.toString().split(',').map(s => s.trim());


    meta.file = path.basename(file);
    meta.duration= timer(NodeMP3Duration(buffer)).isMilliseconds().shorten();
    tag['tmp'] = meta;
    return tag
  } catch (error) {
    throw error
  }
}

// exports.readCloudID3 = async function(file){
//   return await Cloud.bucket.file(file).download().then(
//     buffer=>{
//       try {
//         var tag = NodeID3.read(buffer[0]);
//         var meta = Object.assign({},setting.album.track,{ track:tag.trackNumber, year:tag.year});
//         if (tag.title) meta.title=tag.title.trim();
//         if (tag.album) meta.album=tag.album.trim();
//         if (tag.artist) meta.artist=tag.artist.toString().split(',').map(s => s.trim())
//         if (tag.genre) meta.genre=tag.genre.toString().split(',').map(s => s.trim())
//         if (tag.performerInfo) meta.albumartist=tag.performerInfo.toString().split(',').map(s => s.trim());

//         meta.file = path.basename(file);
//         meta.duration= new Timer(NodeMP3Duration(buffer[0])).isMilliseconds().shorten();
//         tag.tmp = meta;
//         return tag
//       } catch (error) {
//         throw error
//       }
//     }
//   ).catch(
//     e=> {
//       throw e
//     }
//   );
// };

/*
exports.readCloudID3 = async function(file){
return await Cloud.bucket.file(file).download().then(
  buffer=>{
    try {
      var tag = NodeID3.read(buffer[0]);
      tag.tmp = createTrackData(tag,true)
      tag.tmp.file = path.basename(file);
      tag.tmp.duration= new Timer(NodeMP3Duration(buffer[0])).isMilliseconds().shorten();
      return tag
    } catch (error) {
      try {
        var tag = NodeId3Parser.parse(buffer[0]);
        tag.tmp = createTrackData(tag)
        tag.tmp.file = path.basename(file);
        tag.tmp.duration= new Timer(NodeMP3Duration(buffer[0])).isMilliseconds().shorten();
        return tag
      } catch (error) {
        throw error
      }
    }
  }
).catch(
  e=> {
    throw e
  }
);
};
exports.createTrackData = function(tag,is){
if (is) {
  // NOTE: NodeID3
  var meta = Object.assign({},setting.album.track,{ track:tag.trackNumber, year:tag.year});
  if (tag.title) meta.title=tag.title.trim();
  if (tag.album) meta.album=tag.album.trim();
  if (tag.artist) meta.artist=tag.artist.toString().split(',').map(s => s.trim())
  if (tag.genre) meta.genre=tag.genre.toString().split(',').map(s => s.trim())
  if (tag.performerInfo) meta.albumartist=tag.performerInfo.toString().split(',').map(s => s.trim());
} else {
  // NOTE:  NodeId3Parser
  var meta = Object.assign({},setting.album.track,{track:tag.track || tag.trackNumber, year:tag.year||tag['recording-time']});
  if (tag.title) meta.title=tag.title.trim();
  if (tag.album) meta.album=tag.album.trim();
  if (tag.artist) meta.artist=tag.artist.toString().split(',').map(s => s.trim())
  if (tag.genre) meta.genre=tag.genre.toString().split(',').map(s => s.trim())
  if (tag.composer) meta.albumartist=tag.composer.toString().split(',').map(s => s.trim());
}
return meta
};
*/