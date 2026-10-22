/**
 * What may be uploaded to a personal library (docs/library.md), shared by
 * the app, which refuses a file before sending any of it, and the audio
 * Worker (worker/media/library.js), which refuses it again: the app's
 * checks are a courtesy, the Worker's are the rule. Messages are written
 * for the person uploading. Pure: tested in Node.
 */
export const FORMATS = Object.freeze({
	mp3: { type: "audio/mpeg", name: "MP3" },
	m4a: { type: "audio/mp4", name: "M4A (AAC)" },
	flac: { type: "audio/flac", name: "FLAC" },
	wav: { type: "audio/wav", name: "WAV" },
	ogg: { type: "audio/ogg", name: "Ogg" },
});
const EXTENSIONS = { mp3: "mp3", m4a: "m4a", aac: "m4a", mp4: "m4a", flac: "flac", wav: "wav", wave: "wav", ogg: "ogg", oga: "ogg", opus: "ogg" };
const MAX_TEXT = 200;
export const MAX_SECONDS = 6 * 3600;

export class UploadRuleError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

/** "95 MB", "1.5 MB", "2,000 MB". */
export const megabytes = (n) => `${(n / 1_000_000).toLocaleString("en", { maximumFractionDigits: n < 10_000_000 ? 1 : 0 })} MB`;

/** The format of a file from its name (the extension), or null. */
export function formatOf(fileName) {
	const ext = /\.([A-Za-z0-9]+)$/.exec(fileName ?? "")?.[1]?.toLowerCase();
	return (ext && EXTENSIONS[ext]) ?? null;
}

/** Text as kept: NFC, single spaces, trimmed, at most MAX_TEXT characters. */
export function cleanText(v, name, required = false) {
	if (v === undefined || v === null) {
		if (required) throw new UploadRuleError(`${name} is required`);
		return "";
	}
	if (typeof v !== "string") throw new UploadRuleError(`${name} must be text`);
	const t = v.normalize("NFC").replace(/\s+/g, " ").trim();
	if (required && !t) throw new UploadRuleError(`${name} cannot be empty`);
	if (t.length > MAX_TEXT) throw new UploadRuleError(`${name} is longer than ${MAX_TEXT} characters`);
	return t;
}

function wholeNumber(v, name, min, max) {
	if (v === undefined || v === null || v === "") return null;
	const n = Number(v);
	if (!Number.isInteger(n) || n < min || n > max) throw new UploadRuleError(`${name} must be a whole number from ${min} to ${max}`);
	return n;
}

/** The editable details of an upload, checked; `partial` checks only the fields given. */
export function checkDetails(body, partial = false) {
	const out = {};
	if (!partial || "title" in body) out.title = cleanText(body.title, "title", true);
	if (!partial || "artist" in body) out.artist = cleanText(body.artist, "artist");
	if (!partial || "album" in body) out.album = cleanText(body.album, "album");
	if (!partial || "year" in body) out.year = wholeNumber(body.year, "year", 1900, 2100);
	if (!partial || "track" in body) out.track_no = wholeNumber(body.track, "track", 1, 999);
	return out;
}

/** Why a file of this format and size cannot be uploaded, or nothing. */
export function checkFile({ fileName, format, size }, { maxBytes, spaceLeft = Infinity }) {
	if (!FORMATS[format]) throw new UploadRuleError(`"${fileName}" is not a supported format. Upload MP3, M4A (AAC), FLAC, WAV or Ogg.`, 415);
	if (!Number.isSafeInteger(size) || size <= 0) throw new UploadRuleError(`"${fileName}" is empty`);
	if (size > maxBytes) {
		const hint = format === "wav" || format === "flac" ? " Save it as MP3 (320 kbps keeps an old recording's sound) and upload that." : " Upload a smaller copy.";
		throw new UploadRuleError(`"${fileName}" is ${megabytes(size)}; one file can be at most ${megabytes(maxBytes)}.${hint}`, 413);
	}
	if (size > spaceLeft) throw new UploadRuleError(`"${fileName}" (${megabytes(size)}) does not fit: ${megabytes(Math.max(0, spaceLeft))} of your space is left. Delete some uploads first.`, 413);
}

/** A new upload's declaration, checked against the limits. */
export function checkNewUpload(body, { maxBytes, spaceLeft = Infinity }) {
	const fileName = cleanText(body.fileName, "fileName", true);
	const format = String(body.format ?? "").toLowerCase();
	const size = Number(body.size);
	checkFile({ fileName, format, size }, { maxBytes, spaceLeft });
	const duration = Number(body.duration);
	if (!Number.isFinite(duration) || duration < 1 || duration > MAX_SECONDS) throw new UploadRuleError(`"${fileName}" has no readable length; it may not be audio, or it is damaged`);
	return { fileName, format, size, duration: Math.round(duration), ...checkDetails(body) };
}

/**
 * Details guessed from a file name when it has no tags:
 * "03 - Lal Thang - Hong len in.mp3" → { track: 3, artist: "Lal Thang", title: "Hong len in" }.
 */
export function detailsFromName(fileName) {
	let base = String(fileName ?? "").replace(/\.[A-Za-z0-9]+$/, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
	let track = null;
	const n = /^(\d{1,3})(?:\s*[-.)]\s*|\s+)(.+)$/.exec(base);
	if (n) { track = Number(n[1]) || null; base = n[2]; }
	const parts = base.split(/\s+-\s+/);
	if (parts.length >= 2) return { track, artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
	return { track, artist: "", title: base || "Untitled" };
}
