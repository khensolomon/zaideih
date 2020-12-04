const upgrade = require("@scriptive/evh/upgrade");

upgrade('test/upgrade').then(
  e=>console.log('>',e)
).catch(
  e=>console.error('>',e)
)