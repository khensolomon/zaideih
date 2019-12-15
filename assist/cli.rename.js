const app = require('..');
const path = require('path');
// const {utility} = app.Common;
const {bucketActive,context} = app.Config;
// const Cloud = require('./cloud');
const {readBucket} = require('./data');

// const artistsName = require('./artistsName.json');

// exports.main = async function(){
//   await Cloud.bucket.file('test/test.txt').move('test/test-renamed.txt');
//   console.log('done')
// }
exports.main = async function(){
  if (!app.Param.length) throw 'bucket required?';
  if (!bucketActive) throw 'bucket unavailable: 0'.replace(0,app.Param.join('/'));

  console.log('only testing')
  await readBucket();
  const taskBucket = context.bucket.filter(
    e=>(app.Param[1] && app.Param[1] == e.id) || (e.track.length && !app.Param[1])
  );
  // TODO rename at storage update sql then save bucketContent
  var counting = 0;
  for (const album of taskBucket) {
    // utility.log.msg({code:album.id,message:album.dir})
    for (const track of album.track) {
      // console.log(track.file)
      // path.parse(track.file).name;
      // track.file = track.track+'.mp3';
      // var nameOrginal = '0'.replace(0,track.file);
      // await storage.bucket(bucketName).file(srcFilename).move(destFilename);
      // var nameOrginal = track.file;

      var srcDir = album.dir+'/'+track.file;
      var _Name = path.parse(track.file).name.trim();
      var _Extension = path.extname(track.file).toLowerCase().trim();
      // var name = (_Name+_Extension).replace(/ {1,}/g," ").replace(/ - /g,'-').replace(/- /g,'-').replace(/ -/g,'-');
      var name = (_Name+_Extension).replace(/ {1,}/g," ").replace(/- /g,'-').replace(/ -/g,'-');
      // var name = (_Name+_Extension).replace(/ {1,}/g," ").replace(/(^|\s)-($|\s)/g,'-');
      var destDir = album.dir+'/'+name;
      if (track.file != name){
        counting++;
        var indexRaw = album.raw.findIndex(e=> e == track.file);
        album.raw[indexRaw]=name;
        track.file = name;
        console.log(srcDir,destDir)
      }

      // var name = track.track+'.mp3';
      // var indexRaw = album.raw.findIndex(e=> e == track.file);
      // album.raw[indexRaw]=name;
      // album.raw.filter(
      //   e=> e == track.file
      // ).map(
      //   e=>{
      //     album.raw[e]=name
      //   }
      // );
      // track.file = track.track+'.mp3';
    }
  }
  console.log(' ',counting)
  // console.log(taskBucket[0])
}
