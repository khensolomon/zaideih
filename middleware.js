const app = require('./');
// const Music = require('./routes/classMusic');
// const url = require('url');
// const {test} = app;
// const {utility} = app.Common;

module.exports = {
  // style: {
  //   // prefix: '/css',
  //   // indentedSyntax: false,
  //   // debug: true,
  //   // response:false,
  //   // NOTE: nested, expanded, compact, compressed
  //   // outputStyle: 'compressed',
  //   // sourceMap: false
  // },
  // script: {
  //   // prefix:'/jsmiddlewareoutput'
  // },
  restrictMiddleWare(req, res){
    if (res.locals.referer)
      if (req.xhr || req.headers.range) return true
  }
};

// app.Core.use('/vue.js',app.Common.express.static(__dirname + '/node_modules/vue/dist/vue.min.js'));
// app.Core.use('/vue-resource.js',app.Common.express.static(__dirname + '/node_modules/vue-resource/dist/vue-resource.min.js'));
// app.Core.use('/vue-router.js',app.Common.express.static(__dirname + '/node_modules/vue-router/dist/vue-router.min.js'));

// app.Core.use(function(req, res, next){
//   console.log('-------------')
//   new Music().meta().then(
//     raw=>{
//       // console.log(raw)
//       res.locals.rawAlbum=raw.album;
//       res.locals.rawArtist=raw.artist;
//       res.locals.rawGenre=raw.genre;
//       res.locals.rawLang=raw.lang.join(',');
//     }
//   );
//   next();
// });


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