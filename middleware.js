import { server, config, parse } from "lethil";
import cookieParser from "cookie-parser";
import compression from "compression";
// import {language} from './assist/index.js';

const app = server();

app.disable("x-powered-by");

app.use(cookieParser());

app.use(app.middleware.static("static"));
// if (config.development) {
// 	import("./webpack.middleware.js").then((mwa) => {
// 		app.use(mwa.dev);
// 		app.use(mwa.hot);
// 	});

// app.use(app.middleware.menu);
app.use(compression());

app.use(function (req, res, next) {
	// res.locals.app_locale = locale;

	res.locals.appName = config.name;
	res.locals.appVersion = config.version;
	res.locals.appDescription = config.description;
	res.locals.environment = config.development ? "development" : "production";

	// if (req.headers.referer) {
	// 	var ref = parse.url(req.headers.referer);
	// 	res.locals.referer = req.headers.host == ref.host; // || config.user.referer.filter((e)=>e.exec(ref.host)).length > 0;
	// 	res.locals.host = ref.protocol + "//" + req.headers.host;
	// }

	next();
});

/**
 * org: restrictMiddleWare
 */
app.use("/api", function (req, res, next) {
	if (req.headers.referer) {
		var ref = parse.url(req.headers.referer);
		res.locals.referer = req.headers.host == ref.host;

		// ref.host == host;
		// req.headers.referer -> https://myordbok.lethil.me
		// req.headers.host -> myordbok
		// req.headers.host -> myordbok.lethil.me
		// ref.host - myordbok.lethil.me
	}

	if (res.locals.referer) {
		// NOTE: internal

		const requestedInternal = req.originalUrl.split("/")[3];
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
