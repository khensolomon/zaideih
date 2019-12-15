const app = require('..');
const path = require('path');
const {readFilePromise,writeFilePromise} = app.Common;
const {media,store,context} = app.Config;

const tableTrack = 'track';

// store.bucket = path.join(media,store.bucket);
store.album = path.join(media,store.album);
store.artist = path.join(media,store.artist);
store.genre = path.join(media,store.genre);

const readJSON = async (file) => readFilePromise(file).then(o=>JSON.parse(o)).catch(()=>new Array());
// const writeJSON = async (file,raw) => writeFilePromise(file,JSON.stringify(raw,null,2));

exports.readBucket = async() => await readJSON(store.bucket).then(o=>Object.assign(context.bucket,o)).catch(()=>context.bucket=[]);
exports.writeBucket = async () => await writeFilePromise(store.bucket,JSON.stringify(context.bucket,null,2));

exports.album = async () => await readJSON(store.album);
exports.readAlbum = async () => await readJSON(store.album).then(o=>Object.assign(context.album,o)).catch(()=>context.album=[]);
exports.writeAlbum = async () => await writeFilePromise(store.album,JSON.stringify(context.album));

exports.artist = async () => await readJSON(store.artist);
exports.readArtist = async () => await readJSON(store.artist).then(o=>Object.assign(context.artist,o)).catch(()=>context.artist=[]);
exports.writeArtist = async () => await writeFilePromise(store.artist,JSON.stringify(context.artist,null,2));

exports.genre = async () => await readJSON(store.genre);
exports.readGenre = async () => await readJSON(store.genre).then(o=>Object.assign(context.genre,o)).catch(()=>context.genre=[]);
exports.writeGenre = async () => await writeFilePromise(store.genre,JSON.stringify(context.genre,null,2));

exports.selectDatabase = async (uid,dir)  => await app.sql.query('SELECT * FROM ?? WHERE uid = ? AND dir = ?;',[tableTrack,uid,dir])
exports.insertDatabase = async (uid,dir) => await app.sql.query('INSERT INTO ?? (uid,dir) VALUES (?,?);',[tableTrack,uid,dir]);

// NOTE: use in production
exports.trackPlaysUpdate = async (id) => app.sql.query('UPDATE ?? SET plays = plays + 1 WHERE id=?;', [tableTrack,id]);
exports.trackById = async (id) => await app.sql.query('SELECT * FROM ?? WHERE id=?;', [tableTrack,id]);
exports.trackPlaysList = async () => await app.sql.query('SELECT ??,?? FROM ??;',['id','plays',tableTrack]);

// exports.selectDatabase = async function() {
//   return await app.sql.query('SELECT * FROM track WHERE uid = ? AND dir = ?',Object.values(arguments));
// }
// exports.insertDatabase = async function(){
//   return await app.sql.query('INSERT INTO track (uid,dir) VALUES (?,?)',Object.values(arguments));
// }

// args srcDir(old), destDir(new)
// exports.updateDatabase = async (o,n) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);

// exports.updateDatabaseTest = async (n,o) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);
