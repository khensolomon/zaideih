const app = require('..');
const {path,Timer} = app.Common;

const NodeID3 = require('node-id3');
const NodeMP3Duration = require('get-mp3-duration');
// const NodeId3Parser= require('id3-parser');

const Cloud = require('./cloud');
var {setting} = require('../config');
const {readBucket,writeBucket} = require('./data');

exports.cloud = async function(){
  if (!app.Param.length) throw 'path?';
  if (!setting.bucketActive) throw 'path?';
  await readBucket();

  setting.bucketContent.filter(e=>(!e.id)).map(
    e=>e.id=utility.createUniqueId()
  );
  // setting.bucketContent.filter(e=>(!e.meta)).map(
  //   e=>e.meta={}
  // );
  setting.bucketContent.filter(e=>(!e.track)).map(
    e=>e.track=[]
  );
  // const taskList = setting.bucketContent.filter(e=>e.id == "a63b197309a5dcebd812")
  const taskMain = setting.bucketContent.filter(
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
        await readCloudID3([active.dir,file].join('/')).then(
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
}

var readCloudID3 = async function(file){
  return await Cloud.bucket.file(file).download().then(
    buffer=>{
      try {
        var tag = NodeID3.read(buffer[0]);
        var meta = Object.assign({},setting.template.bucketTrack,{ track:tag.trackNumber, year:tag.year});
        if (tag.title) meta.title=tag.title.trim();
        if (tag.album) meta.album=tag.album.trim();
        if (tag.artist) meta.artist=tag.artist.toString().split(',').map(s => s.trim())
        if (tag.genre) meta.genre=tag.genre.toString().split(',').map(s => s.trim())
        if (tag.performerInfo) meta.albumartist=tag.performerInfo.toString().split(',').map(s => s.trim());

        // var tag = NodeId3Parser.parse(buffer[0]);
        // var meta = Object.assign({},setting.template.bucketTrack,{track:tag.track || tag.trackNumber, year:tag.year||tag['recording-time']});
        // if (tag.title) meta.title=tag.title.trim();
        // if (tag.album) meta.album=tag.album.trim();
        // if (tag.artist) meta.artist=tag.artist.toString().split(',').map(s => s.trim())
        // if (tag.genre) meta.genre=tag.genre.toString().split(',').map(s => s.trim())
        // if (tag.composer) meta.albumartist=tag.composer.toString().split(',').map(s => s.trim());


        meta.file = path.basename(file);
        meta.duration= new Timer(NodeMP3Duration(buffer[0])).isMilliseconds().shorten();
        tag.tmp = meta;
        return tag
      } catch (error) {
        throw error
      }
    }
  ).catch(
    e=> {
      throw e
    }
  );
};

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