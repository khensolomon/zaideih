var {express,path} = require.main.exports(),
    {score} = require('../score'),
    Music = require('./classMusic'),
    querystring = require('querystring');

var router = express.Router();


router.get('/album/:album', function(req, res, next) {
  res.send({page:'album detail',album:req.params.album});
});
router.get('/album', function(req, res, next) {
  res.send({page:'albums'});
});

router.get('/artist/:artist', function(req, res, next) {
  res.send({page:'artist detail',album:req.params.artist});
});
router.get('/artist', function(req, res, next) {
  res.send({page:'artists'});
});

router.get('/:album/:artist/:track', function(req, res, next) {
  res.send({page:'detail',album:req.params.album,artist:req.params.artist,track:req.params.track});
});
// router.get('/:album/:artist', function(req, res, next) {
//   res.send({page:'artist',album:req.params.album,artist:req.params.artist});
// });
// router.get('/:album', function(req, res, next) {
//   res.send({page:'album',album:req.params.album});
// });
router.get('/', function(req, res, next) {
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
    param.page='*';
    res.render(raw.type, {
      title: 'Tracks',
      raw: raw,
      meta: raw.meta,
      url: '/music?'+querystring.stringify(param)
    });
  });
});


module.exports = router;
