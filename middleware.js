const app = require('./');
// const {dictionaries} = app.Config;
// const {utility} = app.Common;

// app.Core.use(function(req, res, next){});

app.Core.use('/vue.js',app.Common.express.static(__dirname + '/node_modules/vue/dist/vue.min.js'));
app.Core.use('/vue-resource.js',app.Common.express.static(__dirname + '/node_modules/vue-resource/dist/vue-resource.min.js'));
app.Core.use('/vue-router.js',app.Common.express.static(__dirname + '/node_modules/vue-router/dist/vue-router.min.js'));

if (app.Config.development) {
  var webpack = require('webpack');
  var webpackConfig = require('./webpack.middleware');
  var compiler = webpack(webpackConfig);
  app.Core.use(require('webpack-dev-middleware')(compiler, {
    logLevel: 'warn', publicPath: webpackConfig.output.publicPath
  }));
  app.Core.use(require('webpack-hot-middleware')(compiler, {
    log: console.log, path: '/__webpack_hmr', heartbeat: 10 * 1000
  }));
}
