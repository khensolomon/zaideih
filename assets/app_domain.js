var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var sassMiddleware = require('node-sass-middleware');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var appId='none';
var app = express();



/*
  - zaideih.com -> zaideih
  - myordbok.com -> myordbok
  - lethil.me -> lethil
  - zaideih.lethil.me -> zaideih
  - myordbok.lethil.me -> myordbok
*/

/*
- app
  - ?/public
  - ?/routes
  - ?/views

  - zaideih
  - myordbok
  - lethil
  - vote
*/
// function getHostName(url) {
//     var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i);
//     if (match != null && match.length > 2 && typeof match[2] === 'string' && match[2].length > 0) {
//     return match[2];
//     }
//     else {
//         return null;
//     }
// }
// var urls = 'http://www.example.com:8080/hello/';
// var newUrls = urls.map(function (url) {
//     return url.replace(/([a-zA-Z+.\-]+):\/\/([^\/]+):([0-9]+)\//, "$1://$2/");
// });

// // console.log(newUrls);
// var host = 'localhost:3000';
//
// var match = host.match(/^(www[0-9]?\.)?(.[^./:]+)/i);
// console.log(host,match);

// console.log(getHostName(urls));

app.use(function(req, res, next) {
  var host = req.get('host');
  // var host = 'http://www.example.com:8080/hello/';
  // var host = 'localhost:3000';

  // var hostMatch = host.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
  // console.log(hostMatch);
  // console.log(hostMatch && hostMatch[1]);

  // var match = host.match(/:\/\/(www[0-9]?\.)?(.?[^/:]+)/i);
  var domain = host.match(/^(www[0-9]?\.)?(.[^./:]+)/i);
  // console.log(host,domain);
  appId=domain[2];
  console.log(appId);

  // view engine setup
  app.set('views', path.join(__dirname, 'app/'+appId+'/views'));
  app.set('view engine', 'pug');






  next()
});
// console.log(express.headers);
// console.log(appId);
// app/locahost/




app.use('/src',function(req, res, next) {
  // console.log(appId);
  consol.log(res);
  // app.use(express.static(path.join(__dirname, 'app/'+appId+'/public')));
  next();
});


app.use(logger('dev'));


// app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
// app.use(cookieParser());
//
// app.use(sassMiddleware({
//   src: path.join(__dirname, 'app/'+appId+'/public'),
//   dest: path.join(__dirname,'app/'+appId+'/public'),
//   indentedSyntax: false, // true = .sass and false = .scss
//   sourceMap: true
// }));
// app.use(express.static(path.join(__dirname, 'app/'+appId+'/public')));



// app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
// app.use(cookieParser());
// app.use(sassMiddleware({
//   src: path.join(__dirname, 'public'),
//   dest: path.join(__dirname, 'public'),
//   indentedSyntax: false, // true = .sass and false = .scss
//   sourceMap: true
// }));
// app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
