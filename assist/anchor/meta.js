import { bucketAvailable } from "./env.js";
import { album, artist, genre } from "./store.js";

/**
 * @param {any} locals
 */
export async function meta(locals = null) {
	var raw = {};
	raw.album = JSON.stringify(await album.get()).length;
	raw.artist = JSON.stringify(await artist.get()).length;
	raw.genre = JSON.stringify(await genre.get()).length;

	if (locals) {
		raw.lang = bucketAvailable.join();
		locals.raw = raw;
	} else {
		raw.lang = bucketAvailable;
	}
	return raw;
}
