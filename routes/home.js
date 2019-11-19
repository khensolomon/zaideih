const app = require('../');
// const {dictionaries} = app.Config;
// const {utility} = app.Common;
const routes = app.Router();

routes.get('/', function(req, res, next) {
  res.render('home', { title: 'Zaideih',description:'Zaideih Music Station',keywords:'zola, mp3, myanmar' });
});

module.exports = routes;

/*
const crypto = require('crypto');
const apple = 'server/fileStorage/dists'
const secret = 'abcdefg';
const encrypt = crypto.createHmac('sha256', secret)
                   .update(apple)
                   .digest('hex');
// console.log('encrypt',encrypt);
*/

// /home/khensolomon/server/fileStorage/dist
// base64
// base64
// var crypto = require('crypto');
// module.exports = function(pwd, fn) {
//   var hash = crypto.createHash('sha256').update(pwd).digest('base64');
//   fn(null, hash);
// };
// const apple = 'I love cupcakes';


// const apple = '/home/khensolomon/server/fileStorage/dist'
// const secret = 'abcdefg';
// const encrypt = crypto.createHmac('sha256', secret)
//                    .update(apple)
//                    .digest('hex');
// console.log('encrypt',encrypt);

// const decrypt = crypto.createDecipher("SHA256", secret).update(apple).final("ascii");
// console.log('decrypt',decrypt);