# Command line [`node run`]

Outside directory, with in evh [`node run zaideih`]

```js
const _fileVersion = '.json'; //v1, v2, tmp, local, final
setting.bucketActive = setting.bucketAvailable.includes(app.Param[0])?app.Param[0]:null;
setting.bucketFile = path.join(app.Config.media,setting.bucketFile).replace('?',setting.bucketActive||'tmp');

setting.albumFile = path.join(app.Config.media,setting.albumFile);
setting.artistFile = path.join(app.Config.media,setting.artistFile);
setting.genreFile = path.join(app.Config.media,setting.genreFile);

setting.albumFile = path.join(app.Config.media,'store',setting.albumFile);
setting.artistFile = path.join(app.Config.media,'store',setting.artistFile);
setting.genreFile = path.join(app.Config.media,'store',setting.genreFile);
setting.albumFile = path.join(app.Config.media,'store',setting.albumFile).replace('.json',_fileVersion);
setting.artistFile = path.join(app.Config.media,'store',setting.artistFile).replace('.json',_fileVersion);
setting.genreFile = path.join(app.Config.media,'store',setting.genreFile).replace('.json',_fileVersion);
```

## register

...track and its plays count

`node run register [bucket] [albumID(optional)]`
...

```bash
node run register zola
node run register zola e8b619fa098dd5039452
node run register myanmar
node run register mizo
node run register falam
```

...**deprecated**, used to import plays count from previous version. has only one responsibility, which is to import Old playsCount data

```js
// node run playsupdate
const register = require('./cli.register');
exports.playsupdate = async () => await register.playsupdate();
```

---

## scan

...Cloud/Local directories, create UniqueId for album and format *bucket.?.json* using *config.template.bucket*
data will be merged in *config.store.bucket*

`node run scan* [bucket] [directory(optional)]`

`bucket` is one of config.bucketAvailable

...

```bash
node run scanCloud zola
node run scanCloud zola Agape
node run scanCloud myanmar ANOO
node run scanCloud myanmar MMGSL
node run scanCloud myanmar MPROL
node run scanCloud myanmar NAHNUAI
node run scanCloud myanmar PUKHEN
node run scanCloud myanmar GMH
node run scanCloud myanmar knot 'အရိပ်၏မျိုးစေ့'
node run scanCloud myanmar 'knot/ဟင်းလင်းပြင်၏ တံခါးဝှက်'
node run scanCloud myanmar SINGLE -> ?
node run scanCloud myanmar VARIOUS -> ?
node run scanCloud english ?
node run scanCloud mizo
node run scanCloud falam

node run scanLocal myanmar "d:/m3s/9"
```

---

## id3

...get ID3 from Cloud/Local and update *bucket.?.json*

`node run id3* [bucket] [albumID(optional)]`
...

```bash
node run id3Cloud zola
node run id3Cloud myanmar 92d719820999e4a2ad04
node run id3Cloud mizo
node run id3Cloud falam

node run id3Local myanmar edef2003118078c72ed2
node run id3Local myanmar 6cda20a911867a327a10
```

---

## checkAlbum

...check album Id Duplicates

`node run checkAlbumId [bucket]`
...

```bash
node run checkAlbumId zola
node run checkAlbumId myanmar
node run checkAlbumId mizo
node run checkAlbumId falam
```

---

## checkTrack

...check Track duplicates, trackNumber, empty, duration

`node run checkTrack* [bucket]`
...

```bash
node run checkTrackEmpty zola

node run checkTrackDuration zola
node run checkTrackDuration myanmar
node run checkTrackDuration falam

node run checkTrackTitle zola
node run checkTrackYear zola
node run checkTrackArtist zola
node run checkTrackAlbum zola
node run checkTrackNumber zola
```

---

## rename

...**only testing**, rename file name

`node run rename ?`
...

```bash
?
```

---

## gmh

...**only testing**, extract mp3

`node run gmh ?`
...

```bash
?
```
