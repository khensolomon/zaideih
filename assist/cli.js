const app = require('..');
const path = require('path');
app.Config.bucketActive = app.Config.bucketAvailable.includes(app.Param[0])?app.Param[0]:null;
app.Config.store.bucket = path.join(app.Config.media,app.Config.store.bucket).replace('?',app.Config.bucketActive||'tmp?');

const register = require('./cli.register');


exports.main = async () => 'what do you mean?';


/*
node run zaideih register zola
node run zaideih register myanmar
node run zaideih register mizo
node run zaideih register falam
*/
exports.register = async () => await register.main();
