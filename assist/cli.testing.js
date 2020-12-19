const app = require('..');
// const {Burglish} = app.Common;

const abc = require('./crypto');

// var {setting} = require('../config');
// const {readBucket,readAlbum,writeAlbum,selectTrack,insertTrack} = require('./data');

module.exports = async function(){
  // var artists = ['Mv paunos','Mv pauno','Mv   pauno',' a  b '];
  // console.log(path.parse('Vincy Feat. Catherine Lalpuii Khiangte - Kan Hlim Ni.mp3').name)
  // var abc =  new Burglish('Catherine Lalpuii Khiangte')
  // // abc.toUnicode;
  // console.log('01-ဘုရားခ်စ္တဲ့သုိးေလး',abc.toUnicode)

  return app.Config;


  // var abc =  new Burglish('01-ဘုရားခ်စ္တဲ့သုိးေလး')
  // await abc.toUnicode();
  // console.log('01-ဘုရားခ်စ္တဲ့သုိးေလး',abc.text)
  // var result = artists.map(
  //   i=> artistsName.filter(
  //     e=>e.invalid.includes(i)
  //   ).map(
  //     e=>e.name
  //   )
  // );

  /*
  function uniqueNumber() {
    var date = Date.now();
    // If created at same millisecond as previous
    if (date <= uniqueNumber.previous) {
        date = ++uniqueNumber.previous;
    } else {
        uniqueNumber.previous = date;
    }
    return date;
  }
  uniqueNumber.previous = 0;
  for (let step = 0; step < 5; step++) {
    // Runs 5 times, with values of step 0 through 4.
    // console.log('Walking east one step',Math.round(Date.now() + Math.random()));
    // console.log(new Date().valueOf())
    // console.log(new Date().getUTCMilliseconds())
    console.log(uniqueNumber())
    // console.log(Math.random())
    // console.log(new Date().getTime())
  }
  */
}

/*
gsutil -m cp -r gs://storage.lethil.me/music/tmp c:/storage/music/tmp/
gsutil -m cp -r gs://storage.lethil.me/music/mizo/diski/Alex-KaLuahZoSiLo c:/storage/music/tmp/
gsutil -m cp -r gs://storage.lethil.me/music/mizo/diski/HC.Lalsanglura-KaLoNghakRengAngChe c:/storage/music/tmp/
gsutil -m cp -r gs://storage.lethil.me/music/mizo/diski/Hmingsanga-KaLoTawnChe c:/storage/music/tmp/
delete it --> gsutil -m cp -r gs://storage.lethil.me/music/mizo/diskii/Nunu-ISing'sDolly c:/storage/music/tmp/
gsutil -m cp -r gs://storage.lethil.me/music/mizo/diskiii/SPI-RemVeTheiSe c:/storage/music/tmp/
gsutil -m cp -r gs://storage.lethil.me/music/myanmar/PUKHEN/အစဥ်ချီးမွမ်း c:/storage/music/tmp/

"meta":{
  "year":"2014"
},
music/mizo/SINGLE/Lungdumtu
a0b019be09bad06a54ad

gsutil -m cp -r gs://storage.lethil.me/music/mizo/diskiii/SPI-KaNgaiEmChe c:/storage/music/tmp/
gsutil -m cp -r gs://storage.lethil.me/music/mizo/diski/Daduhi-Lungdumtu c:/storage/music/tmp/
77b619f50990f8e4acbd
*/