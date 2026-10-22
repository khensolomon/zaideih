/**
 * Song details stored inside audio files, read in the browser before an
 * upload so the form is filled in: ID3v2 (MP3; versions 2.2 to 2.4) and
 * Vorbis comments (FLAC). Only the start of a file is needed
 * (TAG_BYTES). Answers { title, artist, album, year, track } with the
 * fields that were found. Pure: tested in Node.
 */
export const TAG_BYTES = 512 * 1024;

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");
const utf16le = new TextDecoder("utf-16le");
const utf16be = new TextDecoder("utf-16be");

const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const be32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const be24 = (b, i) => (b[i] << 16) + (b[i + 1] << 8) + b[i + 2];
const le32 = (b, i) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
const clean = (s) => s.replace(/\0+$/g, "").split("\0")[0].normalize("NFC").replace(/\s+/g, " ").trim();

/** An ID3v2 text frame's value. */
function id3Text(data) {
	if (!data.length) return "";
	const enc = data[0];
	const body = data.subarray(1);
	if (enc === 0) return clean(latin1.decode(body));
	if (enc === 3) return clean(utf8.decode(body));
	if (enc === 2) return clean(utf16be.decode(body));
	// 1: UTF-16 with a byte order mark.
	if (body[0] === 0xfe && body[1] === 0xff) return clean(utf16be.decode(body.subarray(2)));
	if (body[0] === 0xff && body[1] === 0xfe) return clean(utf16le.decode(body.subarray(2)));
	return clean(utf16le.decode(body));
}

const ID3_FIELDS = { TIT2: "title", TT2: "title", TPE1: "artist", TP1: "artist", TALB: "album", TAL: "album", TYER: "year", TYE: "year", TDRC: "year", TRCK: "track", TRK: "track" };

function readId3(b) {
	const version = b[3];
	if (version < 2 || version > 4) return {};
	const flags = b[5];
	const end = Math.min(b.length, 10 + syncsafe(b, 6));
	let i = 10;
	// An extended header is skipped (v2.3: plain size; v2.4: syncsafe, counting itself).
	if (flags & 0x40 && version >= 3) i += version === 4 ? syncsafe(b, i) : be32(b, i) + 4;
	const out = {};
	const idLen = version === 2 ? 3 : 4;
	const headLen = version === 2 ? 6 : 10;
	while (i + headLen <= end) {
		const id = latin1.decode(b.subarray(i, i + idLen));
		if (!/^[A-Z0-9]+$/.test(id)) break; // padding
		const size = version === 2 ? be24(b, i + 3) : version === 4 ? syncsafe(b, i + 4) : be32(b, i + 4);
		const start = i + headLen;
		if (size <= 0 || start + size > end) break;
		const field = ID3_FIELDS[id];
		if (field && !(field in out)) {
			const v = id3Text(b.subarray(start, start + size));
			if (v) out[field] = v;
		}
		i = start + size;
	}
	return out;
}

const VORBIS_FIELDS = { TITLE: "title", ARTIST: "artist", ALBUM: "album", DATE: "year", YEAR: "year", TRACKNUMBER: "track" };

function readFlac(b) {
	let i = 4;
	while (i + 4 <= b.length) {
		const last = b[i] & 0x80;
		const type = b[i] & 0x7f;
		const len = be24(b, i + 1);
		const start = i + 4;
		if (type === 4 && start + len <= b.length) {
			const out = {};
			let p = start;
			p += 4 + le32(b, p); // vendor string
			const n = le32(b, p);
			p += 4;
			for (let k = 0; k < n && p + 4 <= start + len; k++) {
				const l = le32(b, p);
				const text = utf8.decode(b.subarray(p + 4, p + 4 + l));
				p += 4 + l;
				const eq = text.indexOf("=");
				const field = VORBIS_FIELDS[text.slice(0, eq).toUpperCase()];
				const v = clean(text.slice(eq + 1));
				if (field && v && !(field in out)) out[field] = v;
			}
			return out;
		}
		if (last) break;
		i = start + len;
	}
	return {};
}

/** The details found at the start of a file (`bytes`: its first TAG_BYTES or fewer). */
export function readTags(bytes) {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const sig = latin1.decode(b.subarray(0, 4));
	let raw = {};
	if (sig.startsWith("ID3")) raw = readId3(b);
	else if (sig === "fLaC") raw = readFlac(b);
	const out = {};
	if (raw.title) out.title = raw.title;
	if (raw.artist) out.artist = raw.artist;
	if (raw.album) out.album = raw.album;
	const year = /\b(19\d\d|20\d\d)\b/.exec(raw.year ?? "")?.[1];
	if (year) out.year = Number(year);
	const track = Number.parseInt(raw.track ?? "", 10); // "3/12" -> 3
	if (track > 0 && track < 1000) out.track = track;
	return out;
}
