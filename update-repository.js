const upgrade = require("@scriptive/evh/upgrade");
// 'test/upgrade'
upgrade().then(
  e=>console.log('>',e)
).catch(
  e=>console.error('>',e)
)