import core from 'lethil';
import mysql from 'mysql';
// import mongodb from 'mongodb';
import config from './assist/anchor/config.js';

// core.set('root','./test?');
// core.set('hostname','localhost');
// core.set('port',8087);
// core.set('config',config);
core.set("mysql",mysql);
// core.set("mongo",mongodb);
core.set('config',config.setting);

export default core;
