const track = require('./track');
const audio = require('./audio');

exports.trackId = track.id;
exports.trackPlays = track.plays;
exports.meta = track.meta;

exports.audio = audio.streamer;
