const app = require('..');
const routes = app.Router();
const assist = require('../assist');

routes.get('/', function(req, res, next) {
  assist.meta(res.locals).then(
    ()=>{
      res.render('home', { title: 'Zaideih',description:'Zaideih Music Station',keywords:'zola, mp3, myanmar' });
    }
  );
});

module.exports = routes;