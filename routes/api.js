import { route, seek } from "lethil";

import { config, meta, trackList, audio, store } from "../assist/index.js";

const routes = new route.gui("API", "/api");

routes.get("", function (_req, res) {
	meta().then((e) => res.json(e));
});

routes.get("/config", (_req, res) => {
	res.json(config);
});

routes.get("/album", function (_req, res) {
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	seek.readStream(store.album.file).pipe(res);
});

routes.get("/genre", function (_req, res) {
	seek.readStream(store.genre.file).pipe(res);
});

routes.get("/artist", function (_req, res) {
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	seek.readStream(store.artist.file).pipe(res);
});

routes.get("/track-list-id-plays", function (_req, res) {
	trackList()
		.then((e) => res.json(e))
		.catch(() => ({}));
});

routes.get("/audio/:trackId?", audio.streamer);
