/**
 * Generated artwork. The catalog has no images, so album covers and artist
 * pictures are drawn from catalog data. Every choice is deterministic, so an
 * album or artist looks the same on every device and every visit.
 *
 * Album cover
 *   shade    grey tone from the album id
 *   pattern  from the genre: rings (gospel, hymn, worship), weave (tribal,
 *            folk, ethnic, classical), grooves (everything else)
 *   strip    one bar per song along the bottom, height = song length;
 *            the playing song is lit
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

const LANG_CODE = { zola: "ZO", myanmar: "MY", mizo: "MZ", falam: "FA", haka: "HK", english: "EN", chin: "CH", korea: "KO", norwegian: "NO" };
export const langCode = (lang) => LANG_CODE[lang.name] ?? lang.name.slice(0, 2).toUpperCase();

const STRIP_MAX = 40;
const stripCache = new Map();

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
	if (!label) return html`<div class="cover p-${patternOf(album)} small" style="${style}" aria-hidden="true"><div class="c-in"><i class="mark"></i></div></div>`;
	const strip = stripOf(album).map((h, i) => `<i style="--h:${h}%"${i === current ? ' class="on"' : ""}></i>`).join("");
	// The content sits in an inner box so its sizes (cqi) follow the cover's own width.
	return html`<div class="cover p-${patternOf(album)}" style="${style}" aria-hidden="true"><div class="c-in">
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

/* ---------- cover as an image (lock screen, media keys) ---------- */

/**
 * Draws the cover on a canvas and returns it as a data URL, for Media
 * Session artwork (lock screen, media keys). A data URL rather than a blob
 * URL, since the operating system loads artwork outside the page.
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
	bars.forEach((h, i) => {
		g.fillStyle = i === current ? accent : "rgb(255 255 255 / 0.5)";
		const bh = (h / 100) * 12 * s;
		g.fillRect(8 * s + i * (bw + gap), 92 * s - bh, bw, bh);
	});
	return canvas.toDataURL("image/png");
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
