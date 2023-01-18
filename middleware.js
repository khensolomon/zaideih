import { config, route, parse } from "lethil";
// import {language} from './assist/index.js';

const routes = new route.gui();

if (config.development) {
	import("./webpack.middleware.js").then((mwa) => {
		routes.use(mwa.dev);
		routes.use(mwa.hot);
	});
}

routes.use(function (req, res, next) {
	// res.locals.app_locale = locale;

	res.locals.appName = config.name;
	res.locals.appVersion = config.version;
	res.locals.appDescription = config.description;
	res.locals.environment = config.development ? "development" : "production";

	if (req.headers.referer) {
		var ref = parse.url(req.headers.referer);
		res.locals.referer = req.headers.host == ref.host; // || config.user.referer.filter((e)=>e.exec(ref.host)).length > 0;
		res.locals.host = ref.protocol + "//" + req.headers.host;
	}

	next();
});

/**
 * org: restrictMiddleWare
 */
routes.use("/api", function (req, res, next) {
	if (res.locals.referer) {
		// NOTE: internal
		const requestedInternal = req.route.pathname.split("/")[3];
		// req.xhr ||
		if (requestedInternal == "audio") {
			if (req.headers.range) {
				return next();
			}
		} else {
			return next();
		}
	} else {
		// NOTE: external
		const base = Object.keys(config.restrict),
			user = Object.keys(req.query),
			key = base.find((e) => user.includes(e));
		if (key && config.restrict[key] == req.query[key]) {
			return next();
		}
	}
	res.status(404).end();
});
