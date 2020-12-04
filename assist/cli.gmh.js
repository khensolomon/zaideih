// NOTE: not ready

const app = require('..');
const {Burglish} = app.Common;
const fs = require('fs');
const path = require('path');
// const request = require('request');
const NodeID3 = require('node-id3');
// var {setting} = require('../config');
// const {readBucket,readAlbum,writeAlbum,selectDatabase,insertDatabase} = require('./data');

var taskList = [];

const gmhDirectory = path.join(app.Config.storage,'gmh');
const gmhFile = path.join(gmhDirectory,'feed.json');

const readJSON = async () => fs.promises.readFile(gmhFile).then(o=>Object.assign(taskList,JSON.parse(o))).catch(()=>taskList=[]);
const writeJSON = async () => fs.promises.writeFile(gmhFile,JSON.stringify(taskList,null,2));


module.exports.main = async function(){
  throw 'only testing, please check the script and uncomment?';
  await readJSON();

  for (const album of taskList) {
    console.log(album.name)
    for (const track of album.track) {
      if (!track.downloaded) {
        await requestAudio(track,album.name).then(
          e=>{
            track.downloaded=true;
            console.log(e)
          }
        ).catch(
          e=>console.log(e)
        );
        await writeJSON();
      }
    }
  }

  // var name = taskList.map(
  //   e=>e.name
  // );
  // var nameDuplicates = name.filter((item, index) => name.indexOf(item) != index)
  // console.log(nameDuplicates)
}

module.exports.name = async function(){
  throw 'only testing, please check the script and uncomment?';
  /*
  const dirMain = path.join(gmhDirectory,'mp3');
  var dirList = fs.readdirSync(dirMain);
  for (const dir of dirList) {
    var fileList = fs.readdirSync(path.join(dirMain,dir));
    for (const file of fileList) {
      var fileNameUnicode = new Burglish(file).toUnicode;
      var filePath = path.join(dirMain,dir,file);
      var filePathUnicode = path.join(dirMain,dir,fileNameUnicode);
      await fs.renameSync(filePath, filePathUnicode);
      console.log(' ',fileNameUnicode)
    }
  }
  */
  // const dir = path.join(gmhDirectory,'mp3','achit-shi-dea-nay-yar');
  // const content = await fs.readFileSync(path.join(dir,'tmp.mp3'));
  // var info = NodeID3.read(content);
  // console.log(info);
  // let tags = {
  //   title: new Burglish(info.title).toUnicode,
  //   artist: new Burglish(info.artist).toUnicode,
  //   album: new Burglish(info.album).toUnicode,
  //   trackNumber: parseInt(info.trackNumber.split('/')[0], 10),
  //   comment: {language:'eng',shortText:'',text:'zaideih.com' }
  // };
  // let success = NodeID3.update(tags, path.join(dir,'tmp.mp3'))
  // console.log('is success', success)


  const dirMain = path.join(gmhDirectory,'mp3');
  var dirList = await fs.readdirSync(dirMain);
  for (const dir of dirList) {
    var fileList = await fs.readdirSync(path.join(dirMain,dir));
    for (const fileName of fileList) {
      var file = path.join(dirMain,dir,fileName);

      const content = await fs.readFileSync(file);
      try {
        var info = NodeID3.read(content);
        let tags = {
          comment: {language:'eng',shortText:'gmh',text: 'zaideih.com'}
        };
        if (info.title){
          tags.title=new Burglish(info.title).toUnicode;
        }
        if (info.artist){
          tags.artist=new Burglish(info.artist).toUnicode;
        }
        if (info.album){
          tags.album=new Burglish(info.album).toUnicode;
        }
        if (info.trackNumber){
          tags.trackNumber=parseInt(info.trackNumber.split('/')[0], 10);
        }
        let success = await NodeID3.update(tags, file)
        console.log('is success',success, dir, fileName);
      } catch (error) {
        console.log('---',dir, fileName);
      }
    }
  }

  // TODO a-nine-mar-shi
  // ကောင်းသောမြေ duplicated at zaideih
  // 1fde1949099550d143fa check artsts ???
  // 9309191d098db87b66a1 check album name ???
}

module.exports.feed = async function(){
  throw 'only testing, please check the script and uncomment?';
  await readJSON();
  await requestFeed(1).then(
    e=>console.log(e)
  ).catch(
    e=>console.log(e)
  );
  await writeJSON();
}


async function requestAudio(o,dir){
  var url = Buffer.from(o.mp3, 'base64').toString('utf8');
  var filename = path.basename(url);
  var albumFolder = path.join(gmhDirectory,'mp3-download',dir);
  if (!fs.existsSync(albumFolder)) await fs.mkdirSync(albumFolder);
  return new Promise(function(resolve, reject) {
    const file = fs.createWriteStream(path.join(albumFolder,filename));
    request.get({url: encodeURI(url)}).on('error', (e) => {
      reject(e)
    }).on('response', function(response) {
      console.log(response.statusCode,response.headers['content-type'])
    }).pipe(file).on('finish', () => {
      resolve(filename)
    });
  });
}
async function requestFeed(page){
  console.log('feed',page)
  var url = '/deef/moc.llibnrohm.lepsog//:ptth'.split("").reverse().join('');
  var feeds = (callback) =>  request.get({url: url, qs:{ paged:page}},callback);
  return new Promise(function(resolve, reject) {
    feeds(async function(e, resp, body) {
      if (e) {
        reject(e);
      } else {
        var item = body.match(/<item>[\s\S]*?<\/item>/gi);
        if (item){
          item.map(
            e=>{
              var link = e.match(/<link>(.*)<\/link>/)[1];
              var index = taskList.findIndex(e=>e.link == link);
              var title = e.match(/<title>(.*)<\/title>/)[1];
              var tmp = link.split('/');
              var name = tmp[tmp.length - 2 ];
              var album = e.match(/<script>\nMP3jPLAYLISTS.MI_[\s\S]*?<\/script>/)[0];
              var track = album.match(/\{(.*)\}/g).map(
                e=>JSON.parse(e.replace(/:"/gi,': "').replace(/(['"])?([a-z0-9A-Z_]+)(['"])?: /g, '"$2": ').replace(/\": \/\//g,'://'))
              );
              if (index < 0 ) {
                taskList.push({title: title,name:name,link:link,track:track})
              } else {
                taskList[index]={title: title,name:name,link:link,track:track};
              }
            }
          )
          await requestFeed(page + 1).then(
            e=>resolve(e)
          ).catch(
            e=>reject(e)
          );
        } else {
          resolve('last feed')
        }
      }
    })
  })
}
/*
request.get(options, function(err, resp, body) {
      if (err) {
        reject(err);
      } else {
        var item = body.match(/<item>[\s\S]*?<\/item>/gi);
        if (item){
          item.map(
            e=>{
              var link = e.match(/<link>(.*)<\/link>/)[1];
              var index = taskList.findIndex(e=>e.link == link);
              var title = e.match(/<title>(.*)<\/title>/)[1];
              var tmp = link.split('/');
              var name = tmp[tmp.length - 2 ];
              var album = e.match(/<script>\nMP3jPLAYLISTS.MI_[\s\S]*?<\/script>/)[0];
              var track = album.match(/\{(.*)\}/g).map(
                e=>JSON.parse(e.replace(/:"/gi,': "').replace(/(['"])?([a-z0-9A-Z_]+)(['"])?: /g, '"$2": ').replace(/\": \/\//g,'://'))
              );
              if (index < 0 ) {
                taskList.push({title: title,name:name,link:link,track:track})
              } else {
                taskList[index]={title: title,name:name,link:link,track:track};
              }
            }
          )
          resolve('done');
          // resolve(resp.statusCode);
        } else {
          reject('last page')
        }
      }
    })

        var testRE = body.match(/<script>\nMP3jPLAYLISTS.MI_[\s\S]*?<\/script>/gi).map(
          e=>{
            var test = e.match(/\[\n[\s\S]*?];/gi);

            var dj = JSON.stringify(
              test[0].replace('];',']')
              .replace(/\t/g,'')
              .replace(/\n/g,'')
              .replace(/(['"])?([a-z0-9A-Z_]+)(['"])?: /g, '"$2": ').replace(/\": \/\//g,'://')
              .replace(/counterpart/g,'"counterpart"')
            );
            var abc = JSON.parse(dj);
            console.log(abc)
            return abc;
            // return dj

          }
        );
*/
/*
var whatIsThis={
  f_undo: {
    keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    f_con : function (input) {
      var output = "", i = 0, chr1, chr2, chr3, enc1, enc2, enc3, enc4;
      input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
      while (i < input.length) {
        enc1 = this.keyStr.indexOf(input.charAt(i++)); enc2 = this.keyStr.indexOf(input.charAt(i++));
        enc3 = this.keyStr.indexOf(input.charAt(i++)); enc4 = this.keyStr.indexOf(input.charAt(i++));
        chr1 = (enc1 << 2) | (enc2 >> 4); chr2 = ((enc2 & 15) << 4) | (enc3 >> 2); chr3 = ((enc3 & 3) << 6) | enc4;
        output = output + String.fromCharCode(chr1);
        if (enc3 !== 64) { output = output + String.fromCharCode(chr2); }
        if (enc4 !== 64) { output = output + String.fromCharCode(chr3); }
      }
      output = this.utf8_f_con(output);
      return output;
    },
    utf8_f_con : function (utftext) {
      var string = "", i = 0, c, c1, c2, c3;
      while (i < utftext.length) {
        c = utftext.charCodeAt(i);
        if (c < 128) {
          string += String.fromCharCode(c); i++;
        } else if ((c > 191) && (c < 224)) {
          c2 = utftext.charCodeAt(i + 1); string += String.fromCharCode(((c & 31) << 6) | (c2 & 63)); i += 2;
        } else {
          c2 = utftext.charCodeAt(i + 1); c3 = utftext.charCodeAt(i + 2); string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63)); i += 3;
        }
      }
      return string;
    }
  },
  b64EncodeUnicode:function(str){
    // var a1 = Buffer.from("http://gospel.mhornbill.com/wp-content/uploads/2019/09/Track-1.mp3").toString('base64');
    // Buffer.from("SGVsbG8gV29ybGQ=", 'base64').toString('ascii')
  }
}
*/