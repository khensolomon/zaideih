const app = require('..');
const {fs} = app.Common;
const {setting} = require('../config');


exports.readBucket = async() => await fs.readJson(setting.bucketFile).then(o=>Object.assign(setting.bucketContent,o)).catch(e=>setting.bucketContent=[]);
// await fs.writeJsonSync(setting.bucketFile, setting.bucketContent);
exports.writeBucket = async () => await fs.writeFileSync(setting.bucketFile,JSON.stringify(setting.bucketContent,null,2));

exports.readAlbum = async () => await fs.readJson(setting.albumFile).then(o=>Object.assign(setting.albumContent,o)).catch(e=>setting.albumContent=[]);
exports.writeAlbum = async () => await fs.writeFileSync(setting.albumFile,JSON.stringify(setting.albumContent));

exports.readArtist = async () => await fs.readJson(setting.artistFile).then(o=>Object.assign(setting.artistContent,o)).catch(e=>setting.artistContent=[]);
exports.writeArtist = async () => await fs.writeFileSync(setting.artistFile,JSON.stringify(setting.artistContent,null,2));

exports.readGenre = async () => await fs.readJson(setting.genreFile).then(o=>Object.assign(setting.genreContent,o)).catch(e=>setting.genreContent=[]);
exports.writeGenre = async () => await fs.writeFileSync(setting.genreFile,JSON.stringify(setting.genreContent,null,2));

exports.selectDatabase = async function() {
  return await app.sql.query('SELECT * FROM track WHERE uid = ? AND dir = ?',Object.values(arguments));
}
exports.insertDatabase = async function(){
  return await app.sql.query('INSERT INTO track (uid,dir) VALUES (?,?)',Object.values(arguments));
}
// args srcDir(old), destDir(new)
// exports.updateDatabase = async (o,n) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);

// exports.updateDatabaseTest = async (n,o) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);
