const Cloud = require('./cloud');
const track = require('./track');

exports.trackId = track.id;
exports.trackPlays = track.plays;
exports.meta = track.meta;

exports.audio = Cloud.bucket;