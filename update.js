// const scriptive = require("@scriptive/evh/update");
const path = require('path');
const package = require('./package.json')
const update = require("@scriptive/evh/update");

update.repository().then(
  (e)=> {
    console.log(e)
    update.package();
  }
);