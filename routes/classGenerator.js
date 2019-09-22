const {Config,Common} = require('../');
const {fs,path} = Common;
// const path = require('path');
const Music = require('./classMusic');
// var util = require('util');
// console.log(app.Config.dir.static);
// console.log(app.Common);
module.exports = class Generator {
  constructor(param) {
    this.setting=param;
    this.store={};
    // this.storage = path.join(Config.dir.static);
    this.storage = path.join(Config.media,'store');
  }

  get isJSONOk (){
    var fileName = this.setting.type;
    if (this.store.hasOwnProperty(fileName)){
      return Object.keys(this.store[fileName]).length;
    }
    return false;
  }

  json(e) {
    return path.join(this.storage,e+'.json');
  }

  read() {
    // fileName = fileName || this.setting.type;
    var fileName = this.setting.type;
    if (this.store.hasOwnProperty(fileName)){
      return this.store[fileName];
    } else {
      let file = this.json(fileName);
      var data = fs.readJsonSync(file,{throws:false});
      if (data && data instanceof Object) {
        return this.store[fileName] = data;
      } else {
        return {};
      }
    }
  }

  write(data) {
    var fileName = this.setting.type;
    if (data){
      this.store[fileName] = data;
    }
    if (this.store.hasOwnProperty(fileName)){
      let file = this.json(fileName);
      // data = data || this.store[fileName];
      // ,{spaces:2}
      let options = {};
      // if (this.setting.hasOwnProperty('limit')){
      //   options = {spaces:2};
      // }
      if (!isNaN(this.limit)){
        options.spaces = 2;
      }
      fs.writeJsonSync(file, this.store[fileName],options);
    }
  }

  async track(callback){
    await this.read();
    if (this.isJSONOk){
      callback(this.read());
    } else {
       new Music(this.setting).track_generator(async (raw)=> {
        callback(raw);
        this.write(raw);
      });
    }
  }
  async trackUpdate(callback){
    new Music(this.setting).track_generator(async (raw)=> {
      await this.write(raw);
      callback({Updated:true,meta:raw.meta});
    });
  }
};