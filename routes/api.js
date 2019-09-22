const app = require('../');
const {fs,path} = app.Common;
const {storage} = app.Config;
const routes = app.Router();

const Generator = require('./classGenerator');
const Music = require('./classMusic');

routes.get('/', function() {
  res.send({TODO:true});
});

routes.get('/track-update', function(req, res) {
  req.params.type='track';
  req.params.limit='all';
  new Generator(req.params).trackUpdate((raw)=>{
    res.send(raw);
  });
});

routes.get('/track', function(req, res) {
  // if (query.q) param.q=query.q;
  // if (query.year) param.year=query.year;
  // if (query.genre) param.genre=query.genre;
  // if (query.page) param.page=query.page;
  // if (query.lang) param.lang=query.lang;
  req.params.type='track';
  new Generator(req.params).track((raw)=>{
    res.send(raw);
  });
});

routes.get('/audio/:trackId', function(req, res) {
  new Music(req.params).trackId().then(row=>{
    try {
      var music = row?path.resolve(storage,'music',row.PATH):path.resolve(storage,'music/tmp',req.params.trackId);
      var stat = fs.statSync(music);
      var range = req.headers.range;
      if (range !== undefined) {
        var parts = range.replace(/bytes=/, "").split("-");

        var partial_start = parts[0];
        var partial_end = parts[1];

        if ((isNaN(partial_start) && partial_start.length > 1) || (isNaN(partial_end) && partial_end.length > 1)) {
          return res.sendStatus(500);
        }

        var start = parseInt(partial_start, 10);
        var end = partial_end ? parseInt(partial_end, 10) : stat.size - 1;
        var content_length = (end - start) + 1;

        res.status(206).header({
          'Content-Type': 'audio/mpeg',
          'Content-Length': content_length,
          'Content-Range': "bytes " + start + "-" + end + "/" + stat.size
        });

        fs.createReadStream(music, {start: start, end: end}).pipe(res);
      } else {
        res.header({
          'Content-Type': 'audio/mpeg',
          'Content-Length': stat.size
        });
        fs.createReadStream(music).pipe(res);
      }
    } catch (e) {
      // res.send(e.message);
      res.status(404).end();
    }
  }).catch(()=>{
    // res.send(e.message);
    res.status(404).end();
  });
});

/*
routes.get('/audio-not-in-used/:id', (req, res) => {
  var music = path.resolve(storage,'music/tmp',req.params.id);
  var stat = fs.statSync(music);
  var range = req.headers.range;
  var readStream;
  if (range !== undefined) {
    var parts = range.replace(/bytes=/, "").split("-");

    var partial_start = parts[0];
    var partial_end = parts[1];

    if ((isNaN(partial_start) && partial_start.length > 1) || (isNaN(partial_end) && partial_end.length > 1)) {
      return res.sendStatus(500);
    }

    var start = parseInt(partial_start, 10);
    var end = partial_end ? parseInt(partial_end, 10) : stat.size - 1;
    var content_length = (end - start) + 1;

    res.status(206).header({
      'Content-Type': 'audio/mpeg',
      'Content-Length': content_length,
      'Content-Range': "bytes " + start + "-" + end + "/" + stat.size
    });

    readStream = fs.createReadStream(music, {start: start, end: end});
  } else {
    res.header({'Content-Type': 'audio/mpeg','Content-Length': stat.size});
    readStream = fs.createReadStream(music);
  }
  readStream.pipe(res);
});
*/

/*
routes.get('/audio/:id', function(req,res){
  // console.log(req.headers.range);
  var music = path.resolve(storage,'music/tmp',req.params.id);
  fs.exists(music,function(exists){
    if(exists){
      fs.createReadStream(music).pipe(res);
    } else {
      res.status(404).end();
    }
  });
});
*/

/*
routes.get('/audio-download/:id', function(req,res){
  var music = path.resolve(storage,'music/tmp',req.params.id);
	fs.exists(music,function(exists){
		if(exists){
      res.setHeader('Content-disposition', 'attachment; filename=' + path.basename(music));
			res.setHeader('Content-Type', 'application/audio/mpeg3')
			fs.createReadStream(music).pipe(res);
		} else {
			res.status(404).end();
		}
	});
});
*/

/*
routes.get('/album-not-in-used', function(req, res, next) {
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
*/

/*
routes.get('/artist-not-in-used', function(req, res, next) {
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
*/

module.exports = routes;
