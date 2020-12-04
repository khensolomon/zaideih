const app = require('..');
const path = require('path');
app.Config.bucketActive = app.Config.bucketAvailable.includes(app.Param[0])?app.Param[0]:null;
app.Config.store.bucket = path.join(app.Config.media,app.Config.store.bucket).replace('?',app.Config.bucketActive||'tmp?');

const register = require('./cli.register');
const scan = require('./cli.scan');
const check = require('./cli.check');
const id3 = require('./cli.id3');
const rename = require('./cli.rename');
const gmh = require('./cli.gmh');
const testing = require('./cli.testing');

exports.main = async () => 'what do you mean?';

// SEE: cli.md#register
exports.register = async () => await register.main();

// SEE: cli.md#scan
exports.scan = async () => await scan.main();

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
exports.id3 = async () => await id3.main();

// SEE: cli.md#rename
exports.rename = async () => await rename.main();

// SEE: cli.md#gmh
// exports.gmh = async () => await gmh.main();
// exports.gmh_name = async () => await gmh.name();

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