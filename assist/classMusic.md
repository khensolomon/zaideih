# pre Music class

Usages...

```js
```

...

```js
const app = require('..');
const {Config,Common} = app;
const {setting} = require('../config');
const {fs,path} = Common;
// const path = require('path');
// const fs = require('fs');
// var util = require('util');

const table={
  track:'track'
};
const store = path.join(Config.media,'store');
const json={
  album:path.join(store,setting.albumFile),
  artist:path.join(store,setting.artistFile),
  genre:path.join(store,setting.genreFile)
};

module.exports = class Music {
  constructor(req) {
    this.param = req;
  }
  async trackId() {
    app.sql.query('UPDATE ?? SET plays = plays + 1 WHERE id=?', [table.track,this.param.trackId]);
    return app.sql.query('SELECT * FROM ?? WHERE id=?;', [table.track,this.param.trackId]).then(([row])=>row);
  }
  tracks() {
    return app.sql.query(
      'SELECT ??,?? FROM ??;',['id','plays',table.track]
    );
  }
  get jsonAlbum() {
    return json.album;
  }
  get jsonArtist() {
    return json.artist;
  }
  get jsonGenre() {
    return json.genre;
  }
  async meta() {
    var artist = await fs.readJsonSync(this.jsonArtist,{throws:false});
    var genre = await fs.readJsonSync(this.jsonGenre,{throws:false});
    var album = await fs.readJsonSync(this.jsonAlbum,{throws:false});
    var result={};
    result.album = JSON.stringify(album).length;
    result.artist = JSON.stringify(artist).length;
    result.genre = JSON.stringify(genre).length
    result.lang = setting.bucketAvailable;
    // callback(result);
    return result
  }
}