const app = require('..');
const assist = require('../assist');
const fs = require('fs');
// const path = require('path');

const {store} = app.Config;
const routes = app.Router();

routes.get('/', function(req, res, next) {
  assist.meta().then(e=>res.send(e)).catch(next)
});
routes.get('/album', function(req, res) {
  fs.createReadStream(store.album).pipe(res);
});
routes.get('/genre', function(req, res) {
  fs.createReadStream(store.genre).pipe(res);
});
routes.get('/artist', function(req, res) {
  fs.createReadStream(store.artist).pipe(res);
});
routes.get('/track-plays', function(req, res, next) {
  assist.trackPlays().then(e=>res.send(e)).catch(next)
});

routes.get('/audio/:trackId', assist.audio);

module.exports = routes;
