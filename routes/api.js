import url from "url";
import { server, seek } from "lethil";

import { meta, trackList, audio, store } from "../assist/index.js";

const app = server();
const routes = app.routes("/api");

routes.register("", function (req, res) {
	meta().then((e) => res.json(e));
});

// routes.register("/config", (req, res) => {
// 	res.json(config);
// });

routes.register("/test/*", (req, res) => {
	res.json({
		parse: url.parse(req.originalUrl),

		url: req.url,
		path: req.path,
		baseUrl: req.baseUrl,
		originalUrl: req.originalUrl,
	});
});

routes.register("/album", function (req, res) {
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	seek.readStream(store.album.file).pipe(res);
});

routes.register("/genre", function (_req, res) {
	seek.readStream(store.genre.file).pipe(res);
});

routes.register("/artist", function (_req, res) {
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	seek.readStream(store.artist.file).pipe(res);
});

routes.register("/track-list-id-plays", function (req, res) {
	trackList()
		.then((e) => res.json(e))
		.catch(() => ({}));
});

routes.register("/audio/:trackId/?", audio.streamer);
routes.register("/audio/*", audio.streamer);
// routes.register("/audio", audio.streamer);
