const app = require('..');
const path = require('path');
const fs = require('fs');

const {Timer} = app.Common;
const {bucketActive,context,template} = app.Config;

const NodeID3 = require('node-id3');
const NodeMP3Duration = require('get-mp3-duration');

const Cloud = require('./cloud');
// var {setting} = require('../config');
const {readBucket,writeBucket} = require('./data');

exports.cloud = async function(){
  throwError();
  await readBucket();
  return await processor(readCloudID3);
  // HACK: testing
  // return await readCloudID3('music/'+app.Config.bucketActive+'/m3s/9/1.mp3');
}

exports.local = async function(){
  throwError();
  await readBucket();
  return await processor(readLocalID3);
  // HACK: testing
  // return await readLocalID3('music/'+app.Config.bucketActive+'/m3s/9.org/1.mp3');
}

async function processor(processorHelper){
    // throw 'please check the script and uncomment?';
  context.bucket.filter(e=>(!e.id)).map(
    e=>e.id=utility.createUniqueId()
  );

  // context.bucket.filter(e=>(!e.meta)).map(
  //   e=>e.meta={}
  // );

  context.bucket.filter(e=>(!e.track)).map(
    e=>e.track=[]
  );

  // const taskList = context.bucket.filter(e=>e.id == "a63b197309a5dcebd812")
  const taskMain = context.bucket.filter(
    e=>(app.Param[1] && app.Param[1] == e.id) || (!e.track.length && !app.Param[1])
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
        await processorHelper([active.dir,file].join('/')).then(
          tag=>active.track.push(tag.tmp)
        ).catch(
          error=>console.log(error)
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
    console.log('....(total,current)'.replace('total',taskTotal).replace('current',taskCurrent),active.dir);
    await scan(active);
    await writeBucket();
  }
  return 'Done';
}

function throwError() {
  if (!app.Param.length) throw '> require bucket';
  if (!app.Config.bucketActive) throw '> no such "?" bucket'.replace('?',app.Param.join('/'));
}

async function readCloudID3(file){
  return await Cloud.bucket.file(file).download().then(
    buffer => readId3(buffer[0],file)
  ).catch(
    e=> {
      throw e
    }
  );
};

async function readLocalID3(file){
  file = file.replace('music/myanmar/','d:/music/myanmar/');
  return await fs.promises.readFile(file).then(
    buffer => readId3(buffer,file)
  ).catch(
    e=> {
      throw e
    }
  );
};

async function readId3(buffer,file){
  try {
    // var tag = NodeID3.read(buffer[0]);
    var tag = await NodeID3.Promise.read(buffer);
    var meta = Object.assign({},template.bucketTrack,{ track:tag.trackNumber, year:tag.year});
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
    meta.duration= new Timer(NodeMP3Duration(buffer)).isMilliseconds().shorten();
    tag.tmp = meta;
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