const app = require('..');
const data = require('./data');

exports.id = async function(Id){
  data.trackPlaysUpdate(Id).catch((e)=>{
    console.log('trackPlaysUpdate',e);
  });
  try {
    const [row] = await data.trackById(Id);
    if (row){
      return row;
    } else {
      throw 'none';
    }
  } catch (error) {
    throw error
  }
}
exports.plays = async () => data.trackPlaysList();

exports.meta = async function(locals){
  var raw = {};
  raw.album = JSON.stringify(await data.album()).length;
  raw.artist = JSON.stringify(await data.artist()).length;
  raw.genre = JSON.stringify(await data.genre()).length

  if (locals){
    raw.lang = app.Config.bucketAvailable.join();
    locals.raw = raw;
  } else {
    raw.lang = app.Config.bucketAvailable;
  }
  return raw;
}
