/**
 * Avatar helpers for artists (and anything else that needs a deterministic
 * colored monogram in lieu of an image).
 */

/**
 * 9 color ramps. Each ramp has:
 *   - bg:   light pastel for the avatar circle
 *   - fg:   dark counterpart for text on the bg
 */
export const COLOR_RAMPS = [
	{ bg: "#B5D4F4", fg: "#042C53" }, // blue
	{ bg: "#C0DD97", fg: "#173404" }, // green
	{ bg: "#FAC775", fg: "#412402" }, // amber
	{ bg: "#F4C0D1", fg: "#4B1528" }, // pink
	{ bg: "#CECBF6", fg: "#26215C" }, // purple
	{ bg: "#9FE1CB", fg: "#04342C" }, // teal
	{ bg: "#F5C4B3", fg: "#4A1B0C" }, // coral
	{ bg: "#D3D1C7", fg: "#2C2C2A" }, // stone
	{ bg: "#E8C8E0", fg: "#3D1138" }, // lilac
];

/**
 * Artist type values stored in artist_name.json. Hand-curated, so most
 * artists default to 0 (unknown). Used for the gender/grouping filter
 * on the artist index page.
 */
export const ARTIST_TYPES = {
	UNKNOWN: 0,
	GROUP: 1,
	MALE: 2,
	FEMALE: 3,
};

/**
 * Display labels for the artist index filter.
 */
export const ARTIST_TYPE_LABELS = {
	0: "Unknown",
	1: "Group",
	2: "Male",
	3: "Female",
};

/**
 * @param {number|string} id
 * @returns {{ bg: string, fg: string }}
 */
export function avatarColor(id) {
	const n = Number(id);
	if (!Number.isFinite(n)) return COLOR_RAMPS[0];
	return COLOR_RAMPS[Math.abs(n | 0) % COLOR_RAMPS.length];
}

/**
 * @param {string} name
 * @returns {string}
 */
export function avatarInitials(name) {
	if (!name || typeof name !== "string") return "?";

	const cleaned = name
		.trim()
		.replace(/^(the|a|an|le|la|el|der|die|das)\s+/i, "");

	if (!cleaned) return name.charAt(0).toUpperCase();

	if (/[^\u0000-\u007F]/.test(cleaned.charAt(0))) {
		return cleaned.charAt(0);
	}

	const words = cleaned.split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].charAt(0).toUpperCase();

	return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * @param {string} name
 * @returns {string}
 */
export function alphabetBucket(name) {
	if (!name || typeof name !== "string") return "#";
	const cleaned = name
		.trim()
		.replace(/^(the|a|an|le|la|el|der|die|das)\s+/i, "");
	const first = cleaned.charAt(0).toUpperCase();
	if (/^[A-Z]$/.test(first)) return first;
	return "#";
}

/**
 * Names hidden from the "featured" row even with high play counts —
 * generic placeholders, not real artists. Case-insensitive.
 */
export const FEATURED_BLOCKLIST = new Set([
	"unknown",
	"various artists",
	"various",
	"va",
	"n/a",
	"none",
	"untitled",
	"-",
	"various artist",
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isFeaturedBlocked(name) {
	if (!name || typeof name !== "string") return true;
	return FEATURED_BLOCKLIST.has(name.trim().toLowerCase());
}
