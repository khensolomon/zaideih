// new Timer(12*1000).shorten();
// new Timer(33).isSeconds().shorten();
// new Timer(12*1000).isMilliseconds().shorten();
export default class Timer {
  constructor(time) {
    this.result=[0,0,0];
    this.query = time;
    if (time){
      if (typeof time == 'array' || time.constructor == Array) {
        this.data=time;
      } else if (typeof time == 'string' && time.includes(":")) {
        this.data=time.split(",");
      } else {
        this.data=[time];
      }
    }
  }
  isMilliseconds(){
    if (!this.data) this.data=[this.datetime(this.query)];
    return this;
  }
  isSeconds(){
    if (!this.data) this.data=[this.datetime((this.query) * 1000)];
    return this;
  }
  datetime(time){
    return (new Date(time)).toUTCString().match(/(\d\d:\d\d:\d\d)/)[0]
  }
  sum(num){
    return num.reduce(function(a,b) {
      return a + b
    });
  }
  convert(i){
    // let minutes = Math.floor(time / 60);
    // return time - minutes * 60;
    let leftOver = Math.floor(this.result[i] / 60);
    this.result[i] = this.result[i] - leftOver * 60;
    return leftOver;
  }
  get(){
    // for(const raw of this.data){
    //   let row =raw.split(':');
    //   if (row.length == 3) {
    //     this.result[0] += parseInt(row[0]);
    //     this.result[1] += parseInt(row[1]);
    //     this.result[2] += parseInt(row[2]);
    //   } else if (row.length == 2) {
    //     this.result[1] += parseInt(row[0]);
    //     this.result[2] += parseInt(row[1]);
    //   }
    // }
    // this.result[1] += this.convert(2);
    // this.result[0] += this.convert(1);
    // return this.result;
    // [230,700].reduce((a, b) => a + b)
    return this.data.reduce((a, b) => a + b);
  }

  format(){

    // return this.get().map(function(e){
    //   return (e < 10)?'0'+e:e;
    // }).join(':');
    var sec_num = parseInt(this.get(), 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    // var seconds = sec_num - (hours * 3600) - (minutes * 60);

    return [
      hours,minutes,sec_num - (hours * 3600) - (minutes * 60)
    ].map(
      e=>e>=10?e:"0"+e
    ).join(':');
  }

  shorten(){
    var time = this.format().replace(/^[0|\D]*/,'');
    return this.correction(time);
  }

  correction(time){
    time = time||this.query;
    switch(time.length) {
      case 1: return '0:0'+time;
      case 2: return '0:'+time;
      default: return time;
    }
  }
};