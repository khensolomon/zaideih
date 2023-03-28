import path from "path";
import { env, store, db } from "../anchor/index.js";

const { template, bucketAvailable } = env;

/**
 * Track meta and its plays count update for production,
 * see documentation [register](./command.md)
 * @param {any} req
 * @example
 * register-bucketName/albumId?
 * register-[bucket]/[albumID(optional)]
 * node run register-zola
 * node run register-myanmar
 * node run register-mizo
 * node run register-falam
 * node run register-zola/617119a809b161d81cee
 */
export async function individual(req) {
	var albumId = req.params.albumId;

	store.bucket.id = req.params.bucketName;
	store.bucket.check();

	if (store.bucket.invalid) return store.bucket.invalid;

	await store.bucket.read();
	const taskBucket = store.bucket.data.filter(
		(e) => (albumId && albumId == e.id) || (e.track.length && !albumId)
	);

	await store.album.also.name.read();
	await store.album.read();
	await store.track.also.name.read();
	await store.artist.read();
	await store.genre.read();

	var select = await db.selectTrackAll();

	for (const album of taskBucket) {
		var update = 0,
			insert = 0;
		// NOTE: music/zola/...
		var dirAlbum = album.dir.split("/");
		dirAlbum.shift();
		const langName = dirAlbum.shift();
		const langId = bucketAvailable.findIndex(
			(e) => e == langName?.toLowerCase()
		);

		// dirAlbum = dirAlbum.join('/');
		// console.log(">", album.id, langId, album.dir);
		console.log(">", "uid:", album.id, "lang:", langId, "dir:", album.dir);

		for (const track of album.track) {
			// var dir = [album.dir,track.file].join('/');
			// var dir = path.join(album.dir,track.file);
			// var dir = path.join(album.dir,track.file).replace(/\\/g,"/");
			// var dir = album.dir+'/'+track.file;
			var dir = dirAlbum.join("/") + "/" + track.file;
			track.lang = langId;
			if (!track.title) {
				track.title = path.parse(track.file).name;
			}
			if (!track.artist.length && album.meta.artist) {
				track.artist = album.meta.artist.split(/(?:,|;)+/);
			}
			if (!track.genre.length && album.meta.genre) {
				track.genre = album.meta.genre.split(/(?:,|;)+/);
			}
			if (!track.album && album.meta.album) {
				track.album = album.meta.album;
			}
			if (!track.year && album.meta.year) {
				track.year = album.meta.year;
			}
			track.track = parseInt(track.track || 0);

			track.artist = await indexArtists(track.artist);
			track.genre = await indexGenres(track.genre);

			var row = select.find(
				(e) => e.uid == album.id && e.lang == langId && e.dir == dir
			);
			if (row) {
				update++;
				track.id = row.id;
				track.plays = row.plays;
				// track.status=row.status;
			} else {
				insert++;
				var raw = await db.insertTrack(album.id, langId, dir);
				track.id = raw.insertId;
				track.plays = 0;
				// track.status=0;
			}
		}

		var status = album.track.length == update + insert;
		console.log(
			" >",
			"total:",
			album.track.length,
			"inserted:",
			insert,
			"updated:",
			update,
			"status:",
			status
		);
	}

	try {
		await taskAlbum(taskBucket);
		await store.artist.write();
		await store.genre.write();
		await store.album.write();
	} catch (error) {
		console.log("??", error);
	}

	return taskBucket.length ? "done" : "nothing todo";
}

/**
 * @param {env.TypeOfBucket[]} taskBucket
 */
async function taskAlbum(taskBucket) {
	for (const album of taskBucket) {
		if (album.track.length) {
			var albumTemplate = Object.assign({}, template.album);
			// album:{ui:'?', ab:'?', gr:[], yr:[], lg:0, tk:[]},
			albumTemplate.ui = album.id;
			albumTemplate.ab = await albumNameCollection(album.track[0].album);

			const albumGenre = album.track
				.map(function (e) {
					return e.genre.filter((e) => e);
				})
				.reduce((prev, next) => prev.concat(next), []);
			albumTemplate.gr = [...new Set(albumGenre)]
				.sort()
				.map((e) => parseInt(e));

			/**
			 * @type {string[]}
			 */
			const albumYear = album.track
				.map((row) => row.year)
				.filter(function (e) {
					return e;
				})
				.reduce((prev, next) => prev.concat(next), []);

			// var albumYearUnique = albumYear.filter(
			// 	(value, index, array) => array.indexOf(value) === index
			// );

			albumTemplate.yr = [...new Set(albumYear)].sort().map((e) => parseInt(e));

			albumTemplate.lg = album.track[0].lang || 0;
			// var albumLanguage = album.track.map(row => row.language).reduce((prev, next) => prev.concat(next),[])
			// albumTemplate.lg = [...new Set(albumLanguage)].sort();

			// var albumPlays = album.track.map(row => row.plays).reduce((prev, next) => prev.concat(next),[])
			// albumTemplate.p = albumPlays.reduce((total,num)=> total+num);

			albumTemplate.tk = [];
			album.track.sort((a, b) => (a.track > b.track ? 1 : -1));
			// album.track.sort((a, b) => a.track - b.track);
			for (const track of album.track) {
				var trackTemplate = Object.assign({}, template.albumTrack);
				// albumTrack:{i:'?', t:'?', a:[], n: 0, d: "?", p: 1, s:0}
				trackTemplate.i = track.id || 0;
				trackTemplate.t = await trackNameCollection(track.title);
				trackTemplate.a = track.artist;
				// trackTemplate.n=track.track;
				// trackTemplate.n=parseInt(track.track||0);
				try {
					trackTemplate.d = convert2Seconds(track.duration);
				} catch (error) {
					trackTemplate.d = 0;
					console.log("convert2Seconds", album.id, track.id, track.duration);
				}
				// trackTemplate.d = convert2Seconds(track.duration);
				trackTemplate.p = track.plays || 1;
				// trackTemplate.s=track.status;
				albumTemplate.tk.push(trackTemplate);
			}

			var index = store.album.data.findIndex((e) => e.ui == album.id);
			if (index >= 0) {
				// console.log(' json:',album.id,'-> updated')
				store.album.data[index] = albumTemplate;
			} else {
				// console.log(' json:',album.id,'-> inserted')
				store.album.data.push(albumTemplate);
			}
		}
	}
}

/**
 * @param {*} i
 */
async function albumNameCollection(i) {
	var name = i.trim().replace(/ {1,}/g, " ");
	var nlc = name.toLowerCase();
	var nwd = nlc.includes(".") ? nlc.replace(/\./g, "") : null;

	var index = store.album.also.name.data.find(
		(e) =>
			e.correction.find((s) => s.toLowerCase() == nlc) ||
			(nwd && e.correction.includes(nwd)) ||
			e.name.toLowerCase() == name.toLowerCase()
	);
	if (index) {
		return index.name;
	}
	return name;
}

/**
 * @param {*} i
 */
async function trackNameCollection(i) {
	var name = i.trim().replace(/ {1,}/g, " ");
	var nlc = name.toLowerCase();
	var nwd = nlc.includes(".") ? nlc.replace(/\./g, "") : null;

	var index = store.track.also.name.data.find(
		(e) =>
			e.correction.find((s) => s.toLowerCase() == nlc) ||
			(nwd && e.correction.includes(nwd)) ||
			e.name.toLowerCase() == name.toLowerCase()
	);
	if (index) {
		return index.name;
	}
	return name;
}

/**
 * @param {any[]} artists
 */
async function indexArtists(artists) {
	var result = artists.map((i) => {
		if (typeof i == "number") {
			return i;
		}
		var name = i.trim().replace(/ {1,}/g, " ");
		var nlc = name.toLowerCase();
		var nwd = nlc.includes(".") ? nlc.replace(/\./g, "") : null;

		// store.artist.data;

		// var index = store.artist.data.findIndex(
		//   e=>e.thesaurus.find(s=> s.toLowerCase() == nlc ) || nwd && e.thesaurus.includes(nwd) || e.name.toLowerCase() == name.toLowerCase() || e.aka && e.aka == name
		//   // e=>e.thesaurus.includes(nlc) || nwd && e.thesaurus.includes(nwd) || e.name.toLowerCase() == name.toLowerCase() || e.aka && e.aka == name
		// );
		var index = store.artist.data.findIndex(
			(e) =>
				e.name.toLowerCase() == name.toLowerCase() ||
				(e.aka && e.aka == name) ||
				e.correction.find(
					(s) => s.toLowerCase() == nlc || (nwd && s.toLowerCase() == nwd)
				) ||
				e.thesaurus.find(
					(s) => s.toLowerCase() == nlc || (nwd && s.toLowerCase() == nwd)
				)
		);
		if (index < 0) {
			var correction = [];
			if (nwd) {
				correction.push(nwd);
			}
			store.artist.data.push({
				name: name,
				correction: correction,
				thesaurus: [],
				type: 0,
			});
			index = store.artist.data.length - 1;
		}
		return index;
	});
	return [...new Set(result)];
}

/**
 * @param {any[]} genres
 */
async function indexGenres(genres) {
	if (genres.length == 0) {
		return [0];
	}
	var result = genres.map((i) => {
		if (typeof i == "number") {
			return i;
		}
		var name = i.trim().replace(/ {1,}/g, " ");
		var nlc = name.toLowerCase();
		var nwd = nlc.includes(".") ? nlc.replace(/\./g, "") : null;

		var index = store.genre.data.findIndex(
			// e=>e.correction.find(s=> s.toLowerCase() == nlc ) || nwd && e.correction.includes(nwd) || e.name.toLowerCase() == name.toLowerCase()
			(e) =>
				e.name.toLowerCase() == name.toLowerCase() ||
				e.correction.find(
					(s) => s.toLowerCase() == nlc || (nwd && s.toLowerCase() == nwd)
				) ||
				e.thesaurus.find(
					(s) => s.toLowerCase() == nlc || (nwd && s.toLowerCase() == nwd)
				)
		);
		if (index < 0) {
			var correction = [];
			if (nwd) {
				correction.push(nwd);
			}
			store.genre.data.push({
				name: name,
				correction: correction,
				thesaurus: [],
			});
			index = store.genre.data.length - 1;
		}
		return index;
	});
	return [...new Set(result)];
}

/**
 * eg. (HH:MM:SS) 3:23 to 203
 * @param {any} time
 */
function convert2Seconds(time) {
	if (typeof time == "number") {
		return time;
	}
	// @ts-ignore
	var ab = time.split(":").reduce((a, b) => 60 * a + +b);
	return ab ? parseInt(ab) : 0;
}

/**
 * All from bucketAvailable
 * @param {any} req
 * @example
 * node run register-all
 */
export async function all(req) {
	for (let index = 0; index < bucketAvailable.length; index++) {
		const element = bucketAvailable[index];
		try {
			await individual({ params: { bucketName: element } });
		} catch (error) {
			console.log("all", element, error);
		}
	}
	return "done";
}

export default individual;
