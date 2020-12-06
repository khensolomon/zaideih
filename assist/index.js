// const Cloud = require('./cloud');
const track = require('./track');
const audio = require('./audio');

exports.trackId = track.id;
exports.trackPlays = track.plays;
exports.meta = track.meta;

// exports.audio = Cloud.bucket;
exports.audio = audio.streamer;

// exports.trackStreamCloud = track.streamCloud;
// exports.trackStreamCloud = track.streamCloud;