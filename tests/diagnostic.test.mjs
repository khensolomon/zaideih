import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCode, encodeCode, explain, packVersion, sniff } from "../src/core/diagnostic.js";

const bytes = (...xs) => new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

test("codes round-trip every field", () => {
	const at = Date.UTC(2026, 9, 20, 14, 5);
	const code = encodeCode({ kind: "unsupported", trackId: 22503, status: 206, signature: "mp4", sizeBytes: 4321000, version: "26.10.20.4", at, probed: true, online: true, lookup: "edge" });
	assert.match(code, /^ZE-[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
	const d = decodeCode(code);
	assert.deepEqual({ ...d, at: d.at.getTime() }, {
		format: 1, kind: "unsupported", status: 206, signature: "mp4", lookup: "edge", trackId: 22503, sizeKiB: 4220, version: "26.10.20.4", at,
		download: false, desktop: false, online: true, probed: true, unreachable: false, retried: false, noObject: false, noTrack: false, metaCached: true,
	});
	assert.deepEqual(decodeCode(code.toLowerCase().replace(/-/g, " ")).trackId, 22503, "case and separators do not matter");
});

test("mistyped or cut codes are refused with a reason", () => {
	const code = encodeCode({ kind: "decode", trackId: 7, status: 200, signature: "mp3" });
	const last = code.at(-1);
	const typo = code.slice(0, -2) + (code.at(-2) === "A" ? "B" : "A") + last;
	assert.throws(() => decodeCode(typo), /mistyped/);
	assert.throws(() => decodeCode(code.slice(0, 12)), /cut short|check digit|mistyped/);
	assert.throws(() => decodeCode("AB-1234"), /starts with "ZE-"/);
	assert.throws(() => decodeCode("ZE-U000"), /not part of a diagnostic code/);
});

test("sniff names the audio format from the first bytes", () => {
	assert.equal(sniff(bytes("ID3", 4, 0)), "mp3-id3");
	assert.equal(sniff(bytes(0xff, 0xfb, 0x90, 0x64)), "mp3");
	assert.equal(sniff(bytes(0xff, 0xf1, 0x50, 0x80)), "aac");
	assert.equal(sniff(bytes(0, 0, 0, 0x20, "ftypM4A ")), "mp4");
	assert.equal(sniff(bytes(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66)), "wma");
	assert.equal(sniff(bytes("OggS", 0)), "ogg");
	assert.equal(sniff(bytes("<!DOCTYPE html>")), "html");
	assert.equal(sniff(bytes("Not Found")), "text");
	assert.equal(sniff(new Uint8Array()), "empty");
});

test("explain names the likely cause", () => {
	assert.match(explain({ kind: "unsupported", probed: true, status: 206, signature: "mp4" }).cause, /MP4\/M4A, not MP3/);
	assert.match(explain({ kind: "unsupported", probed: true, status: 404, noObject: true }).cause, /no object/);
	assert.match(explain({ kind: "unsupported", probed: true, status: 404, noTrack: true, metaCached: true }).steps.join(" "), /META_CACHE_VERSION/);
	assert.match(explain({ kind: "unsupported", probed: true, unreachable: true, online: true }).cause, /ALLOWED_ORIGINS/);
	assert.match(explain({ kind: "decode", download: true, signature: "html" }).cause, /downloaded copy/);
	assert.match(explain({ kind: "unsupported", probed: true, status: 206, signature: "mp3-id3" }).cause, /saved copy/);
	assert.match(explain({ kind: "unsupported", probed: true, status: 206, signature: "mp3-id3", retried: true }).cause, /damaged/);
	assert.equal(packVersion("26.10.20.3"), 26102003);
});
