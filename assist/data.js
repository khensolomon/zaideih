const app = require('..');
const path = require('path');
const fs = require('fs');
// const {utility,Burglish} = app.Common;
const {media,store,context} = app.Config;

const tableTrack = '_track';
const tableFile = 'file';

// store.bucket = path.join(media,store.bucket);
store.album = path.join(media,store.album);
store.artist = path.join(media,store.artist);
store.genre = path.join(media,store.genre);

store.trackName = path.join(media,store.trackName);
store.albumName = path.join(media,store.albumName);

exports.readJSON = async (file) => fs.promises.readFile(file).then(o=>JSON.parse(o)).catch(()=>new Array());
exports.writeJSON = async (file,raw) => fs.promises.writeFile(file,JSON.stringify(raw,null,2));

exports.readBucket = async() => await exports.readJSON(store.bucket).then(o=>Object.assign(context.bucket,o)).catch(()=>context.bucket=[]);
exports.writeBucket = async () => await fs.promises.writeFile(store.bucket,JSON.stringify(context.bucket,null,2));

exports.album = async () => await exports.readJSON(store.album);
exports.readAlbum = async () => await exports.readJSON(store.album).then(o=>Object.assign(context.album,o)).catch(()=>context.album=[]);
exports.writeAlbum = async () => await fs.promises.writeFile(store.album,JSON.stringify(context.album));

exports.artist = async () => await exports.readJSON(store.artist);
exports.readArtist = async () => await exports.readJSON(store.artist).then(o=>Object.assign(context.artist,o)).catch(()=>context.artist=[]);
exports.writeArtist = async () => await fs.promises.writeFile(store.artist,JSON.stringify(context.artist,null,2));

exports.genre = async () => await exports.readJSON(store.genre);
exports.readGenre = async () => await exports.readJSON(store.genre).then(o=>Object.assign(context.genre,o)).catch(()=>context.genre=[]);
exports.writeGenre = async () => await fs.promises.writeFile(store.genre,JSON.stringify(context.genre,null,2));

exports.readTrackName = async () => await exports.readJSON(store.trackName).then(o=>Object.assign(context.trackName,o)).catch(()=>context.trackName=[]);
exports.readAlbumName = async () => await exports.readJSON(store.albumName).then(o=>Object.assign(context.albumName,o)).catch(()=>context.albumName=[]);

exports.selectTrack = async (uid,dir)  => await app.sql.query('SELECT * FROM ?? WHERE uid = ? AND dir = ?;',[tableTrack,uid,dir])
exports.insertTrack = async (uid,dir) => await app.sql.query('INSERT INTO ?? (uid,lang,dir) VALUES (?,?,?);',[tableFile,uid,lang,dir]);

exports.selectTrackAll = async () => await app.sql.query('SELECT * FROM ??;',[tableFile]);

// NOTE: use in production
exports.trackPlaysUpdate = async (id) => app.sql.query('UPDATE ?? SET plays = plays + 1 WHERE id=?;', [tableFile,id]);
exports.trackPlaysList = async () => await app.sql.query('SELECT ??,?? FROM ??;',['id','plays',tableTrack]);
exports.trackById = async (id) => await app.sql.query('SELECT * FROM ?? WHERE id=?;', [tableTrack,id]);


// exports.selectDatabase = async function() {
//   return await app.sql.query('SELECT * FROM track WHERE uid = ? AND dir = ?',Object.values(arguments));
// }
// exports.insertDatabase = async function(){
//   return await app.sql.query('INSERT INTO track (uid,dir) VALUES (?,?)',Object.values(arguments));
// }

// args srcDir(old), destDir(new)
// exports.updateDatabase = async (o,n) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);

// exports.updateDatabaseTest = async (n,o) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);
