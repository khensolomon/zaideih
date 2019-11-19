// const app = require.main.exports;
// const {Config,Common,sql} = require('.');
const app = require('.');
const {utility} = app.Common;
const fn = app.Param.shift() || 'main';
const assist = require('./assist/cli');

module.exports = async function(){
  if (typeof assist[fn] == 'function') {
    await assist[fn]().then(
      e=>utility.log.msg(e)
    ).catch(
      e=>utility.log.error(e)
    );
  } else {
    utility.log.msg({code:fn,message:typeof assist[fn]})
  }
}

// module.exports = async function(){
//   var raw = await app.sql.query('SELECT created,count(ip) AS visits_count,sum(view) AS visits_total FROM visits').then(raw=>raw);
//   console.log(raw)
// };
