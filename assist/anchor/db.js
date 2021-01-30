import {db} from 'lethil';

const tableTrack = '_track';
const tableFile = 'file';

/**
 * @param {string} uid
 * @param {string} dir
 */
export async function selectTrack(uid, dir) {
  return await db.mysql.query('SELECT * FROM ?? WHERE uid = ? AND dir = ?;', [tableTrack, uid, dir]);
}

/**
 * @param {string} uid
 * @param {number} langId
 * @param {string} dir
 */
export async function insertTrack(uid, langId, dir) {
  return await db.mysql.query('INSERT INTO ?? (uid,lang,dir) VALUES (?,?,?);', [tableFile, uid, langId, dir]);
}

export async function selectTrackAll() {
  return await db.mysql.query('SELECT * FROM ??;', [tableFile]);
}

// NOTE: use in production
/**
 * @param {string} id
 */
export async function trackPlaysUpdate(id) {
  return db.mysql.query('UPDATE ?? SET plays = plays + 1 WHERE id=?;', [tableFile, id]);
}

export async function trackListTmp() {
  return await db.mysql.query('SELECT ??,?? FROM ??;', ['id', 'plays', tableTrack]);
}

/**
 * @param {any} id
 */
export async function trackById(id) {
  return await db.mysql.query('SELECT * FROM ?? WHERE id=?;', [tableTrack, id]);
}

// exports.selectDatabase = async function() {
//   return await app.sql.query('SELECT * FROM track WHERE uid = ? AND dir = ?',Object.values(arguments));
// }
// exports.insertDatabase = async function(){
//   return await app.sql.query('INSERT INTO track (uid,dir) VALUES (?,?)',Object.values(arguments));
// }

// args srcDir(old), destDir(new)
// exports.updateDatabase = async (o,n) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);

// exports.updateDatabaseTest = async (n,o) => await app.sql.query("UPDATE track SET dir = ? WHERE dir LIKE ?",[n,o]);
