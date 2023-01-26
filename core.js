import core from "lethil";
import mysql from "mysql2";
// import mongodb from 'mongodb';
// import config from "./assist/anchor/config.js";

core.set.only("root", process.cwd());
// core.set.only("root", "./test?");
// core.set.only("hostname", "localhost");
// core.set.only("port", 8087);
// core.set.only("config", config);
core.set.only("mysql", mysql);
// core.set.only("mongo", mongodb);
// core.set.only("config", config.setting);
// core.set.merge(config.setting);

export default core;
