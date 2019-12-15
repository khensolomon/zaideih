const app = require('..');
// const {path} = app.Common;
const path = require('path');
// const {setting} = require('../config');

const other = require('./cli.other');
const scan = require('./cli.scan');
const id3 = require('./cli.id3');
const register = require('./cli.register');
const rename = require('./cli.rename');
const gmh = require('./cli.gmh');
const testing = require('./cli.testing');

// const _fileVersion = '.json'; //v1, v2, tmp, local, final
// setting.bucketActive = setting.bucketAvailable.includes(app.Param[0])?app.Param[0]:null;
// setting.bucketFile = path.join(app.Config.media,setting.bucketFile).replace('?',setting.bucketActive||'tmp');

// setting.albumFile = path.join(app.Config.media,setting.albumFile);
// setting.artistFile = path.join(app.Config.media,setting.artistFile);
// setting.genreFile = path.join(app.Config.media,setting.genreFile);

// setting.albumFile = path.join(app.Config.media,'store',setting.albumFile);
// setting.artistFile = path.join(app.Config.media,'store',setting.artistFile);
// setting.genreFile = path.join(app.Config.media,'store',setting.genreFile);
// setting.albumFile = path.join(app.Config.media,'store',setting.albumFile).replace('.json',_fileVersion);
// setting.artistFile = path.join(app.Config.media,'store',setting.artistFile).replace('.json',_fileVersion);
// setting.genreFile = path.join(app.Config.media,'store',setting.genreFile).replace('.json',_fileVersion);

// node run zaideih
exports.main = async function() {
  throw 'what do you mean?'
};

/*
node run zaideih scanCloud zola
node run zaideih scanCloud zola Agape
node run zaideih scanCloud myanmar ANOO
node run zaideih scanCloud myanmar MMGSL
node run zaideih scanCloud myanmar MPROL
node run zaideih scanCloud myanmar NAHNUAI
node run zaideih scanCloud myanmar PUKHEN
node run zaideih scanCloud myanmar GMH
node run zaideih scanCloud myanmar knot 'အရိပ်၏မျိုးစေ့'
node run zaideih scanCloud myanmar 'knot/ဟင်းလင်းပြင်၏ တံခါးဝှက်'
node run zaideih scanCloud myanmar SINGLE -> ?
node run zaideih scanCloud myanmar VARIOUS -> ?
node run zaideih scanCloud english ?
node run zaideih scanCloud mizo
node run zaideih scanCloud falam
*/
exports.scanCloud = async () => await scan.cloud();
// exports.scanLocal = async () => await scan.local();


/*
node run zaideih makeup zola
node run zaideih makeup myanmar
node run zaideih makeup mizo
node run zaideih makeup falam
*/
exports.makeup = async () => await other.makeup();

/*
node run zaideih id3Cloud zola
node run zaideih id3Cloud myanmar 92d719820999e4a2ad04
node run zaideih id3Cloud mizo
node run zaideih id3Cloud falam
*/
exports.id3Cloud = async () => await id3.cloud();

/*
node run zaideih checkTrackDuration zola
node run zaideih checkTrackDuration myanmar
node run zaideih checkTrackDuration falam
*/
exports.checkTrackEmpty = async () => await other.checkTrackEmpty();
exports.checkTrackDuration = async () => await other.checkTrackDuration();
exports.checkTrackTitle = async () => await other.checkTrackTitle();
exports.checkTrackYear = async () => await other.checkTrackYear();
exports.checkTrackArtist = async () => await other.checkTrackArtist();
exports.checkTrackAlbum = async () => await other.checkTrackAlbum();
exports.checkTrackNumber = async () => await other.checkTrackNumber();


// node run zaideih playsupdate
exports.playsupdate = async () => await register.playsupdate();

/*
node run zaideih register zola
node run zaideih register myanmar
node run zaideih register mizo
node run zaideih register falam
*/
exports.register = async () => await register.main();
exports.rename = async () => await rename.main();

// node run zaideih testing
exports.testing = async () => await testing();
// node run zaideih testing
exports.gmh = async () => await gmh.main();
exports.gmh_name = async () => await gmh.name();

/*
module.exports = {
  // async scan_album(){
  //   // node run zaideih scan_album 'working/အရိပ်၏မျိုးစေ့'
  //   // node run zaideih scan_album 'working/ဟင်းလင်းပြင်၏ တံခါးဝှက်'
  //   await other.album(this.args[0]);
  // },
  // async scan_dir(){
  //   // node run zaideih scan_dir 'working'
  //   await other.directory(this.args[0]);
  // }
};
*/
