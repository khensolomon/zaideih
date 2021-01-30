import path from 'path';
import fs from 'fs';
import {utility} from 'lethil';

import {config,store,cloud} from '../anchor/index.js';

/**
 * scan-:jobName/:bucketName/:more?
 * @param {any} req
 * node run scan-cloud/zola
 * node run scan-local/myanmar/m3s/10
 */
export default async function(req){

  var bucketName = req.params.bucketName;
  var jobName = req.params.jobName;

  store.bucket.id = bucketName;
  store.bucket.check();

  if (store.bucket.invalid) return store.bucket.invalid;

  await store.bucket.read();
  var file = [];
  try {
    if (jobName == 'cloud'){
      file = await cloudDirectory(req.pathname);
    } else if (jobName == 'local') {
      file = await localDirectory(req.pathname);
    } else {
      throw '> no such "?" method'.replace('?',jobName);
    }
    return await processor(file);
  } catch (error) {
    return error.message || error;
  }
}

/**
 * @param {string} dir
 * @returns {Promise<{name:string}[]>}
 */
async function cloudDirectory(dir){
  dir = dir.replace('/scan-cloud','music');

  const [files] = await cloud.bucket.getFiles({
    directory: dir,
    prefix:'/',
    // delimiter: '/',
    autoPaginate: true
  });
  return files;
}

/**
 * @param {string} dir
 * @returns {Promise<{name:string,local:string}[]>}
 */
async function localDirectory(dir){
  dir = dir.replace('/scan-local','d:/music');
  // dir = app.Param[1];
  // dir  ='d:/music/myanmar/m3s';

  return await localDirectoryEach(dir);
}

/**
 * @param {string} dir
 * @returns {Promise<any>}
 */
async function localDirectoryEach(dir) {
  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map(
      (dirent) => {
        const e = path.resolve(dir, dirent.name);
        // return dirent.isDirectory() ? localFiles(e) : e;
        return dirent.isDirectory() ? localDirectoryEach(e) : ({name:e.slice(3).replace(/\\/g, '/'), local:e});
      }
    )
  );
  return Array.prototype.concat(...files);
}

/**
 * @param {any[]} fileList
 */
async function processor(fileList) {
  if (fileList.length == 0) {
    throw '> found no file';
    // throw '> no such "?" directory'.replace('?',dir);
  }
  var tmp = [];
  const bucketContent = store.bucket.data;
  var previousCount = bucketContent.length;
  for (const file of fileList) {
    if (!file.name.endsWith("/")){
      var folder = path.dirname(file.name);
      var filename = path.basename(file.name);
      var test = bucketContent.filter(e=>e.dir == folder);
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
  await store.bucket.write();
  console.log('...',bucketContent.length, '/',bucketContent.length - previousCount,'total/new, file not counted');
  return 'done';
}
