import core from "lethil";

/**
 * @typedef {Object} TypeOfBucket - {{id:string,dir:string,raw:Array<string>,meta:any,track:any,task:Array<any>}[]}
 * @property {string} id - unique id
 * @property {string} dir - directory
 * @property {string[]} raw
 * @property {any} meta
 * @property {TypeOfBucketTrack[]} track
 * @property {[]} task - temporary
 *
 * @typedef {Object} TypeOfBucketTrack
 * @property {string} file
 * @property {string} title
 * @property {any[]} artist - possibly Array<string>
 * @property {any[]} albumartist - possibly Array<string>
 * @property {string} album
 * @property {any[]} genre - ["alternative"]
 * @property {any} track - "1" track number
 * @property {any} [year] - "1981"
 * @property {string} duration - time
 * @property {number} [id] - temporary
 * @property {number} [plays] - temporary
 * @property {number} [lang] - temporary
 *
 * @typedef {Object} TypeOfAlbum
 * @property {string} ui
 * @property {string} ab
 * @property {number[]} gr
 * @property {number[]} yr
 * @property {number} lg
 * @property {TypeOfAlbumTrack[]} tk
 *
 * @typedef {Object} TypeOfAlbumTrack
 * @property {number} i - id
 * @property {string} t - title
 * @property {number[]} a - artists
 * @property {number} d - duration
 * @property {number} p - plays
 *
 * @typedef {Object} TypeOfArtist
 * @property {string} name,
 * @property {string[]} correction,
 * @property {string[]} thesaurus
 * @property {string} [aka] - also known as
 * @property {number} type - Gender [unknow:0 various:1 male:2 female:3 duet:4]
 * @property {number} [i]
 * @property {number} [t]
 * @property {number} [a]
 * @property {number} [d]
 * @property {number} [p]
 * @property {number[]} [l]
 *
 * @typedef {Object} TypeOfGenre - NameOfGenre
 * @property {string} name,
 * @property {string[]} correction,
 * @property {string[]} thesaurus
 *
 * @typedef {Object} TypeOfArtistName - NameOfArtist
 * @property {string} name,
 * @property {string[]} correction,
 * @property {string[]} thesaurus
 *
 * @typedef {Object} TypeOfAlbumName - Correction NameOfAlbum
 * @property {string} name
 * @property {string[]} correction
 *
 * @typedef {Object} TypeOfTrackName - Correction NameOfTrack
 * @property {string} name
 * @property {string[]} correction
 */

export const fileName = {
	album: "store/album.json",
	artist: "store/artist.json",
	genre: "store/genre.json",
	// title:'store/track.name.json',
	trackName: "store/track.name.json",
	albumName: "store/album.name.json",
	artistName: "store/artist.name.json",
	bucket: "store/bucket.?.json",
};

export const bucketAvailable = [
	"untitle", //0
	"zola", // 1
	"myanmar", // 2
	"mizo", // 3
	"falam", // 4
	"haka", // 5
	"english", // 6
	"chin", // 7
	"korea", // 8
	"norwegian", // 9
	"collection", // 10
];

export const template = {
	/**
	 * @type {TypeOfBucket}
	 */
	bucket: { id: "", dir: "", raw: [], meta: {}, track: [], task: [] },
	/**
	 * @type {TypeOfBucketTrack}
	 */
	bucketTrack: {
		file: "",
		title: "",
		artist: [],
		albumartist: [],
		album: "",
		genre: [],
		track: 0,
		year: "0",
		duration: "",
	},
	/**
	 * @type {TypeOfAlbum}
	 */
	album: { ui: "", ab: "", gr: [], yr: [], lg: 0, tk: [] },
	// albumTrack:{i:'?', t:'?', a:[], n: 0, d: "?", p: 1, s:0}
	/**
	 * @type {TypeOfAlbumTrack}
	 */
	albumTrack: { i: 0, t: "", a: [], d: 0, p: 1 },
};

export const config = core.config.merge({
	name: "Zaideih",
	// description: 'package.description',
	// version: 'package.version',
	locale: [
		{ id: "en", name: "English", default: true },
		// {id:'no',name:'Norwegian'},
		// {id:'my',name:'Myanmar'},
		// {id:'zo',name:'Zolai'}
	],
	/**
	 * custom
	 */
	table: {
		trackView: "_track",
		trackFile: "file",
	},
	bucketAvailable: bucketAvailable,
	// titleTrack titleAlbum album.title album.track album.name album.track track.name album.name name.track name.album
	store: fileName,
	// context:{
	//   album:[],
	//   artist:[],
	//   genre:[],
	//   title:[],
	//   trackName:[],
	//   albumName:[],
	//   bucket:[]
	// },
	bucketActive: null,
	template: template,
});

// to get latest merge, config must be used
export default config;
