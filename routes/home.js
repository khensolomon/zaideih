import { server } from "lethil";
import { meta } from "../assist/index.js";

const app = server();
const routes = app.routes("*", "page");

routes.register({ name: "home", text: "Home" }, function (req, res) {
	meta(res.locals).then(() =>
		res.render("home", {
			title: "Zaideih",
			description: "Zaideih Music Station",
			keywords: "zola, mp3, myanmar",
			pageClass: "home",
		})
	);
});
