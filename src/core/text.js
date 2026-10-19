/**
 * Text normalization for search.
 *
 * - NFKC normalization so visually identical sequences compare equal.
 * - Zero-width characters (common in Myanmar tags) are removed.
 * - Latin diacritics are folded ("é" -> "e"); Myanmar combining marks are kept,
 *   because they carry meaning in that script.
 * - Punctuation becomes a single space; Latin is lowercased.
 */
const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
const LATIN_MARKS = /[̀-ͯ]/g;
const SEPARATORS = /[^\p{L}\p{N}\p{M}]+/gu;

export function normalize(value) {
	return String(value)
		.normalize("NFD")
		.replace(LATIN_MARKS, "")
		.normalize("NFKC")
		.replace(ZERO_WIDTH, "")
		.toLowerCase()
		.replace(SEPARATORS, " ")
		.trim();
}

/** Normalized form with all spaces removed, so "zam nu" also matches "zamnu". */
export const compact = (normalized) => normalized.replace(/ /g, "");

export function formatDuration(seconds) {
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = String(s % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function formatTotal(seconds) {
	const m = Math.round(seconds / 60);
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	return `${h} hr ${m % 60} min`;
}

export function formatBytes(bytes) {
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Deterministic 32-bit hash for stable cover colors. */
export function hash32(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
