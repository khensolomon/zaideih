import {config,route,parse} from 'lethil';
// import {language} from './assist/index.js';

const routes = route();

if (config.development){
  import('./webpack.middleware.js').then(
    mwa => {
      routes.use(mwa.dev);
      routes.use(mwa.hot);
    }
  )
}

routes.use(
  /**
   * @param {*} req
   * @param {*} res
   * @param {*} next
   */
  function(req, res, next){

    // res.locals.app_locale = locale;

    res.locals.appName = config.name;
    res.locals.appVersion = config.version;
    res.locals.appDescription = config.description;

    if (req.headers.referer){
      var ref = parse.url(req.headers.referer);
      res.locals.referer = req.headers.host == ref.host;// || config.user.referer.filter((e)=>e.exec(ref.host)).length > 0;
      res.locals.host = ref.protocol+'//'+req.headers.host;
    }

    next();
  }
);

/**
 * org: restrictMiddleWare
 */
routes.use(
  '/api/:audio?',
  /**
   * @param {*} req
   * @param {*} res
   * @param {*} next
   */
  function(req, res, next){
    next();
    // if (res.locals.referer) return next();
    // res.status(404).end();
    // if (req.xhr || req.headers.range) next();
    // if (req.params.audio && res.locals.referer)
    // if (res.locals.referer) {
    //   if (req.xhr || req.headers.range) {
    //     return next();
    //   }
    // } else {
    //   var base = Object.keys(config.restrict), user = Object.keys(req.query), key = base.find(e => user.includes(e));
    //   if (key && config.restrict[key] == req.query[key]) {
    //     return next();
    //   }
    // }
    // res.status(404).send();
  }
);
