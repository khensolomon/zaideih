const app = require('..');
/*
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\server\www\secure\Server-245222d1b962.json"
set GOOGLE_APPLICATION_CREDENTIALS=C:\server\www\secure\Server-245222d1b962.json
gsaks.json
*/
const {Storage} = require('@google-cloud/storage');
exports.storage = new Storage();
exports.bucket = exports.storage.bucket(app.Config.bucket);


exports.buckets = async () => await exports.storage.getBuckets();
exports.download = async (file) => await exports.bucket.file(file).download();
exports.upload = async (file,destination) => await exports.bucket.upload(file, {destination:destination})
exports.createReadStream = async (file) => exports.bucket.file(file).createReadStream();