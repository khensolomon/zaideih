import {route,seek} from 'lethil';

import {config,meta,trackList,audio,store} from '../assist/index.js';

const routes = route('API','/api');

routes.get(
  "",
  /**
   * @param {*} req
   * @param {*} res
   */
  function(req, res) {
    meta().then(
      e => res.json(e)
    )
  }
);

routes.get(
  "/album",
  /**
   * @param {*} req
   * @param {*} res
   */
  function(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    seek.readStream(store.album.file).pipe(res);
  }
);

routes.get(
  "/genre",
  /**
   * @param {*} req
   * @param {*} res
   */
  function(req, res) {
    seek.readStream(store.genre.file).pipe(res);
  }
);

routes.get(
  "/artist",
  /**
   * @param {*} req
   * @param {*} res
   */
  function(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    seek.readStream(store.artist.file).pipe(res);
  }
);

routes.get(
  "/track-list-id-plays",
  /**
   * @param {*} req
   * @param {*} res
   */
  function(req, res) {
    trackList().then(
      e => res.json(e)
    ).catch(
      () => ({})
    );
  }
);

routes.get("/audio/:trackId",audio.streamer);

/*
const app = require('..');
const assist = require('../assist');
const fs = require('fs');
// const url = require('url');
// const path = require('path');

const {store} = app.Config;
const routes = app.Router();

routes.get('/', function(req, res, next) {
  assist.meta().then(e=>res.send(e)).catch(next)
});

routes.get('/album', function(req, res) {
  res.header("Content-Type", "application/json; charset=utf-8");
  fs.createReadStream(store.album).pipe(res);
});

routes.get('/genre', function(req, res) {
  fs.createReadStream(store.genre).pipe(res);
});

routes.get('/artist', function(req, res) {
  res.header("Content-Type", "application/json; charset=utf-8");
  fs.createReadStream(store.artist).pipe(res);
});

routes.get('/track-plays', function(req, res, next) {
  assist.trackPlays().then(e=>res.send(e)).catch(next)
});

routes.get('/audio/:trackId', assist.audio);

module.exports = routes;
*/