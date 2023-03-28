import { server, config } from "lethil";
import cookieParser from "cookie-parser";
import compression from "compression";
// import {language} from './assist/index.js';

const app = server();

app.disable("x-powered-by");
app.use(cookieParser());

if (config.development) {
	app.use(app.middleware.static("static"));
	// import("./webpack.middleware.js").then((mwa) => {
	// 	app.use(mwa.dev);
	// 	app.use(mwa.hot);
	// });
}

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

app.use("/api", app.middleware.guard);
