import { route } from "lethil";

import { meta } from "../assist/index.js";

const routes = new route.gui("navPage", "/");

routes.get({ url: "", route: "home", text: "Home" }, function (_req, res) {
	meta(res.locals).then(() =>
		res.render("home", {
			title: "Zaideih",
			description: "Zaideih Music Station",
			keywords: "zola, mp3, myanmar",
			pageClass: "home",
		})
	);
});
