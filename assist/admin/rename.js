import path from 'path';
import {store,cloud} from '../anchor/index.js';

// const {template,bucketAvailable} = config.setting;

const job={
  help:()=>console.table(Object.keys(job)),
  // params:{} -> req.params
};
/**
 * only testing, please check the script and uncomment? still working
 * rename-:jobName/:bucketName/:albumId?
 * @param {any} req
 * node run rename-cloud/zola
 * node run rename-cloud/zola/617119a809b161d81cee
 * node run rename-testing/zola/617119a809b161d81cee
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
  // await cloud.bucket.file('test/test.txt').move('test/test-renamed.txt');
  return 'nothing todo'
}

job.local = async function(){
  // await cloud.bucket.file('test/test.txt').move('test/test-renamed.txt');
  return 'nothing todo'
}

job.testing = async function(){

  const taskBucket = store.bucket.data.filter(
    e=>(job.params.albumId && job.params.albumId == e.id) || (e.track.length && !job.params.albumId)
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
  // console.log(taskBucket[0])
  return counting.toString();
}