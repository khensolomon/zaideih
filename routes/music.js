// const app = require('..');
// const {dictionaries} = app.Config;
// const {utility} = app.Common;
// const routes = app.Router();

// var querystring = require('querystring');
// var Music = require('./classMusic');

// // routes.get('/album/:album', function(req, res, next) {
//   res.send({page:'album detail',album:req.params.album});
// });
// routes.get('/album', function(req, res, next) {
//   res.send({page:'albums'});
// });

// routes.get('/artist/:artist', function(req, res, next) {
//   res.send({page:'artist detail',album:req.params.artist});
// });
// routes.get('/artist', function(req, res, next) {
//   res.send({page:'artists'});
// });

// routes.get('/:album/:artist/:track', function(req, res, next) {
//   res.send({page:'detail',album:req.params.album,artist:req.params.artist,track:req.params.track});
// });
// routes.get('/:album/:artist', function(req, res, next) {
//   res.send({page:'artist',album:req.params.album,artist:req.params.artist});
// });
// routes.get('/:album', function(req, res, next) {
//   res.send({page:'album',album:req.params.album});
// });
// routes.get('/', function(req, res, next) {
//   let param={},
//       query=req.query;
//   if (query.q){
//     param.q=query.q;
//   }
//   if (query.year){
//     param.year=query.year;
//   }
//   if (query.genre){
//     param.genre=query.genre;
//   }
//   if (query.page){
//     param.page=query.page;
//   }
//   new Music(param).track(function (raw) {
//     param.page='*';
//     res.render(raw.type, {
//       title: 'Tracks',
//       raw: raw,
//       meta: raw.meta,
//       url: '/music?'+querystring.stringify(param)
//     });
//   });
// });

module.exports = routes;