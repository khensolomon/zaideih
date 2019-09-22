const app = require('../');
const Timer = require('./classTimer');

var config={
  track_limit:30,
  lang:{
    '0':'untitle',
    '1':'zola',
    '2':'myanmar',
    '3':'mizo',
    '4':'english',
    '5':'chin',
    '6':'haka',
    '7':'falam',
    '8':'korea',
    '9':'norwegian',
    '10':'collection'
  },
  unique:function(res){
    // artist_newset:Array.from(new Set(row.listArtist.split(","))),
    // artist_dum:row.listArtist,
    // artist_filter:row.listArtist.split(",").filter(function (el) {
    //     return (el.hero === "Batman");
    // }),
    // artist_map:row.listArtist.split(",").map(function(e){return e.trim();}),
    return Array.from(new Set(res.map(function(e){return e.trim();}).filter(function (item, pos, self) {
        return self.indexOf(item) == pos && item!='';
    })));
  }
};
var table={
  track:'zd_track',
  album:'zd_album'
};
module.exports = class Music {
  constructor(request) {
   this.request=request;
  }

  queryTrackSearch() {
    // TODO: search -> all, title, artist, album
    let selector=['SELECT *',app.sql.format('FROM ?? AS t', [table.track])];
    let where=false;
    if (this.request.q) {
      let q = this.request.q;
      if (where) {
        selector.push('OR');
      } else {
        selector.push('WHERE');
        where=true;
      }
      selector.push(app.sql.format('?? LIKE ?', ['t.TITLE',q+'%']));
      selector.push(app.sql.format('OR ?? LIKE ?', ['t.ARTIST',q+'%']));
      selector.push(app.sql.format('OR ?? LIKE ?', ['t.ALBUM',q+'%']));
      // selector.push(app.sql.format('?? LIKE ?', ['t.ARTIST',q+'%']));
    }
    if (this.request.year) {
      if (where) {
        selector.push('OR');
      } else {
        selector.push('WHERE');
        where=true;
      }
      // selector.push(where?'OR':'WHERE');
      selector.push(app.sql.format('?? = ?', ['t.YEAR',this.request.year]));
    }
    if (this.request.genre) {
      if (where) {
        selector.push('OR');
      } else {
        selector.push('WHERE');
        where=true;
      }
      selector.push(app.sql.format('?? LIKE ?', ['t.GENRE',this.request.genre]));
    }
    if (this.request.lang) {
      console.log('lang=',this.request.lang)
      if (where) {
        selector.push('AND');
      } else {
        selector.push('WHERE');
        where=true;
      }
      selector.push(app.sql.format('?? = ?', ['t.LANG',this.request.lang]));
    }

    // let from = [app.sql.format('FROM ?? AS t', [table.track])];
    // let where = [];
    // let order = ['ORDER BY t.PLAYS DESC'];
    // let limit = [];
    // let offset = [];
    // SELECT count(*) AS totalRow FROM ?? AS t','WHERE','t.TITLE LIKE ?
    // SELECT * FROM ?? AS t WHERE t.TITLE LIKE ? ORDER BY t.PLAYS DESC LIMIT ? OFFSET ?
    // [table.track,keyword,limit,offset]
    // console.log(selector.join(' '));

    /*
    let selector = this.queryTrackSearch();

    // let selectorCount = app.sql.format(selector.join(' '), ['count(0) AS totalRow']);
    let selectorCount = selector.join(' ').replace('*','count(0) AS totalRow');
    // let selectorCount = selector.join(' ');
    console.log(selectorCount);

    // selector.unshift('')
     // ORDER BY t.PLAYS DESC LIMIT ? OFFSET ?
    selector.push(app.sql.format('ORDER BY t.PLAYS DESC LIMIT ? OFFSET ?', [limit,offset]));

    console.log(selector.join(' '));
    */
    return selector;
  }

  requestAlbum(callback) {
  }

  requestArtist(callback) {
  }

  track(callback) {
    let limit=config.track_limit,
        offset,
        activePage=this.request.page,
        totalRow,
        totalPage,
        result={},
        meta={};

   // function asyncDelay(){
   //   return new Promise(resolve => setTimeout(resolve,0));
   // }
   async function asyncPromise(row,Id){
     // await asyncDelay();
     // await new Promise(resolve => setTimeout(resolve,0));
     if (!result.hasOwnProperty(Id)){
       result[Id]={
         artist:[],
         genre:[],
         year:[],
         track:[],
         totalPlay:0
       };
     }
     result[Id].totalPlay=result[Id].totalPlay+ parseInt(row.PLAYS);

     result[Id].artist.push(row.ARTIST);
     result[Id].artist=Array.from(new Set(result[Id].artist));

     result[Id].genre.push(row.GENRE);
     result[Id].genre=Array.from(new Set(result[Id].genre));

     result[Id].year.push(row.YEAR);
     result[Id].year=Array.from(new Set(result[Id].year));

     result[Id].album=row.ALBUM;
     result[Id].track.push(row);
   }
   async function asyncEach(raw) {
     for(const row of raw){
        await asyncPromise(row,row.UNIQUEID);
     }
     let metaType='track';
     // NOTE: music-tracks, music-track,music-albums, music-album, music-artists, music-artist
     meta.album=Object.keys(result).length;
     if (meta.album == 1) {
       metaType='album-detail';
     }
     // TODO: title, description, keywords
     callback({type:metaType,data:result,meta:meta});
   }
   let selector = this.queryTrackSearch();
   app.sql.query(selector.join(' ').replace('*','count(0) AS totalRow'), (err, raw) => {
     totalRow = raw[0].totalRow;
     activePage=parseInt(activePage);
     totalPage = Math.ceil(totalRow / limit);
     if (!activePage || activePage < 1) {
       activePage = 1;
     } else if (activePage > totalPage) {
       activePage= totalPage;
     }
     offset = limit * (activePage - 1);

     meta={
       active:activePage,
       page:totalPage,
       row:totalRow,
       limit:limit,
       offset:offset
     };

     if (totalRow > 0) {
       // NOTE: SELECT * FROM zd_track AS t ORDER BY t.PLAYS DESC LIMIT 22 OFFSET 2
       selector.push(app.sql.format('ORDER BY t.PLAYS DESC LIMIT ? OFFSET ?', [limit,offset]));
       app.sql.query(selector.join(' '), (err, raw,column) => {
         // console.log(raw.length);
         // console.log(raw.affectedRows);
         asyncEach(raw);
       });
     } else {
       callback({type:'track-notfound',data:result,meta:meta});
     }
   });
  }

  album(callback) {
    let limit=config.track_limit,
        offset,
        activePage=this.request.page,
        totalRow,
        totalPage,
        result={},
        meta={};

    async function asyncPromise(row,Id){
      result[Id]={
        artist:config.unique(row.listArtist.split(",")),
        album:row.ALBUM,
        genre:config.unique(row.listGenre.split(",")),
        year:config.unique(row.listYear.split(",")),

        totalTrack:row.totalTrack,
        totalLength:new Timer(row.listLength).format(),
        plays:row.totalPlay,
        lang:row.LANG
      };
    }

    async function asyncEach(raw) {
      for(const row of raw){
         await asyncPromise(row,row.UNIQUEID);
      }
      callback({type:'album',data:result,meta:meta});
    }

    let selector = this.queryTrackSearch();
    app.sql.query(selector.join(' ').replace('*','count(0) AS totalRow'), (err, raw) => {
      totalRow = raw[0].totalRow;
      activePage=parseInt(activePage);
      totalPage = Math.ceil(totalRow / limit);
      if (!activePage || activePage < 1) {
        activePage = 1;
      } else if (activePage > totalPage) {
        activePage= totalPage;
      }
      offset = limit * (activePage - 1);
      meta={
        active:activePage, page:totalPage, row:totalRow, limit:limit, offset:offset
      };
      if (totalRow > 0) {
        selector.push(app.sql.format('GROUP BY t.UNIQUEID ORDER BY totalPlay DESC LIMIT ? OFFSET ?', [limit,offset]));
        app.sql.query(selector.join(' ').replace('*','*,GROUP_CONCAT(t.YEAR) listYear, GROUP_CONCAT(t.GENRE) listGenre, GROUP_CONCAT(t.LENGTH) listLength,GROUP_CONCAT(t.ARTIST) listArtist, SUM(t.PLAYS) AS totalPlay, COUNT(t.ID) AS totalTrack'), (err, raw,column) => {
          // callback({type:'album',meta:meta,data:raw});
          asyncEach(raw);
        });
      } else {
        callback({type:'album-notfound',meta:meta,data:result});
      }
    });
  }

  artist(callback) {
    let limit=config.track_limit,
        offset,
        activePage=this.request.page,
        totalRow,
        totalPage,
        result={},
        meta={};
    async function asyncPromise(row,Id){
      result[Id]={
        artist:row.ARTIST,
        // album:config.unique(row.listAlbum.split(",")),
        // genre:config.unique(row.listGenre.split(",")),
        year:config.unique(row.listYear.split(",")),
        totalTrack:row.totalTrack,
        totalAlbum:config.unique(row.listAlbum.split(",")).length,
        totalLength:new Timer(row.listLength).format(),
        // totalLength:row.listLength,
        plays:row.totalPlay,
        lang:row.LANG
      };
    }
    async function asyncEach(raw) {
      for(const row of raw){
         await asyncPromise(row,row.UNIQUEID);
      }
      callback({type:'artist ???',data:result,meta:meta});
    }
    let selector = this.queryTrackSearch();
    app.sql.query(selector.join(' ').replace('*','count(0) AS totalRow'), (err, raw) => {
      totalRow = raw[0].totalRow;
      activePage=parseInt(activePage);
      totalPage = Math.ceil(totalRow / limit);
      if (!activePage || activePage < 1) {
        activePage = 1;
      } else if (activePage > totalPage) {
        activePage= totalPage;
      }
      offset = limit * (activePage - 1);

      meta={
        active:activePage,
        page:totalPage,
        row:totalRow,
        limit:limit,
        offset:offset
      };

      if (totalRow > 0) {
        selector.push(app.sql.format('GROUP BY t.ARTIST ORDER BY totalPlay DESC LIMIT ? OFFSET ?', [limit,offset]));
        app.sql.query(selector.join(' ').replace('*','*,GROUP_CONCAT(t.YEAR) listYear, GROUP_CONCAT(t.GENRE) listGenre, GROUP_CONCAT(t.LENGTH) listLength,  GROUP_CONCAT(t.ALBUM) listAlbum, SUM(t.PLAYS) AS totalPlay, COUNT(t.ID) AS totalTrack'), (err, raw,column) => {
          // callback({type:'album',meta:meta,data:raw});
          asyncEach(raw);
        });
      } else {
        callback({type:'artist-notfound',meta:meta,data:result});
      }
    });
  }

  async track_generator(callback) {
    let limit=this.request.limit || config.track_limit, offset,
        activePage=this.request.page,
        totalRow, totalPage,
        result=[], meta={};

   async function asyncPromise(rows,Ui){
    var tmp ={
      ui:Ui,
      ab:rows[0].ALBUM,
      // ar:'get it from tk',
      // ar:rows[0].ARTIST,
      gr:[],
      yr:[],
      lg:[],
      tp:0,
      tk:[],
      // lt:[]
    };
    await rows.forEach(row => {
      var artists = Array.from(new Set(row.ARTIST.split(',').map(i=>i.trim())));
      tmp.tk.push({
          id:row.ID,
          tl:row.TITLE,
          // ar:row.ARTIST,
          ar:artists,
          n:row.TRACK,
          t:row.TYPE,
          l:row.LENGTH,
          p:row.PLAYS,
          s:row.STATUS
      });
      tmp.tp=tmp.tp + parseInt(row.PLAYS);
      // tmp.ar = tmp.ar+','+row.ARTIST;
      // tmp.ar.concat(',', row.ARTIST);
      // tmp.ar = tmp.ar+', '+row.ARTIST;
      tmp.lg.push(row.LANG);
      tmp.gr.push(row.GENRE.toLowerCase());
      tmp.yr.push(row.YEAR);
      // tmp.lt.push(row.LENGTH);
    });
    // tmp.ar=Array.from(new Set(tmp.ar.split(',').map(i=>i.trim())));
    tmp.lg=Array.from(new Set(tmp.lg));
    tmp.gr=Array.from(new Set(tmp.gr));
    tmp.yr=Array.from(new Set(tmp.yr));
    // tmp.lt=new Timer(tmp.lt).format();
    result.push(tmp);
   }

   function groupBy(list, keyGetter) {
     const map = new Map();
     list.forEach(item => {
        const key = keyGetter(item);
        const collection = map.get(key);
        if (!collection) {
            map.set(key, [item]);
        } else {
            collection.push(item);
        }
     });
     return map;
   }

   async function asyncEach(raw) {
    var grouped = await groupBy(raw, row => row.UNIQUEID);
    for(const row of grouped) await asyncPromise(row[1],row[0]);
    // Array.from(grouped)
    // grouped.get('db23ab53bbbceb1131b6123236e2cb38')
     callback({meta:meta,data:result});
   }

   let selector = this.queryTrackSearch();
   app.sql.query(selector.join(' ').replace('*','count(0) AS totalRow'), (err, raw) => {
     totalRow = raw[0].totalRow;
     if (isNaN(limit)){
      limit=parseInt(totalRow);
     }
     activePage=parseInt(activePage);
     totalPage = Math.ceil(totalRow / limit);
     if (!activePage || activePage < 1) {
       activePage = 1;
     } else if (activePage > totalPage) {
       activePage= totalPage;
     }
     offset = limit * (activePage - 1);

     meta={active:activePage,page:totalPage,row:totalRow,limit:limit,offset:offset};

     if (totalRow > 0) {
       selector.push(app.sql.format('ORDER BY t.PLAYS DESC LIMIT ? OFFSET ?', [limit,offset]));
       app.sql.query(selector.join(' '), (err, raw,column) => {
         asyncEach(raw);
       });
     } else {
       callback({meta:meta,data:result});
     }
   });
  }

  trackId() {
    return app.sql.join(
      'UPDATE ?? SET PLAYS = PLAYS + 1 WHERE ID=?', [table.track,this.request.trackId]
    ).then(
      e=>e.query("SELECT distinct t.*, concat_ws('/', a.`PATH`, t.`PATH`) AS PATH \
        FROM ?? AS t, ?? AS a \
          WHERE t.`ID`=? AND t.`UNIQUEID`=a.`UNIQUEID` LIMIT 1;", [table.track,table.album,this.request.trackId]
      ).then(e=>{
        return e[0];
      })
    );
  }

  // track_dumpList(callback) {
  //  app.sql.query('SELECT * FROM zd_track AS t ORDER BY t.PLAYS DESC LIMIT 9', callback);
  // }

  // track_dumpId(trackId,callback) {
  //  app.sql.query('SELECT * FROM zd_track WHERE ID=?', [trackId], callback);
  // }

  // track_dump(callback) {
  //  app.sql.query('SELECT * FROM zd_track LIMIT 3', callback);
  // }

  // trackCount(callback) {
  //  const query = mysql.format('SELECT count(*) AS TotalCount FROM ??', [table.track]);
  // }

  // track_Test(callback) {
  //  callback(this.param);
  // }
}