const app = require('../');
// const {dictionaries} = app.Config;
// const {utility} = app.Common;
const routes = app.Router();

var Generator = require('./classGenerator');
var Music = require('./classMusic');

// routes.get('/edit', function(req, res, next) {
//   console.log('apple is executed');
//   // next();
//   res.send({
//     page:'edit'
//   });
// });
//
// routes.get('/', function(req, res, next) {
//   res.send({
//     page:'main'
//   });
// });

// NOTE: Edit...
// routes.get('/:user_id/edit', function(req, res, next) {
//   res.send({
//     page:'edit'
//   });
// });

// // NOTE: View...
// routes.get('/:id', function(req, res, next) {
//   // console.log(req.database);
//   // console.log(Music);
//   // res.send({a:3});
//   new Music(req).track_dumpId(req.params.id,function (err, raw, column) {
//     // if (err) throw err;
//     // console.log('The solution is: ', rows)
//     res.send(raw);
//   });
// });
//

routes.get('/track-update', function(req, res, next) {
  let param={
    type:'track',
    limit:'all'
  }, query=req.query;
  if (query.q) param.q=query.q;
  if (query.year) param.year=query.year;
  if (query.genre) param.genre=query.genre;
  if (query.page) param.page=query.page;
  if (query.lang) param.lang=query.lang;

  new Generator(param).trackUpdate((raw)=>{
    res.send(raw);
  });
});

routes.get('/track', function(req, res, next) {
  let param= {type:'track'}, query=req.query;
  if (query.q) param.q=query.q;
  if (query.year) param.year=query.year;
  if (query.genre) param.genre=query.genre;
  if (query.page) param.page=query.page;
  if (query.lang) param.lang=query.lang;
  new Generator(param).track((raw)=>{
    res.send(raw);
  });
});

routes.get('/album', function(req, res, next) {
  let param={},
      query=req.query;
  if (query.q){
    param.q=query.q;
  }
  if (query.year){
    param.year=query.year;
  }
  if (query.genre){
    param.genre=query.genre;
  }
  if (query.page){
    param.page=query.page;
  }
  new Music(param).album(function (raw) {
    res.send({
      type: raw.type,
      meta: raw.meta,
      data: raw.data
    });
  });
});

routes.get('/artist', function(req, res, next) {
  let param={},
      query=req.query;
  if (query.q){
    param.q=query.q;
  }
  if (query.year){
    param.year=query.year;
  }
  if (query.genre){
    param.genre=query.genre;
  }
  if (query.page){
    param.page=query.page;
  }
  new Music(param).artist(function (raw) {
    res.send(raw);
    // res.send({
    //   type: raw.type,
    //   meta: raw.meta,
    //   data: raw.data
    // });
  });
});

routes.get('/', function(req, res, next) {
  res.send({TODO:true});
});

module.exports = routes;
