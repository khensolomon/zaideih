const app = require('..');
const {path,utility} = app.Common;

const Cloud = require('./cloud');
var {setting} = require('../config');
const {readBucket,writeBucket} = require('./data');

exports.main = async function(){
  if (!app.Param.length) throw {code:'require',message:'directory'};
  if (!setting.bucketActive) throw {code:'unavailable',message:app.Param.join('/')};
  await readBucket();
  var previousCount = setting.bucketContent.length;
  var dir = app.Param.slice();
  dir.unshift('music');

  const [files] = await Cloud.bucket.getFiles({
    directory:dir.join('/'),
    prefix:'/',
    // delimiter: '/',
    autoPaginate: true
  });
  // setting.bucketContent=[{id:'',dir:'',raw:[],meta:{}}];
  var tmp = [];

  files.forEach(file => {
    if (!file.name.endsWith("/")){
      var folder = path.dirname(file.name);
      var filename = path.basename(file.name);
      var test = setting.bucketContent.filter(e=>e.dir == folder);
      if (test.length){
        if (tmp.indexOf(folder) === -1){
          test[0].raw=[];
          tmp.push(folder);
        }
        if (!test[0].id){
          test[0].id=utility.createUniqueId();
        }
        if (!test[0].meta){
          test[0].meta={}
        }
        test[0].raw.push(filename);
      } else {
        tmp.push(folder);
        setting.bucketContent.push({id:utility.createUniqueId(),dir:folder,raw:[filename],meta:{},track:[]});
      }
    }
  });
  console.log('....',setting.bucketContent.length, '/',setting.bucketContent.length - previousCount,'...new directory, file not counted');
  await writeBucket();
}