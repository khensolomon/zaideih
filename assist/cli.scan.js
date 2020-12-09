const app = require('..');
const {utility} = app.Common;

const path = require('path');
const fs = require('fs');

const Cloud = require('./cloud');

const {readBucket,writeBucket} = require('./data');

exports.cloud = async function(){
  throwError();
  await readBucket();

  var dir = app.Param.slice();
  dir.unshift('music');

  const [files] = await Cloud.bucket.getFiles({
    directory:dir.join('/'),
    prefix:'/',
    // delimiter: '/',
    autoPaginate: true
  });

  return await processor(files);
}

exports.local = async function(){
  throwError();
  await readBucket();

  // dir = app.Param[1];
  dir  ='d:/music/myanmar/m3s';

  if (dir && fs.existsSync(dir)) {
    var raw = await getLocalFiles(dir);
    var files = raw.map(
      // e => ({name:path.join('music',app.Config.bucketActive,e.slice(2)).replace(/\\/g, '/'), local:e})
      e => ({name:e.slice(3).replace(/\\/g, '/'), local:e})
    );
  } else {
    if (dir){
      throw '> no such "?" directory'.replace('?',dir);
    } else {
      throw '> require directory';
    }
  }

  return await processor(files);
}

function throwError() {
  if (!app.Param.length) throw '> require bucket';
  if (!app.Config.bucketActive) throw '> no such "?" bucket'.replace('?',app.Param.join('/'));
}

async function getLocalFiles(dir) {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = path.resolve(dir, dirent.name);
    return dirent.isDirectory() ? getLocalFiles(res) : res;
  }));
  return Array.prototype.concat(...files);
}

async function processor(fileList) {
  if (fileList.length == 0) {
    throw '> found no file';
  }
  var tmp = [];
  const bucketContent = app.Config.context.bucket;
  var previousCount = bucketContent.length;
  for (const file of fileList) {
    if (!file.name.endsWith("/")){
      var folder = path.dirname(file.name);
      var filename = path.basename(file.name);
      var test = await bucketContent.filter(e=>e.dir == folder);
      if (test.length){
        if (tmp.indexOf(folder) === -1){
          test[0].raw=[];
          tmp.push(folder);
        }
        if (!test[0].id){
          test[0].id=utility.createUniqueId();
        }
        if (!test[0].meta){
          test[0].meta={}
        }
        test[0].raw.push(filename);
      } else {
        tmp.push(folder);
        bucketContent.push({id:utility.createUniqueId(),dir:folder,raw:[filename],meta:{},track:[]});
      }
    }
  }
  await writeBucket();
  console.log(' ',bucketContent.length, '/',bucketContent.length - previousCount,'...new directory, file not counted');
  return '> done';
}