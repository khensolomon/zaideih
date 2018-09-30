var {path} = require.main.exports(),
    {score} = require('./score');
var exports = module.exports = function(app){
  app.use('/music',require(path.join(score.dir.routes, 'music')));
  app.use('/api',require(path.join(score.dir.routes, 'api')));
  app.use('*',require(path.join(score.dir.routes, 'home')));

};
exports.score = score;