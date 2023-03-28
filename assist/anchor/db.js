import { db } from "lethil";

// import { config, TypeOfTablefile } from "./env.js";
import * as env from "./env.js";

const table = env.config.table;

/**
 * @typedef {Object} TypeOfSelectTrackFile
 * @property {number} id
 * @property {string} uid
 * @property {number} plays
 * @property {number} lang
 * @property {string} dir
 *
 * @typedef {Object} TypeOfSelectTrackView
 * @property {number} id
 * @property {string} uid
 * @property {number} plays
 * @property {string} dir
 *
 * @typedef {Object} TypeOfInserts
 * @property {number} fieldCount
 * @property {number} affectedRows
 * @property {number} insertId
 * @property {string} info
 * @property {number} serverStatus
 * @property {number} warningStatus
 *
 * @typedef {Object} TypeOfUpdate
 * @property {number} fieldCount
 * @property {number} affectedRows
 * @property {number} insertId
 * @property {string} info
 * @property {number} serverStatus
 * @property {number} warningStatus
 * @property {number} changedRows
 */

/**
 * @param {string} uid
 * @param {string} dir
 * @returns {Promise<TypeOfSelectTrackView>}
 */
export async function selectTrack(uid, dir) {
	return await db.mysql.query("SELECT * FROM ?? WHERE uid = ? AND dir = ?;", [
		table.trackView,
		uid,
		dir,
	]);
}

/**
 * @param {string} uid
 * @param {number} langId
 * @param {string} dir
 * @returns {Promise<TypeOfInserts>}
 */
export async function insertTrack(uid, langId, dir) {
	return await db.mysql.query("INSERT INTO ?? (uid,lang,dir) VALUES (?,?,?);", [
		table.trackFile,
		uid,
		langId,
		dir,
	]);
}

/**
 * @returns {Promise<TypeOfSelectTrackFile[]>}
 */
export async function selectTrackAll() {
	return await db.mysql.query("SELECT * FROM ??;", [table.trackFile]);
}

/**
 * NOTE: use in production
 * @param {number} id
 * @returns {Promise<TypeOfUpdate>}
 */
export async function trackPlaysUpdate(id) {
	return db.mysql.query("UPDATE ?? SET plays = plays + 1 WHERE id=?;", [
		table.trackFile,
		id,
	]);
}

/**
 * @param {number} id
 * @returns {Promise<TypeOfSelectTrackView>}
 */
export async function trackById(id) {
	return await db.mysql.query("SELECT * FROM ?? WHERE id=?;", [
		table.trackView,
		id,
	]);
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
