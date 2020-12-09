const app = require('..');
const path = require('path');
app.Config.bucketActive = app.Config.bucketAvailable.includes(app.Param[0])?app.Param[0]:null;
app.Config.store.bucket = path.join(app.Config.media,app.Config.store.bucket).replace('?',app.Config.bucketActive||'tmp?');

const register = require('./cli.register');
const scan = require('./cli.scan');
const check = require('./cli.check');
const id3 = require('./cli.id3');
const rename = require('./cli.rename');
const m3s = require('./cli.m3s');
// const gmh = require('./cli.gmh');
const testing = require('./cli.testing');

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

exports.main = async () => 'what do you mean?';

// SEE: cli.md#register
exports.register = async () => await register.main();

// SEE: cli.md#scan
exports.scanCloud = async () => await scan.cloud();
exports.scanLocal = async () => await scan.local();

// SEE: cli.md#checkAlbum
exports.checkAlbumId = async () => await check.checkAlbumId();

// SEE: cli.md#checkTrack
exports.checkTrackEmpty = async () => await check.checkTrackEmpty();
exports.checkTrackDuration = async () => await check.checkTrackDuration();
exports.checkTrackTitle = async () => await check.checkTrackTitle();
exports.checkTrackYear = async () => await check.checkTrackYear();
exports.checkTrackArtist = async () => await check.checkTrackArtist();
exports.checkTrackAlbum = async () => await check.checkTrackAlbum();
exports.checkTrackNumber = async () => await check.checkTrackNumber();

// SEE: cli.md#id3
exports.id3Cloud = async () => await id3.cloud();
exports.id3Local = async () => await id3.local();

// SEE: cli.md#rename
exports.rename = async () => await rename.main();

// SEE: cli.md#gmh
// exports.gmh = async () => await gmh.main();
// exports.gmh_name = async () => await gmh.name();

// SEE: cli.md#m3s
exports.m3s = async (e) => await m3s.main(e);

// SEE: cli.md#testing
exports.testing = async () => await testing();

// module.exports = {
//   // async scan_album(){
//   //   // node run zaideih scan_album 'working/အရိပ်၏မျိုးစေ့'
//   //   // node run zaideih scan_album 'working/ဟင်းလင်းပြင်၏ တံခါးဝှက်'
//   //   await other.album(this.args[0]);
//   // },
//   // async scan_dir(){
//   //   // node run zaideih scan_dir 'working'
//   //   await other.directory(this.args[0]);
//   // }
// };