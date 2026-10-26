/**
 * How chords look above the words, chosen per device and kept only there
 * (localStorage, `zaideih.lyrics.chordStyle`; nothing is sent anywhere): their
 * size against the words, and how bright they are. Applied as CSS variables
 * on the document (--chord-scale, --chord-alpha), so every place lyrics show
 * chords follows: the lyrics page, Now playing, the studio's preview.
 */
const KEY = "zaideih.lyrics.chordStyle";

/** Size of a chord against the words' size. */
export const CHORD_SIZES = Object.freeze({ small: ["Small", 0.72], medium: ["Medium", 0.86], large: ["As the words", 1] });
/** How bright chords are. */
export const CHORD_TONES = Object.freeze({ dim: ["Dim", 0.5], soft: ["Soft", 0.75], bright: ["Bright", 1] });
export const CHORD_DEFAULT = Object.freeze({ size: "small", tone: "soft" });

/** The device's choice, each part checked: an unknown value is the default's. */
export function chordStyle() {
	let saved = {};
	try {
		saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
	} catch { /* the default */ }
	return {
		size: saved.size in CHORD_SIZES ? saved.size : CHORD_DEFAULT.size,
		tone: saved.tone in CHORD_TONES ? saved.tone : CHORD_DEFAULT.tone,
	};
}

/** Sets the CSS variables from the device's choice. */
export function applyChordStyle(style = chordStyle()) {
	if (typeof document === "undefined") return;
	const root = document.documentElement.style;
	root.setProperty("--chord-scale", String(CHORD_SIZES[style.size][1]));
	root.setProperty("--chord-alpha", String(CHORD_TONES[style.tone][1]));
}

/** Changes part of the choice ({ size } or { tone }), keeps it on the device and applies it. */
export function setChordStyle(change) {
	const next = { ...chordStyle(), ...change };
	if (!(next.size in CHORD_SIZES) || !(next.tone in CHORD_TONES)) throw new Error(`chord style must be a size of ${Object.keys(CHORD_SIZES).join(", ")} and a tone of ${Object.keys(CHORD_TONES).join(", ")}`);
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch { /* this visit only */ }
	applyChordStyle(next);
	return next;
}
