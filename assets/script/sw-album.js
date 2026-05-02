// This Web Worker runs in a separate background thread, preventing UI freezing.
//
// What it does:
//   1. Walks all albums + their tracks
//   2. Aggregates per-artist totals (plays, track count, languages used)
//   3. Computes per-album total plays
//   4. Normalizes album.yr — dedupes and sorts ascending
//   5. Sorts albums by total plays (desc)
//   6. Adds precomputed fields used by artist-index.vue:
//        - fl  first-letter alphabet bucket
//        - ck  color key (0-8) for deterministic avatar color
//   7. Sends everything back to the main thread

self.onmessage = function (e) {
	const { albums, artists, metaLangs } = e.data;

	let totalTracks = 0;

	const langsMap = new Map();
	const artistMap = new Map();

	for (let i = 0; i < artists.length; i++) {
		const artist = artists[i];
		artist.plays = 0;
		artist.track = 0;
		artist._langSet = new Set();
		artistMap.set(artist.id, artist);
	}

	for (let i = 0; i < albums.length; i++) {
		const album = albums[i];
		let albumTotalPlays = 0;
		const albumLang = album.lg;

		// Normalize album.yr: dedupe + sort. The source data sometimes has
		// repeats like [2000, 2000, 2000, 2017] (probably from re-releases
		// or pressing variants). Cleaning it once here means every view
		// (album.vue, album-raw.vue, album-row.vue, artist.vue) renders
		// clean year lists without further work.
		if (Array.isArray(album.yr)) {
			album.yr = [...new Set(album.yr.filter(Number))].sort();
		} else if (album.yr) {
			album.yr = [album.yr];
		} else {
			album.yr = [];
		}

		if (!langsMap.has(albumLang)) {
			langsMap.set(albumLang, {
				id: albumLang,
				name: metaLangs[albumLang],
			});
		}

		for (let j = 0; j < album.tk.length; j++) {
			const track = album.tk[j];
			const trackPlays = parseInt(track.p) || 0;
			totalTracks++;

			for (let k = 0; k < track.a.length; k++) {
				const artistId = track.a[k];
				const artist = artistMap.get(artistId);

				if (artist) {
					artist.plays += trackPlays;
					artist.track++;
					artist._langSet.add(albumLang);
				}
			}

			albumTotalPlays += trackPlays;
		}
		album.tp = albumTotalPlays;
	}

	albums.sort((a, b) => (a.tp < b.tp ? 1 : -1));

	// Cleanup temporary Sets and add precomputed fields.
	const finalArtists = [];
	for (const artist of artistMap.values()) {
		artist.l = Array.from(artist._langSet);
		delete artist._langSet;

		// fl: alphabet bucket. Drops common articles, uppercases first
		// Latin letter, falls back to "#" for non-Latin / digits / symbols.
		const name = artist.name || "";
		const cleaned = name
			.trim()
			.replace(/^(the|a|an|le|la|el|der|die|das)\s+/i, "");
		const first = cleaned.charAt(0).toUpperCase();
		artist.fl = /^[A-Z]$/.test(first) ? first : "#";

		// ck: color key 0-8, deterministic from id.
		artist.ck = Math.abs(artist.id | 0) % 9;

		finalArtists.push(artist);
	}

	self.postMessage({
		albums,
		artists: finalArtists,
		langs: Array.from(langsMap.values()),
		totalTracks,
	});
};
