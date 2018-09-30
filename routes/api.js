var {express,path} = require.main.exports(),
    {score} = require('../score'),
    Music = require('./classMusic');

var router = express.Router();

// router.get('/edit', function(req, res, next) {
//   console.log('apple is executed');
//   // next();
//   res.send({
//     page:'edit'
//   });
// });
//
// router.get('/', function(req, res, next) {
//   res.send({
//     page:'main'
//   });
// });


// NOTE: Edit...

// router.get('/:user_id/edit', function(req, res, next) {
//   res.send({
//     page:'edit'
//   });
// });
// // NOTE: View...
// router.get('/:id', function(req, res, next) {
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

router.get('/track', function(req, res, next) {
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
  new Music(param).track(function (raw) {
    res.send({
      type: raw.type,
      meta: raw.meta,
      data: raw.data
    });
  });
});
router.get('/album', function(req, res, next) {
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
router.get('/artist', function(req, res, next) {
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


router.get('/', function(req, res, next) {
  res.send({TODO:true});
});



module.exports = router;
