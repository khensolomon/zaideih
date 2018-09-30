module.exports = class Timer {
  constructor(data) {
    this.result=[0,0,0];
    if (data.constructor == Array) {
      this.data=data;
    } else {
      this.data=data.split(",");
    }
  }
  each(raw){
    // await new Promise(resolve => setTimeout(resolve,0));
    let row =raw.split(':');
    if (row.length == 3) {
      this.hour.push(parseInt(row[0]));
      this.minute.push(parseInt(row[1]));
      this.second.push(parseInt(row[2]));
    } else if (row.length == 2) {
      this.minute.push(parseInt(row[0]));
      this.second.push(parseInt(row[1]));
    }
  }
  sum(num){
    return num.reduce(function(a,b) {
      return a + b
    });
  }
  convert(a){
    // let minutes = Math.floor(time / 60);
    // return time - minutes * 60;
    let leftOver = Math.floor(this.result[a] / 60);
    this.result[a] = this.result[a] - leftOver * 60;
    return leftOver;
  }
  get(){
    for(const raw of this.data){
      let row =raw.split(':');
      if (row.length == 3) {
        this.result[0] += parseInt(row[0]);
        this.result[1] += parseInt(row[1]);
        this.result[2] += parseInt(row[2]);
      } else if (row.length == 2) {
        this.result[1] += parseInt(row[0]);
        this.result[2] += parseInt(row[1]);
      }
    }
    this.result[1] += this.convert(2);
    this.result[0] += this.convert(1);

    return this.result;
  }
  format(){
    return this.get().map(function(e){
      return (e < 10)?'0'+e:e;
    }).join(':');
  }
};