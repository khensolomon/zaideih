// This Web Worker runs in a separate background thread, preventing UI freezing.
self.onmessage = function (e) {
	const { albums, artists, metaLangs } = e.data;

	let totalTracks = 0;

	// Optimization 1: Index Languages using a Map for O(1) instant lookups
	const langsMap = new Map();

	// Optimization 2: Index Artists using a Map for O(1) lookups.
	// We also initialize a temporary Set for each artist's languages to avoid slow O(n) .indexOf() checks.
	const artistMap = new Map();
	for (let i = 0; i < artists.length; i++) {
		const artist = artists[i];
		artist.plays = 0;
		artist.track = 0;
		artist._langSet = new Set(); // Temporary set for insanely fast indexing
		artistMap.set(artist.id, artist);
	}

	// Process albums with standard 'for' loops (faster than forEach/map)
	for (let i = 0; i < albums.length; i++) {
		const album = albums[i];
		let albumTotalPlays = 0;
		const albumLang = album.lg;

		// Index Language
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

			// Process Artists mapping
			for (let k = 0; k < track.a.length; k++) {
				const artistId = track.a[k];
				const artist = artistMap.get(artistId);

				if (artist) {
					artist.plays += trackPlays;
					artist.track++;
					// O(1) instant insertion instead of O(n) array lookup
					artist._langSet.add(albumLang);
				}
			}
			
			// Compute total plays here to completely eliminate the need for a separate .reduce() loop
			albumTotalPlays += trackPlays;
		}
		album.tp = albumTotalPlays;
	}

	// Sort albums by total plays (descending) entirely in the background thread
	albums.sort((a, b) => (a.tp < b.tp ? 1 : -1));

	// Cleanup temporary Sets and prepare final arrays to send back
	const finalArtists = [];
	for (const artist of artistMap.values()) {
		artist.l = Array.from(artist._langSet); // Convert Set back to Array
		delete artist._langSet; // Remove temporary property
		finalArtists.push(artist);
	}

	// Send back the fully processed and indexed data to the main thread
	self.postMessage({
		albums,
		artists: finalArtists,
		langs: Array.from(langsMap.values()),
		totalTracks,
	});
};