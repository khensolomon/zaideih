const app = require('.');
const {restrict} = app.Config;

// module.exports = {
//   restrictMiddleWare(req, res){
//     if (res.locals.referer)
//       if (req.xhr || req.headers.range) return true
//   }
// };

app.Core.disable('x-powered-by');

app.Core.use('/api', function (req, res, next) {
  if (res.locals.referer) {
    if (req.xhr || req.headers.range) {
      return next();
    }
  } else {
    var base = Object.keys(restrict), user = Object.keys(req.query), key = base.filter(e => user.includes(e));
    if (key.length && restrict[key] == req.query[key]) {
      return next();
    }
  }
  res.status(404).send();
});

// HACK: if development enviroment -> webpack middleware
if (app.Config.development) {
  const webpack = require('webpack'), config = require('./webpack.middleware'), compiler = webpack(config);

  //Enable "webpack-dev-middleware"
  app.Core.use(require('webpack-dev-middleware')(compiler, {
    publicPath: config.output.publicPath
  }));

  //Enable "webpack-hot-middleware"
  app.Core.use(require('webpack-hot-middleware')(compiler));
}
