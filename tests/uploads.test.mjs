import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFile, checkNewUpload, detailsFromName, formatOf, megabytes } from "../src/core/upload-rules.js";
import { readTags } from "../src/core/tags.js";

const { shapeUploads } = await import("../src/core/uploads.js");

test("formats come from the file name", () => {
	assert.equal(formatOf("Song.MP3"), "mp3");
	assert.equal(formatOf("a.b.flac"), "flac");
	assert.equal(formatOf("x.aac"), "m4a");
	assert.equal(formatOf("x.opus"), "ogg");
	assert.equal(formatOf("x.wma"), null);
	assert.equal(formatOf("noext"), null);
});

test("the same rules refuse a file in the app and on the Worker", () => {
	assert.equal(megabytes(95_000_000), "95 MB");
	assert.equal(megabytes(1_500_000), "1.5 MB");
	assert.throws(() => checkFile({ fileName: "Tape 1987.wav", format: "wav", size: 412_300_000 }, { maxBytes: 95_000_000 }), { message: "\"Tape 1987.wav\" is 412 MB; one file can be at most 95 MB. Save it as MP3 (320 kbps keeps an old recording's sound) and upload that." });
	assert.throws(() => checkFile({ fileName: "a.mp3", format: "mp3", size: 50 }, { maxBytes: 100, spaceLeft: 40 }), /does not fit: 0 MB of your space is left/);
	assert.throws(() => checkFile({ fileName: "a.wma", format: null, size: 50 }, { maxBytes: 100 }), /not a supported format/);
	assert.doesNotThrow(() => checkFile({ fileName: "a.mp3", format: "mp3", size: 100 }, { maxBytes: 100 }));
	const ok = checkNewUpload({ fileName: " A.mp3 ", format: "MP3", size: 10, duration: 59.6, title: " Hong  len in ", year: "1987", track: "3" }, { maxBytes: 100 });
	assert.deepEqual(ok, { fileName: "A.mp3", format: "mp3", size: 10, duration: 60, title: "Hong len in", artist: "", album: "", year: 1987, track_no: 3 });
});

test("details from a file name when it has no tags", () => {
	assert.deepEqual(detailsFromName("03 - Lal Thang - Hong len in.mp3"), { track: 3, artist: "Lal Thang", title: "Hong len in" });
	assert.deepEqual(detailsFromName("12. Itna Leiba.flac"), { track: 12, artist: "", title: "Itna Leiba" });
	assert.deepEqual(detailsFromName("Zogam_Lam.mp3"), { track: null, artist: "", title: "Zogam Lam" });
	assert.deepEqual(detailsFromName(".mp3"), { track: null, artist: "", title: "Untitled" });
});

/* ------------------------------------------------------------------ tags ---- */
const enc = (s) => [...new TextEncoder().encode(s)];
const syncsafe = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const be32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
function id3(version, frames) {
	const body = frames.flatMap(([id, bytes]) => [...enc(id), ...(version === 4 ? syncsafe(bytes.length) : be32(bytes.length)), 0, 0, ...bytes]);
	return Uint8Array.from([...enc("ID3"), version, 0, 0, ...syncsafe(body.length + 10), ...body, ...new Array(10).fill(0)]);
}
const latin = (s) => [0, ...[...s].map((c) => c.charCodeAt(0))];
const utf8 = (s) => [3, ...enc(s)];
const utf16 = (s) => [1, 0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]), 0, 0];

test("ID3v2.3 and v2.4 tags fill the form", () => {
	assert.deepEqual(readTags(id3(3, [["TIT2", latin("Hong len in")], ["TPE1", utf16("Lal Thang")], ["TALB", latin("Agape No.1")], ["TYER", latin("1987")], ["TRCK", latin("3/12")]])),
		{ title: "Hong len in", artist: "Lal Thang", album: "Agape No.1", year: 1987, track: 3 });
	assert.deepEqual(readTags(id3(4, [["TIT2", utf8("ခရစ်တော်")], ["TDRC", utf8("1999-05-01")], ["APIC", [0, 1, 2, 3]], ["TPE1", utf8("Artist")]])),
		{ title: "ခရစ်တော်", artist: "Artist", year: 1999 });
	assert.deepEqual(readTags(Uint8Array.from([0xff, 0xfb, 0x90, 0])), {}, "an MP3 without tags");
	assert.deepEqual(readTags(new Uint8Array(3)), {});
});

test("FLAC Vorbis comments fill the form", () => {
	const le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
	const comments = ["TITLE=Itna Leiba", "artist=JK. Kam", "ALBUM=Itna Leiba", "DATE=2005", "TRACKNUMBER=1"];
	const block = [...le(3), ...enc("x y"), ...le(comments.length), ...comments.flatMap((c) => [...le(enc(c).length), ...enc(c)])];
	const streaminfo = [0x00, 0, 0, 34, ...new Array(34).fill(0)];
	const vorbis = [0x84, (block.length >> 16) & 0xff, (block.length >> 8) & 0xff, block.length & 0xff, ...block];
	assert.deepEqual(readTags(Uint8Array.from([...enc("fLaC"), ...streaminfo, ...vorbis])), { title: "Itna Leiba", artist: "JK. Kam", album: "Itna Leiba", year: 2005, track: 1 });
});

test("uploads join the app as albums of their own, outside the catalog", () => {
	const { tracks, albums } = shapeUploads([
		{ id: 5, title: "B side", artist: "Ann", album: "Tape", track: 2, duration: 100, year: 1991, url: "https://m/u/5?e=1&s=x", format: "mp3", size: 9, fileName: "b.mp3" },
		{ id: 4, title: "A side", artist: "Ann", album: "Tape", track: 1, duration: 120, year: 1990, url: "https://m/u/4?e=1&s=x", format: "mp3", size: 9, fileName: "a.mp3" },
		{ id: 6, title: "Loose", artist: "", album: "", track: null, duration: 60, year: null, url: "u", format: "flac", size: 9, fileName: "c.flac" },
	]);
	assert.deepEqual(albums.map((a) => [a.title, a.tracks.map((t) => t.id), a.year, a.duration]), [["Singles", ["u6"], null, 60], ["Tape", ["u4", "u5"], 1990, 220]]);
	const a = tracks.find((t) => t.id === "u4");
	assert.equal(a.upload, true);
	assert.equal(a.uploadId, 4);
	assert.equal(a.url, "https://m/u/4?e=1&s=x");
	assert.equal(a.album.lang.name, "uploads");
	assert.equal(a.n, 1);
	assert.equal(tracks.find((t) => t.id === "u6").artists[0].name, "Unknown artist");
	assert.ok(a.album.id.startsWith("u-album-"));
});
