/**
 * The playing song as a picture, for the lock screen, media keys, CarPlay
 * and car stereos (Media Session artwork). Many car stereos and older
 * accessories cannot show Myanmar text, and some no Unicode beyond Latin:
 * the title and artist they are sent come out unreadable. The picture is
 * drawn here, with the app's own fonts, so it carries the song's title,
 * up to four of its artists (and how many more), the album and its year,
 * readable on any screen that shows artwork.
 *
 * Drawn at once, with no waiting (no image decoding, no fonts fetched
 * while drawing): a song changed from the car happens with the page in the
 * background, where waiting can stall. The album's motif (art.js
 * albumMotif, SVG) is drawn on the canvas from its own shapes. The fonts
 * are loaded once beforehand (prepareNowArt), with the page in front.
 */
import { NOT_ARTISTS } from "../core/catalog.js";
import { albumMotif, langCode, patternOf, shadeOf, stripLightOf, stripOf } from "./art.js";

const MYANMAR = /[က-႟]/;
/** Artists named on the picture; more are counted ("+3 more"). */
export const ARTISTS_SHOWN = 4;

/* ------------------------------------------------------------ motif ---- */

const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/**
 * The shapes of a motif from albumMotif's SVG: [{ circle attributes, clip }]
 * where `clip` is the circle a clip-path names. albumMotif writes circles
 * only, and one clipPath around a circle for a duet; anything else is
 * left out rather than guessed.
 */
export function motifShapes(svg) {
	const clips = new Map();
	for (const m of svg.matchAll(/<clipPath id="([^"]+)">\s*<circle ([^>]*?)\/>\s*<\/clipPath>/g)) clips.set(m[1], attrs(m[2]));
	const out = [];
	for (const m of svg.replace(/<clipPath[\s\S]*?<\/clipPath>/g, "").matchAll(/<circle ([^>]*?)\/>/g)) {
		const a = attrs(m[1]);
		const clip = /url\(#([^)]+)\)/.exec(a["clip-path"] ?? "")?.[1];
		out.push({ ...a, clip: clip ? clips.get(clip) ?? null : null });
	}
	return out;
}

function paintOf(value, opacity, accent) {
	const alpha = opacity === undefined ? 1 : Number(opacity);
	return value === "currentColor" ? { color: accent, alpha } : { color: value, alpha };
}

/** Draws a motif's shapes into a 100×100 box scaled by `s`. */
function drawMotif(g, svg, s, accent) {
	for (const c of motifShapes(svg)) {
		g.save();
		if (c.clip) {
			g.beginPath();
			g.arc(Number(c.clip.cx) * s, Number(c.clip.cy) * s, Number(c.clip.r) * s, 0, Math.PI * 2);
			g.clip();
		}
		g.beginPath();
		g.arc(Number(c.cx) * s, Number(c.cy) * s, Number(c.r) * s, 0, Math.PI * 2);
		if (c.fill && c.fill !== "none") {
			const p = paintOf(c.fill, c["fill-opacity"], accent);
			g.globalAlpha = p.alpha;
			g.fillStyle = p.color;
			g.fill();
		}
		if (c.stroke && c.stroke !== "none") {
			const p = paintOf(c.stroke, c["stroke-opacity"], accent);
			g.globalAlpha = p.alpha;
			g.strokeStyle = p.color;
			g.lineWidth = Number(c["stroke-width"] ?? 1) * s;
			g.lineCap = c["stroke-linecap"] === "round" ? "round" : "butt";
			const dash = (c["stroke-dasharray"] ?? "").split(/[\s,]+/).filter(Boolean).map((n) => Number(n) * s);
			g.setLineDash(dash.length ? dash : []);
			g.stroke();
		}
		g.restore();
	}
}

/* ------------------------------------------------------------- text ---- */

/** The artists to name: the song's own (Unknown and Various left out), else the album's. */
export function artistsOf(track) {
	const own = track.artists.filter((a) => !NOT_ARTISTS.has(a.id));
	return own.length ? own : track.album.artists.filter((a) => !NOT_ARTISTS.has(a.id));
}

/** "Ann · Ben · Cai · Dee +3 more": up to ARTISTS_SHOWN names, the rest counted. */
export function artistLine(names, shown = ARTISTS_SHOWN) {
	if (!names.length) return "";
	const more = names.length - shown;
	return `${names.slice(0, shown).join(" · ")}${more > 0 ? ` +${more} more` : ""}`;
}

/** The lines `text` takes in `maxWidth`: words, or (Myanmar, no spaces) grapheme clusters. */
function linesOf(g, text, maxWidth) {
	const my = MYANMAR.test(text);
	const parts = my
		? (typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter("my", { granularity: "grapheme" }).segment(text)].map((p) => p.segment) : [...text])
		: text.split(" ");
	const sep = my ? "" : " ";
	const lines = [];
	let line = "";
	for (const part of parts) {
		const next = line ? line + sep + part : part;
		if (g.measureText(next).width > maxWidth && line) { lines.push(line); line = part; } else line = next;
	}
	if (line) lines.push(line);
	return lines;
}

/** At most `max` lines, the last cut with an ellipsis when there is more. */
function clamp(g, lines, max, maxWidth) {
	if (lines.length <= max) return lines;
	const out = lines.slice(0, max);
	let last = `${out[max - 1]}…`;
	while (g.measureText(last).width > maxWidth && last.length > 1) last = `${[...last.slice(0, -1)].slice(0, -1).join("")}…`;
	out[max - 1] = last;
	return out;
}

/**
 * The largest size from `sizes` at which `text` fits in `maxLines`; at the
 * smallest, cut. Answers { lines, size, lineHeight }.
 */
function fit(g, text, font, sizes, maxWidth, maxLines) {
	for (const size of sizes) {
		g.font = font(size);
		const lines = linesOf(g, text, maxWidth);
		if (lines.length <= maxLines) return { lines, size };
	}
	const size = sizes.at(-1);
	g.font = font(size);
	return { lines: clamp(g, linesOf(g, text, maxWidth), maxLines, maxWidth), size };
}

/* ------------------------------------------------------------ fonts ---- */

let fontsReady = null;

/** Loads the fonts the picture uses (Outfit, Padauk), once, with the page in front. */
export function prepareNowArt() {
	if (fontsReady || typeof document === "undefined" || !document.fonts?.load) return fontsReady;
	const family = getComputedStyle(document.body).fontFamily;
	fontsReady = Promise.all([
		document.fonts.load(`600 40px ${family}`, "Aa"),
		document.fonts.load(`500 40px ${family}`, "Aa"),
		document.fonts.load(`700 40px ${family}`, "မြန်မာ"),
		document.fonts.load(`400 40px ${family}`, "မြန်မာ"),
	]).catch((err) => console.warn("Fonts for the lock-screen picture could not be loaded; system fonts are used.", err));
	return fontsReady;
}

/* ---------------------------------------------------------- picture ---- */

/**
 * The picture of `track` playing, as a JPEG data URL, `size` pixels square:
 * the album's shade, pattern and motif above; below, the song's title as
 * large as fits in two lines, its artists, and the album with its year;
 * at the foot the album's songs as a strip, this one lit.
 */
export function nowPlayingImage(track, size = 512) {
	if (typeof document === "undefined") return null;
	const album = track.album;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const g = canvas.getContext("2d");
	const s = size / 100;
	const root = getComputedStyle(document.documentElement);
	const accent = root.getPropertyValue("--accent").trim() || "#ececec";
	const family = getComputedStyle(document.body).fontFamily;

	// The album: its shade, pattern and motif.
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
	drawMotif(g, albumMotif(album), s, accent);
	// The lower part darker, so the words read on any shade.
	const shade = g.createLinearGradient(0, 38 * s, 0, size);
	shade.addColorStop(0, "rgb(0 0 0 / 0)");
	shade.addColorStop(1, "rgb(0 0 0 / 0.5)");
	g.fillStyle = shade;
	g.fillRect(0, 38 * s, size, size);

	// The top line: a mark, the language and the year.
	g.fillStyle = accent;
	g.fillRect(8 * s, 8 * s, 10 * s, 1.6 * s);
	g.fillStyle = "rgb(255 255 255 / 0.75)";
	g.font = `600 ${4.2 * s}px ${family}`;
	g.textBaseline = "middle";
	g.fillText([langCode(album.lang), album.year].filter(Boolean).join(" · "), 21 * s, 8.9 * s);

	// From the foot up: the strip, the album, the artists, the title.
	const x = 8 * s;
	const width = 84 * s;
	const bars = stripOf(album);
	const light = stripLightOf(album);
	const gap = 0.8 * s;
	const bw = (width - gap * (bars.length - 1)) / bars.length;
	const current = album.tracks.indexOf(track);
	bars.forEach((h, i) => {
		g.fillStyle = i === current ? accent : `rgb(255 255 255 / ${light[i]})`;
		const bh = (h / 100) * 8 * s;
		g.fillRect(x + i * (bw + gap), 93 * s - bh, bw, bh);
	});
	g.textBaseline = "alphabetic";
	let y = 81 * s;
	const albumLine = album.year && album.title !== String(album.year) ? `${album.title} · ${album.year}` : album.title;
	const small = fit(g, albumLine, (px) => `500 ${px}px ${family}`, [4.6 * s], width, 1);
	g.fillStyle = "rgb(255 255 255 / 0.7)";
	g.fillText(small.lines[0], x, y);
	// Myanmar stacks above and below the line: more room between lines than for Latin.
	y -= small.size * (MYANMAR.test(albumLine) ? 2.1 : 1.6);

	const names = artistLine(artistsOf(track).map((a) => a.name));
	if (names) {
		const my = MYANMAR.test(names);
		const who = fit(g, names, (px) => `600 ${px}px ${family}`, [5.6 * s, 5 * s], width, 2);
		const lh = who.size * (my ? 1.85 : 1.3);
		g.fillStyle = "rgb(255 255 255 / 0.9)";
		who.lines.slice().reverse().forEach((l, i) => g.fillText(l, x, y - i * lh));
		y -= (who.lines.length - 1) * lh + who.size * (my ? 1.5 : 1.15) + 1.6 * s;
	}

	const my = MYANMAR.test(track.title);
	const title = fit(g, track.title, (px) => `700 ${px}px ${family}`, [12 * s, 10.5 * s, 9 * s, 7.6 * s], width, 2);
	const lh = title.size * (my ? 1.62 : 1.12);
	// A Myanmar title's marks below the line need room above the artists.
	if (my) y -= title.size * 0.3;
	g.fillStyle = "#fff";
	title.lines.slice().reverse().forEach((l, i) => g.fillText(l, x, y - i * lh));

	return canvas.toDataURL("image/jpeg", 0.9);
}
