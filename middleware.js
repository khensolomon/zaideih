const app = require('.');

module.exports = {
  restrictMiddleWare(req, res){
    if (res.locals.referer)
      if (req.xhr || req.headers.range) return true
  }
};

app.Core.disable('x-powered-by');

// app.Core.use('/vue.js',app.Common.express.static(__dirname + '/node_modules/vue/dist/vue.min.js'));
// app.Core.use('/vue-resource.js',app.Common.express.static(__dirname + '/node_modules/vue-resource/dist/vue-resource.min.js'));
// app.Core.use('/vue-router.js',app.Common.express.static(__dirname + '/node_modules/vue-router/dist/vue-router.min.js'));
/*
if (app.Config.development) {
  var webpack = require('webpack');
  var webpackConfig = require('./webpack.middleware');
  var compiler = webpack(webpackConfig);
  app.Core.use(require('webpack-dev-middleware')(compiler, {
    // noInfo: true, publicPath: webpackConfig.output.publicPath
    // publicPath: webpackConfig.output.publicPath
    logLevel: 'warn', publicPath: webpackConfig.output.publicPath
  }));
  // mimeTypes?, writeToDisk?, methods?, headers?, publicPath?, serverSideRender?, outputFileSystem?, index?
  app.Core.use(require('webpack-hot-middleware')(compiler));
  // app.Core.use(require('webpack-hot-middleware')(compiler, {
  //   // path: '/__webpack_hmr', heartbeat: 10 * 1000
  //   log: console.log, path: '/__webpack_hmr', heartbeat: 10 * 1000
  // }));
}
*/
if (app.Config.development) {
  // console.log('app.Config.development',app.Config.development)
  const webpack = require('webpack');
  const webpackDevMiddleware = require('webpack-dev-middleware');
  const webpackHotMiddleware = require('webpack-hot-middleware');
  // const config = require('./webpack.config.js');
  const config = require('./webpack.middleware');

  //reload=true:Enable auto reloading when changing JS files or content
  //timeout=1000:Time from disconnecting from server to reconnecting
  // config.entry.app.unshift('webpack-hot-middleware/client?path=/__webpack_hmr&reload=true&timeout=1000');

  //Add HMR plugin
  // config.plugins.push(new webpack.HotModuleReplacementPlugin());

  const compiler = webpack(config);

  //Enable "webpack-dev-middleware"
  app.Core.use(webpackDevMiddleware(compiler, {
    publicPath: config.output.publicPath
  }));

  //Enable "webpack-hot-middleware"
  app.Core.use(webpackHotMiddleware(compiler));

}