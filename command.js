const app = require('.');
const fn = app.Param.shift() || 'main';
const assist = require('./assist/cli');

module.exports = async function(){
  if (typeof assist[fn] != 'function') {
    // throw {code:fn,message:typeof assist[fn]};
    throw '0 is 1'.replace(0,fn).replace(1,typeof assist[fn]);
  }
  try {
    return await assist[fn](app.Param[0]);
  } catch (error) {
    throw error
  }
}

// const app = require('.');
// const {utility} = app.Common;
// const task = require('./task');
// const fn = app.Param.shift() || 'main';

// module.exports = async function(){
//   if (typeof task[fn] == 'function') {
//     await task[fn]().then(
//       e=>utility.log.msg(e)
//     ).catch(
//       e=>utility.log.error(e)
//     );
//   } else {
//     utility.log.msg({code:fn,message:typeof task[fn]})
//   }
// }