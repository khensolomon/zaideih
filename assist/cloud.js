// const Common = require.main.exports;
// const {Common} = require('..');
// const {fs,path,utility} = Common;
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('storage.lethil.me');
// var setting={
//   projectId:'?',
//   bucket:'storage.lethil.me',
// };
// $env:GOOGLE_APPLICATION_CREDENTIALS="C:\server\www\secure\Server-245222d1b962.json"
// set GOOGLE_APPLICATION_CREDENTIALS=C:\server\www\secure\Server-245222d1b962.json

module.exports = {
  storage:storage,
  bucket:bucket,
  bucketTesting(){
    // app.Config.bucket
    return storage.bucket('storage.lethil.me')
  },
  async buckets(){
    return await storage.getBuckets();
  },
  async download(file){
    return await bucket.file(file).download();
  },
  async upload(file,destination){
    return await bucket.upload(file, {destination:destination})
  },
  async createReadStream(file){
    return bucket.file(file).createReadStream();
  }
};