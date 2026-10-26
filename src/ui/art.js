/**
 * Generated artwork. The catalog has no images, so album covers and artist
 * pictures are drawn from catalog data. Every choice is deterministic, so an
 * album or artist looks the same on every device and every visit.
 *
 * Album cover
 *   shade    grey tone from the album id
 *   pattern  faint texture from the genre: rings (gospel, hymn, worship),
 *            weave (tribal, folk, ethnic, classical), grooves (otherwise)
 *   motif    who sings it, drawn in the upper right (albumShape):
 *              solo     a record: one ring, with one band per song inside
 *                       (width = song length, brighter = more played)
 *              duet     two overlapping rings, the overlap lit
 *              various  a ring of dots, one per artist, sized by songs
 *              single   (3 songs or fewer) a record with a large label
 *            the motif's size follows the album's length (up to an hour)
 *            ring lines follow the artist type, as on artist pictures:
 *            plain (male), with a bead (female), dotted (group or various),
 *            hairline (unknown)
 *   echoes   popularity: faint rings around the motif, one more for each
 *            half order of magnitude of plays from 100 (up to five); the
 *            most played albums (10,000 plays or more) draw the motif in
 *            the accent colour
 *   strip    one bar per song along the bottom, height = song length,
 *            brightness = the song's plays; the playing song is lit
 *
 * Artist picture (a sunburst of the artist's career)
 *   rays     one per year from the first to the last release, clockwise
 *            from the top; length = songs that year, brightness = plays
 *            that year; the most played year uses the accent colour
 *   centre   grows with total plays
 *   rings    album count: one ring for one album, one more each time the
 *            count doubles, up to six
 *   ray ends artist type: plain (male), dot (female), dotted (group or
 *            various artists), outline (unknown)
 */
import { escape, html, raw } from "../core/html.js";
import { hash32 } from "../core/text.js";

const MYANMAR = /[က-႟]/;
const isMyanmar = (s) => MYANMAR.test(s);

/* ---------- album covers ---------- */

const RINGS = new Set(["gospel", "hymn", "praise", "worship", "praise & worship", "contemporary christian", "religion", "christian rock"]);
const WEAVE = new Set(["tribal", "folk", "ethnic", "classical", "instrumental"]);

export function patternOf(album) {
	const names = album.genres.map((g) => g.name.toLowerCase());
	if (names.some((n) => RINGS.has(n))) return "rings";
	if (names.some((n) => WEAVE.has(n))) return "weave";
	return "grooves";
}

/** Grey lightness (percent) for an album or artist id. */
export const shadeOf = (id) => 30 + (hash32(String(id)) % 17);

const LANG_CODE = { uploads: "YOURS", zola: "ZO", myanmar: "MY", mizo: "MZ", falam: "FA", haka: "HK", english: "EN", chin: "CH", korea: "KO", norwegian: "NO" };
export const langCode = (lang) => LANG_CODE[lang.name] ?? lang.name.slice(0, 2).toUpperCase();

const STRIP_MAX = 40;
const stripCache = new Map();

/** Bar brightness (0.3–0.85) for the song strip, by each song's plays. */
export function stripLightOf(album) {
	const plays = album.tracks.slice(0, STRIP_MAX).map((t) => t.plays || 0);
	const max = Math.max(1, ...plays);
	return plays.map((p) => Number((0.3 + 0.55 * Math.sqrt(p / max)).toFixed(2)));
}

/**
 * Who sings the album, from the song credits: "single" (3 songs or fewer),
 * "duet" (most songs credited to two artists together, or two artists
 * sharing the album), "various" (many artists, none with half the songs, or
 * the Various Artists credit), otherwise "solo". `artists` are the main
 * artists with their share of the songs, most credited first.
 */
export function albumShape(album) {
	const n = album.tracks.length;
	const count = new Map();
	let joint = 0;
	for (const t of album.tracks) {
		const list = t.artists ?? [];
		if (list.length === 2) joint += 1;
		for (const a of list) if (a) count.set(a, (count.get(a) ?? 0) + 1);
	}
	const ranked = [...count].sort((x, y) => y[1] - x[1]).map(([artist, songs]) => ({ artist, share: n ? songs / n : 0 }));
	const top = ranked[0];
	const second = ranked[1];
	let kind = "solo";
	if (n <= 3) kind = "single";
	else if (top?.artist.id === 1) kind = "various";
	else if (joint >= n / 2 || (second && second.share >= 0.3 && top.share < 0.7)) kind = "duet";
	else if (ranked.length >= 4 && top.share < 0.5) kind = "various";
	return { kind, artists: ranked };
}

/** Popularity rings around the motif: 0 below 100 plays, one more per half order of magnitude, up to five. */
export function echoesOf(plays) {
	if (plays < 100) return 0;
	return Math.min(5, 1 + Math.floor((Math.log10(plays) - 2) * 2 + 1e-6));
}
export const ALBUM_TOP_PLAYS = 10_000;

/** A ring in the artist type's line style (same vocabulary as artist pictures). */
function typedRing(cx, cy, r, type, { op = 0.3, accent = false, width = 1.1 } = {}) {
	const paint = accent ? `stroke="currentColor" stroke-opacity="${Math.min(1, op + 0.35)}"` : `stroke="#fff" stroke-opacity="${op}"`;
	if (type === 0) return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" ${paint} stroke-width="${f(width * 0.45)}"/>`;
	if (type === 1) return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" ${paint} stroke-width="${f(width * 1.3)}" stroke-linecap="round" stroke-dasharray="0 ${f(width * 2.6)}"/>`;
	const ring = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" ${paint} stroke-width="${f(width)}"/>`;
	if (type !== 3) return ring;
	// Female: a bead on the ring, at the lower left, towards the title.
	const a = (135 * Math.PI) / 180;
	const fill = accent ? `fill="currentColor"` : `fill="#fff" fill-opacity="${Math.min(1, op + 0.25)}"`;
	return `${ring}<circle cx="${f(cx + r * Math.cos(a))}" cy="${f(cy + r * Math.sin(a))}" r="${f(width * 2)}" ${fill}/>`;
}

const motifCache = new Map();

/** The motif and echoes as SVG elements in a 100×100 box. */
export function albumMotif(album) {
	let out = motifCache.get(album.id);
	if (out !== undefined) return out;
	const { kind, artists } = albumShape(album);
	// Placement varies a little per album; size follows the album's length (up to an hour).
	const h = hash32(`m${album.id}`);
	const cx = 60 + (h % 13), cy = 32 + ((h >>> 4) % 11);
	const R = 15 + 9 * Math.min(1, (album.duration || 0) / 3600);
	const accent = album.plays >= ALBUM_TOP_PLAYS;
	const typeOf = (i) => artists[i]?.artist.type ?? 0;
	const parts = [];
	const echoes = echoesOf(album.plays);
	const outer = kind === "duet" ? R * 1.25 : R;
	for (let i = 1; i <= echoes; i++) {
		parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(outer + i * 4.6)}" fill="none" stroke="#fff" stroke-opacity="${f(0.2 - i * 0.025)}" stroke-width="0.7"/>`);
	}
	// Songs as the bands of a record: one boundary per song, band width = song length, brighter = more played.
	const grooves = (x, y, rOut, rIn) => {
		const list = album.tracks.slice(0, STRIP_MAX);
		const total = list.reduce((sum, t) => sum + (t.duration || 1), 0) || 1;
		const maxP = Math.max(1, ...list.map((t) => t.plays || 0));
		let acc = 0;
		list.slice(0, -1).forEach((t) => {
			acc += t.duration || 1;
			const r = rIn + (rOut - rIn) * (acc / total);
			parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="#fff" stroke-opacity="${f(0.06 + 0.16 * Math.sqrt((t.plays || 0) / maxP))}" stroke-width="0.45"/>`);
		});
	};
	if (kind === "single") {
		grooves(cx, cy, R, R * 0.58);
		parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(R * 0.55)}" fill="#fff" fill-opacity="${accent ? 0.2 : 0.11}"/>`);
		parts.push(typedRing(cx, cy, R, typeOf(0), { op: 0.32, accent, width: 1.6 }));
		parts.push(`<circle cx="${cx}" cy="${cy}" r="1.4" fill="#fff" fill-opacity="0.45"/>`);
	} else if (kind === "duet") {
		const d = R * 0.5, r = R * 0.8;
		// The overlap of the two rings, lit: two voices together.
		parts.push(`<clipPath id="lens-${album.id}"><circle cx="${f(cx - d)}" cy="${cy}" r="${f(r)}"/></clipPath>`);
		parts.push(`<circle cx="${f(cx + d)}" cy="${cy}" r="${f(r)}" fill="${accent ? "currentColor" : "#fff"}" fill-opacity="${accent ? 0.22 : 0.12}" clip-path="url(#lens-${album.id})"/>`);
		parts.push(typedRing(cx - d, cy, r, typeOf(0), { op: 0.34, accent, width: 1.2 }));
		parts.push(typedRing(cx + d, cy, r, typeOf(1), { op: 0.34, accent, width: 1.2 }));
	} else if (kind === "various") {
		const shown = artists.slice(0, 12);
		parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#fff" stroke-opacity="0.14" stroke-width="0.6"/>`);
		const maxShare = Math.max(0.01, ...shown.map((a) => a.share));
		shown.forEach((a, i) => {
			const ang = ((-90 + (360 * i) / shown.length) * Math.PI) / 180;
			const r = 1.6 + 4.2 * Math.sqrt(a.share / maxShare);
			const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
			const fill = accent && i === 0 ? `fill="currentColor"` : `fill="#fff" fill-opacity="${f(0.16 + 0.2 * (a.share / maxShare))}"`;
			parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" ${fill}/>`);
		});
	} else {
		grooves(cx, cy, R, R * 0.3);
		parts.push(typedRing(cx, cy, R, typeOf(0), { op: 0.36, accent, width: 1.3 }));
		parts.push(`<circle cx="${cx}" cy="${cy}" r="${f(R * 0.22)}" fill="#fff" fill-opacity="0.12"/>`);
	}
	out = parts.join("");
	motifCache.set(album.id, out);
	return out;
}

/** Bar heights (percent) for the song strip, one per song, longest = 100. */
export function stripOf(album) {
	let bars = stripCache.get(album.id);
	if (!bars) {
		const durations = album.tracks.slice(0, STRIP_MAX).map((t) => t.duration || 0);
		const max = Math.max(1, ...durations);
		bars = durations.map((d) => Math.round(25 + (75 * d) / max));
		stripCache.set(album.id, bars);
	}
	return bars;
}

/**
 * Cover markup. `label: false` gives the small variant (pattern and mark
 * only) used in lists and the player. `current` lights that song's bar.
 */
export function coverArt(album, { label = true, current = -1, titleHtml = album.title, titleClass = "" } = {}) {
	const style = `--g:${shadeOf(album.id)}%`;
	const art = `<svg class="c-art" viewBox="0 0 100 100" aria-hidden="true">${albumMotif(album)}</svg>`;
	if (!label) return html`<div class="cover p-${patternOf(album)} small" style="${style}" aria-hidden="true">${raw(art)}<div class="c-in"><i class="mark"></i></div></div>`;
	const light = stripLightOf(album);
	const strip = stripOf(album).map((h, i) => `<i style="--h:${h}%;--o:${light[i]}"${i === current ? ' class="on"' : ""}></i>`).join("");
	// The content sits in an inner box so its sizes (cqi) follow the cover's own width.
	return html`<div class="cover p-${patternOf(album)}" style="${style}" aria-hidden="true">${raw(art)}<div class="c-in">
		<span class="c-top"><i class="mark"></i><span>${langCode(album.lang)}</span>${album.year ? html`<span class="c-year">${album.year}</span>` : ""}</span>
		<b class="${titleClass}">${titleHtml}</b>
		<span class="strip">${raw(strip)}</span>
	</div></div>`;
}

/* ---------- artist pictures ---------- */

const LATIN = /\p{Script=Latin}/u;

/** Up to two Latin initials. Myanmar names get none: a single letter of a Burmese name does not read as the name. */
export function artistLabel(name) {
	if (isMyanmar(name) || !LATIN.test(name)) return "";
	const words = name.replace(/[^\p{L}\p{N} ]+/gu, " ").trim().split(/\s+/).filter(Boolean);
	return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/** Songs and plays per release year, from the first to the last year. */
export function careerOf(artist) {
	const years = new Map();
	for (const t of artist.tracks) {
		const y = t.album.year;
		if (!y) continue;
		const v = years.get(y) ?? [0, 0];
		v[0] += 1;
		v[1] += t.plays;
		years.set(y, v);
	}
	if (!years.size) return { from: 0, to: 0, songs: [], plays: [] };
	const list = [...years.keys()];
	const from = Math.min(...list);
	const to = Math.max(...list);
	const songs = [];
	const plays = [];
	for (let y = from; y <= to; y++) {
		const v = years.get(y) ?? [0, 0];
		songs.push(v[0]);
		plays.push(v[1]);
	}
	return { from, to, songs, plays };
}

const f = (n) => Number(n.toFixed(2));
const artCache = new Map();

/** Artist picture as an inline SVG inside a round frame. */
export function artistArt(artist) {
	let out = artCache.get(artist.id);
	if (out) return out;
	const { songs, plays } = careerOf(artist);
	const R = 50;
	// 100 plays or fewer: the smallest centre; 100,000 or more: the largest.
	const t = Math.max(0, Math.min(1, (Math.log10(Math.max(1, artist.plays)) - 2) / 3));
	const rc = R * (0.24 + 0.14 * t);
	const r0 = rc + R * 0.07;
	const L = R * 0.92 - r0;
	const n = songs.length;
	const step = 330 / Math.max(n, 12);
	const start = -step * n / 2;
	// Rays thin out on long careers so they never touch at the centre.
	const w = Math.max(0.9, Math.min(2.4, ((2 * Math.PI * r0 * step) / 360) * 0.55));
	const maxS = Math.max(1, ...songs);
	const maxP = Math.max(1, ...plays);
	const parts = [];

	const albums = artist.albums.length;
	const rings = albums ? Math.min(6, 1 + Math.floor(Math.log2(albums))) : 0;
	for (let i = 0; i < rings; i++) {
		parts.push(`<circle cx="50" cy="50" r="${f(r0 + (L * (i + 1)) / rings)}" class="ring"/>`);
	}

	const type = artist.type;
	songs.forEach((s, i) => {
		const a = ((start + step * (i + 0.5) - 90) * Math.PI) / 180;
		const cos = Math.cos(a);
		const sin = Math.sin(a);
		const len = s ? Math.max(w * 1.6, L * Math.sqrt(s / maxS)) : 2.5;
		const x1 = f(50 + r0 * cos), y1 = f(50 + r0 * sin);
		const x2 = f(50 + (r0 + len) * cos), y2 = f(50 + (r0 + len) * sin);
		if (!s) {
			parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="gap" stroke-width="${f(Math.min(w, 1.2))}"/>`);
			return;
		}
		const top = plays[i] === maxP;
		const op = top ? 1 : f(0.32 + (0.6 * plays[i]) / maxP);
		const paint = top ? `stroke="currentColor"` : `stroke="#fff" stroke-opacity="${op}"`;
		if (type === 1) {
			parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${paint} stroke-width="${f(w)}" stroke-dasharray="0 ${f(w * 2)}"/>`);
		} else if (type === 0) {
			parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${paint} stroke-width="${f(Math.max(0.7, w * 0.4))}"/>`);
		} else {
			parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${paint} stroke-width="${f(w)}"/>`);
			if (type === 3) {
				const fill = top ? `fill="currentColor"` : `fill="#fff" fill-opacity="${op}"`;
				parts.push(`<circle cx="${x2}" cy="${y2}" r="${f(w * 1.2)}" ${fill}/>`);
			}
		}
	});

	parts.push(`<circle cx="50" cy="50" r="${f(rc)}" class="core"/>`);
	const label = artistLabel(artist.name);
	if (label) parts.push(`<text x="50" y="50" font-size="${f(rc * 0.74)}">${escape(label)}</text>`);

	out = html`<span class="avatar" style="--g:${shadeOf(`a${artist.id}`)}%" aria-hidden="true"><svg viewBox="0 0 100 100">${raw(parts.join(""))}</svg></span>`;
	artCache.set(artist.id, out);
	return out;
}

/** Forgets drawn artwork, after play counts change (popularity is part of it). */
export function clearArtCaches() {
	motifCache.clear();
	artCache.clear();
}

/* ---------- cover as an image (lock screen, media keys) ---------- */

/**
 * Draws the cover on a canvas and returns it as a data URL, for Media
 * Session artwork (lock screen, media keys, car stereos). A data URL rather
 * than a blob URL, since the operating system loads artwork outside the
 * page; a JPEG (the cover is opaque), a fraction of the PNG's size, for
 * accessories that take artwork over a slow link.
 */
export async function coverImage(album, current = -1, size = 512) {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const g = canvas.getContext("2d");
	const s = size / 100;
	g.fillStyle = `hsl(0 0% ${shadeOf(album.id)}%)`;
	g.fillRect(0, 0, size, size);
	g.strokeStyle = "rgb(255 255 255 / 0.08)";
	g.lineWidth = 0.6 * s;
	const pattern = patternOf(album);
	if (pattern === "rings") {
		for (let r = 8; r < 150; r += 8) { g.beginPath(); g.arc(size, 0, r * s, 0, Math.PI * 2); g.stroke(); }
	} else if (pattern === "weave") {
		g.lineWidth = 1.2 * s;
		for (let k = -100; k < 200; k += 7) {
			g.beginPath(); g.moveTo(k * s, 0); g.lineTo((k + 100) * s, size); g.stroke();
			g.beginPath(); g.moveTo((k + 100) * s, 0); g.lineTo(k * s, size); g.stroke();
		}
	} else {
		for (let y = 4; y < 100; y += 5) { g.beginPath(); g.moveTo(0, y * s); g.lineTo(size, y * s); g.stroke(); }
	}
	const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ececec";
	try {
		const img = new Image();
		img.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" color="${accent}">${albumMotif(album)}</svg>`)}`;
		await img.decode();
		g.drawImage(img, 0, 0, size, size);
	} catch (err) {
		console.warn("the cover motif could not be drawn for the lock screen", err);
	}
	g.fillStyle = accent;
	g.fillRect(8 * s, 8 * s, 10 * s, 1.6 * s);
	g.fillStyle = "#fff";
	const font = getComputedStyle(document.body).fontFamily;
	g.font = `600 ${11 * s}px ${font}`;
	g.textBaseline = "alphabetic";
	wrapText(g, album.title, 8 * s, 62 * s, 84 * s, 12 * s, 2);
	const bars = stripOf(album);
	const gap = 0.8 * s;
	const bw = (84 * s - gap * (bars.length - 1)) / bars.length;
	const light = stripLightOf(album);
	bars.forEach((h, i) => {
		g.fillStyle = i === current ? accent : `rgb(255 255 255 / ${light[i]})`;
		const bh = (h / 100) * 12 * s;
		g.fillRect(8 * s + i * (bw + gap), 92 * s - bh, bw, bh);
	});
	return canvas.toDataURL("image/jpeg", 0.9);
}

function wrapText(g, text, x, y, maxWidth, lineHeight, maxLines) {
	// Myanmar has no spaces: break between grapheme clusters, never inside one.
	const words = isMyanmar(text)
		? (typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter("my", { granularity: "grapheme" }).segment(text)].map((p) => p.segment) : [...text])
		: text.split(" ");
	const sep = isMyanmar(text) ? "" : " ";
	const lines = [];
	let line = "";
	for (const word of words) {
		const test = line ? line + sep + word : word;
		if (g.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
	}
	if (line) lines.push(line);
	const shown = lines.slice(0, maxLines);
	if (lines.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1].replace(/.$/u, "")}…`;
	const top = y - (shown.length - 1) * lineHeight;
	shown.forEach((l, i) => g.fillText(l, x, top + i * lineHeight));
}
