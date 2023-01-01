import * as db from "./db.js";

/**
 * @param {any} Id
 */
export async function trackPlays(Id) {
	// NOTE: api/audio/1
	// NOTE: api/audio/Ruben-Dear-God.mp3
	if (/^\d+$/.test(Id)) {
		try {
			db.trackPlaysUpdate(Id).catch((e) => console.log(e.sqlMessage));
			// const [row] = await db.trackById(Id).catch(() => null);
			const [row] = await db.trackById(Id);
			if (row) {
				return row;
			} else {
				throw "local";
			}
		} catch (error) {
			throw error;
		}
	} else {
		throw "development";
	}
}

export const trackList = db.trackListTmp;
/*
const app = require('..');

const {trackPlaysUpdate, trackById, trackPlaysList, album, artist, genre} = require('./data');

exports.id = async function(Id){
  trackPlaysUpdate(Id).catch((e)=>{
    console.log('trackPlaysUpdate',e);
  });
  try {
    const [row] = await trackById(Id);
    if (row){
      return row;
    } else {
      throw 'none';
    }
  } catch (error) {
    throw error
  }
}

exports.plays = async () => trackPlaysList();

exports.meta = async function(locals){
  var raw = {};
  raw.album = JSON.stringify(await album()).length;
  raw.artist = JSON.stringify(await artist()).length;
  raw.genre = JSON.stringify(await genre()).length

  if (locals){
    raw.lang = app.Config.bucketAvailable.join();
    locals.raw = raw;
  } else {
    raw.lang = app.Config.bucketAvailable;
  }
  return raw;
}
*/
