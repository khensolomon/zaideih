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
