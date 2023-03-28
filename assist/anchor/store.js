import path from "path";
// import fs from 'fs';
import { seek } from "lethil";
import * as env from "./env.js";

const { config, bucketAvailable } = env;

/**
 * @param {string} file
 */
export async function read(file) {
	return seek
		.read(file)
		.then((o) => JSON.parse(o.toString()))
		.catch(() => new Array());
}

/**
 * @param {string} file
 * @param {any} raw
 * @param {any} reps
 */
export async function write(file, raw, reps = null, spac = 2) {
	return seek.write(file, JSON.stringify(raw, reps, spac));
}

export const bucket = {
	/**
	 * @type {env.TypeOfBucket[]}
	 */
	data: [],
	/**
	 * current working bucket id
	 */
	id: "",
	tmp: "tmp?",
	/**
	 * @type {string?}
	 */
	invalid: null,
	active: () =>
		bucket.id && bucketAvailable.includes(bucket.id) ? bucket.id : null,
	check: () =>
		(bucket.invalid = bucket.active()
			? null
			: `no such "${bucket.id}" bucket exists`),
	file: () =>
		path
			.join(config.media, config.store.bucket)
			.replace("?", bucket.active() || bucket.tmp),
	get: () => read(bucket.file()),
	read: () =>
		bucket
			.get()
			.then((o) => Object.assign(bucket.data, o))
			.catch(() => (bucket.data = [])),
	write: () => write(bucket.file(), bucket.data),
	also: {},
};

export const album = {
	/**
	 * @type {env.TypeOfAlbum[]}
	 */
	data: [],
	// file: path.join(config.media, config.store.album),
	get file() {
		return path.join(config.media, config.store.album);
	},
	get: () => read(album.file),
	read: () =>
		album
			.get()
			.then((o) => Object.assign(album.data, o))
			.catch(() => (album.data = [])),
	write: () => write(album.file, album.data, null, 2),
	also: {
		name: {
			/**
			 * @type {env.TypeOfAlbumName[]}
			 */
			data: [],
			file: path.join(config.media, config.store.albumName),
			read: () =>
				read(album.also.name.file)
					.then((o) => Object.assign(album.also.name.data, o))
					.catch(() => (album.also.name.data = [])),
		},
	},
};

export const artist = {
	/**
	 * @type {env.TypeOfArtist[]}
	 */
	data: [],
	get file() {
		return path.join(config.media, config.store.artist);
	},
	get: () => read(artist.file),
	read: () =>
		artist
			.get()
			.then((o) => Object.assign(artist.data, o))
			.catch(() => (artist.data = [])),
	write: () => write(artist.file, artist.data, null, 2),
	// also: {},
	also: {
		name: {
			/**
			 * @type {env.TypeOfArtistName[]}
			 */
			data: [],
			file: path.join(config.media, config.store.artistName),
			read: () =>
				read(artist.also.name.file)
					.then((o) => Object.assign(artist.also.name.data, o))
					.catch(() => (artist.also.name.data = [])),
		},
	},
};

export const genre = {
	/**
	 * @type {env.TypeOfGenre[]}
	 */
	data: [],
	// file: path.join(config.media, config.store.genre),
	get file() {
		return path.join(config.media, config.store.genre);
	},
	get: () => read(genre.file),
	read: () =>
		genre
			.get()
			.then((o) => Object.assign(genre.data, o))
			.catch(() => (genre.data = [])),
	write: () => write(genre.file, genre.data, null, 2),
	also: {},
};

export const track = {
	also: {
		name: {
			/**
			 * @type {env.TypeOfTrackName[]}
			 */
			data: [],
			// file: path.join(config.media, config.store.trackName),
			get file() {
				return path.join(config.media, config.store.trackName);
			},
			read: () =>
				read(track.also.name.file)
					.then((o) => Object.assign(track.also.name.data, o))
					.catch(() => (track.also.name.data = [])),
		},
	},
};
