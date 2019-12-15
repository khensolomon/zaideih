# pre api

Usages...

```js
// read
new ttf(fontType).scan(fontName).then(function(e){
  res.send(e);
});
// download
new ttf(fontType).download(fontName).then(function(file){
  if (file){

  } else {
    res.status(500).send('restricted').end();
  }
}).catch(function(){

});

// type
var o = new ttf(fontType);
await o.view(fontName).then(function(e){
  if (e instanceof Object){
    context = e;
    if (e.unrestrict){
      context.type=fontType;
      context.download=fontName;
    }
  }
});
await o.read('secondary');
await o.read('external');
```

...

```js
const app = require('../');
const assist = require('../assist');
const fs = require('fs');
const path = require('path');

const {storage} = app.Config;
const routes = app.Router();

const Music = require('./classMusic');

routes.get('/', function(req, res) {
  new Music().meta().then(e=>res.send(e));
});
routes.get('/album', function(req, res) {
  fs.createReadStream(new Music().jsonAlbum).pipe(res);
});
routes.get('/genre', function(req, res) {
  fs.createReadStream(new Music().jsonGenre).pipe(res);
});
routes.get('/artist', function(req, res) {
  fs.createReadStream(new Music().jsonArtist).pipe(res);
});
routes.get('/track-plays', function(req, res) {
  new Music().tracks().then(e=>res.send(e))
});
routes.get('/audio/:trackId', function(req, res) {
  const contentType = 'audio/mpeg';
  new Music(req.params).trackId().then(row=>{
    if (row){
      console.log('mp3:',row.id,row.plays);
      const audio = assist.audio.bucket.file(row.dir);
      audio.getMetadata().then(
        meta=> {
          var stat = meta[0];
          var range = req.headers.range;
          if (range !== undefined) {
            var rangeByte = range.replace(/bytes=/, "").split("-");
            var rangeByteStart = rangeByte[0];
            var rangeByteEnd = rangeByte[1];

            if ((isNaN(rangeByteStart) && rangeByteStart.length > 1) || (isNaN(rangeByteEnd) && rangeByteEnd.length > 1)) {
              return res.sendStatus(500);
            }
            var contentStart = parseInt(rangeByteStart, 10);
            var contentEnd = rangeByteEnd ? parseInt(rangeByteEnd, 10) : stat.size - 1;
            var contentLength = (contentEnd - contentStart) + 1;
            res.status(206).header({'Content-Type':contentType,'Content-Length':contentLength,'Content-Range':"bytes " + contentStart + "-" + contentEnd + "/" + stat.size});
            // audio.createReadStream({contentType:contentType,validation:false,start:contentStart,end:contentEnd}).pipe(res);
            audio.createReadStream({
              contentType: contentType,validation: false, start: contentStart, end: contentEnd
            }).on('error', () => res.status(404)).on('end', () => res.end()).pipe(res);
          } else{
            res.header({'Content-Type':contentType,'Content-Length':stat.size});
            audio.createReadStream({contentType: contentType}).pipe(res);
          }
        }
      ).catch(
        ()=>res.status(404).end()
      )
    } else {
      var file = path.resolve(storage,'music/tmp',req.params.trackId);
      try {
        var stat = fs.statSync(file);
        if (req.headers.range !== undefined) {
          var rangeByte = req.headers.range.replace(/bytes=/, "").split("-");
          var rangeByteStart = rangeByte[0];
          var rangeByteEnd = rangeByte[1];

          if ((isNaN(rangeByteStart) && rangeByteStart.length > 1) || (isNaN(rangeByteEnd) && rangeByteEnd.length > 1)) {
            return res.sendStatus(500);
          }
          var contentStart = parseInt(rangeByteStart, 10);
          var contentEnd = rangeByteEnd ? parseInt(rangeByteEnd, 10) : stat.size - 1;
          var contentLength = (contentEnd - contentStart) + 1;
          res.status(206).header({'Content-Type':contentType,'Content-Length':contentLength,'Content-Range':"bytes " + contentStart + "-" + contentEnd + "/" + stat.size});
          fs.createReadStream(file, {start: contentStart, end: contentEnd}).pipe(res);
        } else {
          res.header({'Content-Type':contentType,'Content-Length':stat.size});
          fs.createReadStream(file).pipe(res);
        }
      } catch (e) {
        res.status(404).end();
      }
    }
  }).catch(()=>{
    res.status(404).end();
  });

});

/*
const audio = Cloud.bucket.file('music/myanmar/MMGSL/Never.Say.Die/05.mp3');
audio.getMetadata().then(
  meta=> {
    var stat = meta[0];
    var range = req.headers.range;
    if (range !== undefined) {
      var rangeByte = range.replace(/bytes=/, "").split("-");
      var rangeByteStart = rangeByte[0];
      var rangeByteEnd = rangeByte[1];

      if ((isNaN(rangeByteStart) && rangeByteStart.length > 1) || (isNaN(rangeByteEnd) && rangeByteEnd.length > 1)) {
        return res.sendStatus(500);
      }
      var contentStart = parseInt(rangeByteStart, 10);
      var contentEnd = rangeByteEnd ? parseInt(rangeByteEnd, 10) : stat.size - 1;
      var contentLength = (contentEnd - contentStart) + 1;
      res.status(206).header({'Content-Type':contentType,'Content-Length':contentLength,'Content-Range':"bytes " + contentStart + "-" + contentEnd + "/" + stat.size});
      // audio.createReadStream({contentType:contentType,validation:false,start:contentStart,end:contentEnd}).pipe(res);
      audio.createReadStream({
        contentType: contentType,validation: false, start: contentStart, end: contentEnd
      }).on('error', () => res.status(404)).on('end', () => res.end()).pipe(res);
    } else{
      res.header({'Content-Type':contentType,'Content-Length':stat.size});
      audio.createReadStream({contentType: contentType}).pipe(res);
    }
  }
).catch(
  ()=>res.status(404).end()
)
*/
/*
routes.get('/track-update_not-in-used', function(req, res) {
  req.params.type='track';
  req.params.limit='all';
  new Music(req.params).trackUpdate((raw)=>{
    res.send(raw);
  });
});
routes.get('/track', function(req, res) {
  // if (query.q) param.q=query.q;
  // if (query.year) param.year=query.year;
  // if (query.genre) param.genre=query.genre;
  // if (query.page) param.page=query.page;
  // if (query.lang) param.lang=query.lang;
  // TODO ???
  req.params.type='album.local';
  new Music(req.params).track((raw)=>{
    res.send(raw);
  });
});
routes.get('/audio_not-in-used/:trackId', function(req, res) {
  const contentType = 'audio/mpeg';
  new Music(req.params).trackId().then(row=>{
    try {
      var music = row?path.resolve(storage,'music',row.PATH):path.resolve(storage,'music/tmp',req.params.trackId);
      var stat = fs.statSync(music);
      if (req.headers.range !== undefined) {
        var rangeByte = req.headers.range.replace(/bytes=/, "").split("-");
        var rangeByteStart = rangeByte[0];
        var rangeByteEnd = rangeByte[1];

        if ((isNaN(rangeByteStart) && rangeByteStart.length > 1) || (isNaN(rangeByteEnd) && rangeByteEnd.length > 1)) {
          return res.sendStatus(500);
        }
        var contentStart = parseInt(rangeByteStart, 10);
        var contentEnd = rangeByteEnd ? parseInt(rangeByteEnd, 10) : stat.size - 1;
        var contentLength = (contentEnd - contentStart) + 1;
        res.status(206).header({'Content-Type':contentType,'Content-Length':contentLength,'Content-Range':"bytes " + contentStart + "-" + contentEnd + "/" + stat.size});
        fs.createReadStream(music, {start: contentStart, end: contentEnd}).pipe(res);
      } else {
        res.header({'Content-Type':contentType,'Content-Length':stat.size});
        fs.createReadStream(music).pipe(res);
      }
    } catch (e) {
      res.status(404).end();
    }
  }).catch(()=>{
    res.status(404).end();
  });
});
*/

/*
routes.get('/audio-cloud-stream', function(req, res) {
  const contentType = 'audio/mpeg';
  const audio = Cloud.bucket.file('music/myanmar/MMGSL/Never.Say.Die/05.mp3');
  audio.getMetadata().then(
    meta=> {
      var stat = meta[0];
      var range = req.headers.range;
      if (range !== undefined) {
        var rangeByte = range.replace(/bytes=/, "").split("-");
        var rangeByteStart = rangeByte[0];
        var rangeByteEnd = rangeByte[1];

        if ((isNaN(rangeByteStart) && rangeByteStart.length > 1) || (isNaN(rangeByteEnd) && rangeByteEnd.length > 1)) {
          return res.sendStatus(500);
        }
        var contentStart = parseInt(rangeByteStart, 10);
        var contentEnd = rangeByteEnd ? parseInt(rangeByteEnd, 10) : stat.size - 1;
        var contentLength = (contentEnd - contentStart) + 1;
        res.status(206).header({'Content-Type':contentType,'Content-Length':contentLength,'Content-Range':"bytes " + contentStart + "-" + contentEnd + "/" + stat.size});
        // audio.createReadStream({contentType:contentType,validation:false,start:contentStart,end:contentEnd}).pipe(res);
        audio.createReadStream({
          contentType: contentType,validation: false, start: contentStart, end: contentEnd
        }).on('error', () => res.status(404)).on('end', () => res.end()).pipe(res);
      } else{
        res.header({'Content-Type':contentType,'Content-Length':stat.size});
        audio.createReadStream({contentType: contentType}).pipe(res);
      }
    }
  ).catch(
    ()=>res.status(404).end()
  )
});
*/
/*
routes.get('/audio-cloud-download', function(req, res) {
  Cloud.bucket.file('music/myanmar/MMGSL/Never.Say.Die/03.mp3').createReadStream({
    contentType: 'audio/mpeg',
  }).on('error',
    () => res.status(404)
  ).on('response',
    streamResponse => {
      res.setHeader('Content-Length', streamResponse.headers['content-length']);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-disposition', 'attachment; filename="0"'.replace('0',path.basename('tmp.mp3')));
    }
  ).on('end',
    () => res.end()
  ).pipe(res);
});
*/
/*
routes.get('/audio-local-stream/:trackId', function(req, res) {
  const contentType = 'audio/mpeg';
  new Music(req.params).trackId().then(row=>{
    try {
      var music = row?path.resolve(storage,'music',row.PATH):path.resolve(storage,'music/tmp',req.params.trackId);
      var stat = fs.statSync(music);
      if (req.headers.range !== undefined) {
        var rangeByte = req.headers.range.replace(/bytes=/, "").split("-");
        var rangeByteStart = rangeByte[0];
        var rangeByteEnd = rangeByte[1];

        if ((isNaN(rangeByteStart) && rangeByteStart.length > 1) || (isNaN(rangeByteEnd) && rangeByteEnd.length > 1)) {
          return res.sendStatus(500);
        }
        var contentStart = parseInt(rangeByteStart, 10);
        var contentEnd = rangeByteEnd ? parseInt(rangeByteEnd, 10) : stat.size - 1;
        var contentLength = (contentEnd - contentStart) + 1;
        res.status(206).header({'Content-Type':contentType,'Content-Length':contentLength,'Content-Range':"bytes " + contentStart + "-" + contentEnd + "/" + stat.size});
        fs.createReadStream(music, {start: contentStart, end: contentEnd}).pipe(res);
      } else {
        res.header({'Content-Type':contentType,'Content-Length':stat.size});
        fs.createReadStream(music).pipe(res);
      }
    } catch (e) {
      res.status(404).end();
    }
  }).catch(()=>{
    res.status(404).end();
  });
});
*/
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
