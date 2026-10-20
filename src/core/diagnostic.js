/**
 * Playback diagnostic codes.
 *
 * When a song fails, the app probes what went wrong and packs the findings
 * into a short code such as "ZE-1A2B-C3D4-…". The code carries no paths or
 * personal data, only ids and measurements; `decodeCode()` turns it back
 * into fields and `explain()` names the likely cause. Shared by the app
 * (hidden #/code/<code> page) and `tools/diagnose.mjs`, so it must not touch
 * the DOM at import time.
 *
 * Layout, version 1 (bytes, then base32 in groups of four):
 *   0      format version
 *   1      what failed (KINDS index)
 *   2      flags (FLAGS)
 *   3..4   HTTP status of the probe (0 = no answer)
 *   5      first bytes of the file (SIGNATURES index)
 *   6      where the Worker's track lookup came from (LOOKUPS index)
 *   varint track id
 *   varint file size in KiB (0 = unknown)
 *   varint app version as yymmddNN (26.10.20.3 -> 26102003)
 *   varint minutes since 2026-01-01 UTC
 *   last   CRC-8 of everything before it
 */

export const PREFIX = "ZE";
const FORMAT = 1;
const EPOCH = Date.UTC(2026, 0, 1);

/** What failed. Indices are part of the code format: append only. */
export const KINDS = ["unknown", "aborted", "network", "decode", "unsupported", "download-missing", "offline", "play-rejected"];

/** Leading bytes of the file. Indices are part of the code format: append only. */
export const SIGNATURES = ["not-read", "mp3", "mp3-id3", "aac", "mp4", "flac", "ogg", "wav", "wma", "html", "text", "empty", "other"];

/** X-Zaideih-Meta values. Indices are part of the code format: append only. */
export const LOOKUPS = ["not-reported", "memory", "edge", "d1"];

export const FLAGS = {
	download: 1,       // played from a downloaded copy
	desktop: 2,        // desktop app (Electron)
	online: 4,         // navigator.onLine at the time
	probed: 8,         // a probe ran
	unreachable: 16,   // the probe got no HTTP answer (offline, blocked or CORS)
	retried: 32,       // the player already retried once past the browser cache
	noObject: 64,      // Worker: D1 row exists, R2 object missing
	noTrack: 128,      // Worker: no D1 row
};

/** Media element error code (1-4) to KINDS. */
export const KIND_OF_MEDIA_ERROR = { 1: "aborted", 2: "network", 3: "decode", 4: "unsupported" };

/* ---------- file signature ---------- */

const ascii = (bytes, from, n) => String.fromCharCode(...bytes.slice(from, from + n));

/** Names the format from a file's first bytes (16 are enough). */
export function sniff(bytes) {
	if (!bytes || !bytes.length) return "empty";
	if (ascii(bytes, 0, 3) === "ID3") return "mp3-id3";
	if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return (bytes[1] & 0x06) === 0 ? "aac" : "mp3";
	if (ascii(bytes, 4, 4) === "ftyp") return "mp4";
	if (ascii(bytes, 0, 4) === "fLaC") return "flac";
	if (ascii(bytes, 0, 4) === "OggS") return "ogg";
	if (ascii(bytes, 0, 4) === "RIFF") return "wav";
	if (bytes[0] === 0x30 && bytes[1] === 0x26 && bytes[2] === 0xb2 && bytes[3] === 0x75) return "wma";
	const head = ascii(bytes, 0, Math.min(bytes.length, 16)).trimStart().toLowerCase();
	if (head.startsWith("<")) return "html";
	if ([...bytes.slice(0, 16)].every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127))) return "text";
	return "other";
}

/* ---------- encoding ---------- */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

function crc8(bytes) {
	let c = 0;
	for (const b of bytes) {
		c ^= b;
		for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
	}
	return c;
}

function pushVarint(out, n) {
	let v = Math.max(0, Math.floor(n));
	do {
		let byte = v % 128;
		v = Math.floor(v / 128);
		if (v) byte |= 0x80;
		out.push(byte);
	} while (v);
}

function readVarint(bytes, pos) {
	let value = 0;
	let scale = 1;
	for (;;) {
		if (pos.i >= bytes.length) throw new Error("The code is cut short.");
		const b = bytes[pos.i++];
		value += (b & 0x7f) * scale;
		if (!(b & 0x80)) return value;
		scale *= 128;
	}
}

function toBase32(bytes) {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const b of bytes) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits) out += ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

function fromBase32(text) {
	let bits = 0;
	let value = 0;
	const out = [];
	for (const ch of text) {
		const i = ALPHABET.indexOf(ch);
		if (i < 0) throw new Error(`The code contains "${ch}", which is not part of a diagnostic code.`);
		value = (value << 5) | i;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	// The encoder pads the last character with zero bits; anything else is a typo.
	if (bits && (value & ((1 << bits) - 1))) throw new Error("The code's last character does not fit: it was probably mistyped.");
	return out;
}

/** "26.10.20.3" -> 26102003. */
export function packVersion(version) {
	const m = /^(\d{2})\.(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(String(version));
	if (!m) return 0;
	return ((Number(m[1]) * 100 + Number(m[2])) * 100 + Number(m[3])) * 100 + Number(m[4]);
}
function unpackVersion(n) {
	if (!n) return "";
	const s = String(n).padStart(8, "0");
	return [s.slice(0, 2), Number(s.slice(2, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))].join(".");
}

/**
 * Packs a diagnosis into a code. `d` holds: kind, trackId, status, signature,
 * sizeBytes, version, at (ms), and the boolean FLAGS names.
 */
export function encodeCode(d) {
	let flags = 0;
	for (const [name, bit] of Object.entries(FLAGS)) if (d[name]) flags |= bit;
	const kind = Math.max(0, KINDS.indexOf(d.kind));
	const sig = Math.max(0, SIGNATURES.indexOf(d.signature ?? "not-read"));
	const status = Math.max(0, Math.min(65535, d.status ?? 0));
	const lookup = Math.max(0, LOOKUPS.indexOf(d.lookup ?? "not-reported"));
	const bytes = [FORMAT, kind, flags, status >> 8, status & 0xff, sig, lookup];
	pushVarint(bytes, d.trackId ?? 0);
	pushVarint(bytes, d.sizeBytes ? Math.ceil(d.sizeBytes / 1024) : 0);
	pushVarint(bytes, packVersion(d.version));
	pushVarint(bytes, Math.max(0, Math.round(((d.at ?? Date.now()) - EPOCH) / 60000)));
	bytes.push(crc8(bytes));
	const body = toBase32(bytes);
	return `${PREFIX}-${body.match(/.{1,4}/g).join("-")}`;
}

/** Unpacks a code; throws an Error naming the problem when it is not valid. */
export function decodeCode(code) {
	const text = String(code).trim().toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
	if (!text.startsWith(PREFIX)) throw new Error(`A diagnostic code starts with "${PREFIX}-".`);
	const bytes = fromBase32(text.slice(PREFIX.length));
	if (bytes.length < 9 || crc8(bytes.slice(0, -1)) !== bytes.at(-1)) {
		throw new Error("The code's check digit does not match: it was probably copied incompletely or mistyped.");
	}
	const body = bytes.slice(0, -1);
	if (body[0] !== FORMAT) throw new Error(`Code format ${body[0]} is not supported by this version.`);
	const flags = body[2];
	const pos = { i: 7 };
	const d = {
		format: body[0],
		kind: KINDS[body[1]] ?? "unknown",
		status: (body[3] << 8) | body[4],
		signature: SIGNATURES[body[5]] ?? "other",
		lookup: LOOKUPS[body[6]] ?? "not-reported",
		trackId: readVarint(body, pos),
		sizeKiB: readVarint(body, pos),
		version: unpackVersion(readVarint(body, pos)),
		at: new Date(EPOCH + readVarint(body, pos) * 60000),
	};
	for (const [name, bit] of Object.entries(FLAGS)) d[name] = Boolean(flags & bit);
	d.metaCached = d.lookup === "memory" || d.lookup === "edge";
	return d;
}

/* ---------- explanation ---------- */

const PLAYABLE = new Set(["mp3", "mp3-id3"]);
const OTHER_AUDIO = { aac: "raw AAC", mp4: "MP4/M4A", flac: "FLAC", ogg: "Ogg", wav: "WAV", wma: "WMA" };

/** The likely cause and what to check, in plain words. */
export function explain(d) {
	const steps = [];
	let cause;
	if (d.kind === "download-missing") {
		cause = "The song is marked as downloaded on the device, but the saved file is gone.";
		steps.push("Remove the download and download the song again.");
	} else if (d.kind === "offline") {
		cause = "The device was offline and the song is not downloaded.";
	} else if (d.download) {
		if (!PLAYABLE.has(d.signature)) {
			cause = `The downloaded copy on the device is not playable MP3 data (it starts as ${d.signature}).`;
			steps.push("Remove the download and download it again; if it fails again, check the file on the server.");
		} else {
			cause = "The downloaded copy looks like MP3 but the browser could not play it: it is probably damaged or incomplete.";
			steps.push("Remove the download and download it again.");
		}
	} else if (!d.probed) {
		cause = "No probe ran, so only the player's error is known.";
	} else if (d.unreachable) {
		cause = d.online
			? "The audio server did not answer the app (blocked network, CORS: the app's origin missing from ALLOWED_ORIGINS, or a Worker outage)."
			: "The device was offline.";
		steps.push("Open the audio URL directly in a browser; check ALLOWED_ORIGINS in worker/media/wrangler.toml.");
	} else if (d.status === 404) {
		if (d.noTrack) {
			cause = "The Worker found no row for this id in D1.";
			steps.push("Check: SELECT * FROM tracks WHERE id = <id>; then load the row from media.json (node tools/media.mjs d1 --apply).");
		} else if (d.noObject) {
			cause = "D1 has a row for this id, but R2 has no object at the key it names.";
			steps.push("Compare the key byte for byte with the R2 object (tools/diagnose.mjs prints the code points): Myanmar text can look identical in two different orders.");
		} else {
			cause = "The server answered 404 (an older Worker that does not report which part is missing).";
		}
		if (d.metaCached) steps.push("The lookup came from the Worker's cache, which can predate a fix in D1: bump META_CACHE_VERSION and redeploy to drop it.");
	} else if (d.status === 403) {
		cause = "The Worker refused the request: the app's origin is not in ALLOWED_ORIGINS.";
	} else if (d.status >= 500) {
		cause = `The Worker failed with ${d.status} (D1 or R2 error).`;
		steps.push("Check the Worker logs: npx wrangler tail --config worker/media/wrangler.toml");
	} else if (d.status === 200 || d.status === 206) {
		if (OTHER_AUDIO[d.signature]) {
			cause = `The file is ${OTHER_AUDIO[d.signature]}, not MP3. The Worker labels every file audio/mpeg with nosniff, so the browser refuses it.`;
			steps.push("Re-encode the file to MP3 and upload it under the same key, or serve its real type.");
		} else if (d.signature === "html" || d.signature === "text" || d.signature === "empty") {
			cause = `The object in R2 is not audio (it starts as ${d.signature}).`;
			steps.push("Replace the R2 object with the real audio file.");
		} else if (PLAYABLE.has(d.signature) && !d.retried) {
			cause = "The server delivers MP3 data, but this browser refused the song, probably because of a saved copy from an older server answer (the player had not yet retried past the browser cache).";
			steps.push("Try the song in another browser or a private window; if it plays there, clear this browser's cached files (see #/help).");
		} else if (PLAYABLE.has(d.signature)) {
			cause = "The server delivers MP3 data and a fresh request failed too: the file is probably damaged or unusually encoded.";
			steps.push("Download the file from R2 and play it locally; re-encode or replace it if it fails there too.");
			steps.push("If it plays in another browser, the browser itself is the problem: clear its cached files (see #/help).");
			if (d.metaCached) steps.push("The Worker answered from its cached lookup; if D1 was changed recently, bump META_CACHE_VERSION.");
		} else {
			cause = "The server answered, but the file does not start like any known audio format.";
		}
	} else {
		cause = `The server answered with an unexpected status ${d.status}.`;
	}
	return { cause, steps };
}
