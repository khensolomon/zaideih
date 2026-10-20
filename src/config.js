/**
 * Build-time configuration, injected by build.mjs through esbuild `define`.
 *
 * ZAIDEIH_AUDIO_URL is a URL template for audio files. Supported placeholders:
 *   {id}      global track id
 *   {album}   album id (ui)
 *   {lang}    language name, e.g. "myanmar"
 *   {n}       1-based track position within the album
 *
 * Default (tools/build.mjs): https://media.zaideih.com/audio/{id}, served by
 * worker/media, which resolves the id to the R2 object.
 */
/* global __AUDIO_URL__, __APP_VERSION__, __DEV__, __GA_ID__ */
export const AUDIO_URL_TEMPLATE = typeof __AUDIO_URL__ === "string" ? __AUDIO_URL__ : "";
/** Release version, yy.mm.dd.changes (see tools/lib/version.mjs). */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0.0";
/** True for `tools/build.mjs --dev` builds: no service worker, unminified. */
export const IS_DEV = typeof __DEV__ === "boolean" ? __DEV__ : true;
/** Google Analytics 4 measurement id; empty when the build has no analytics. */
export const GA_ID = typeof __GA_ID__ === "string" ? __GA_ID__ : "";

export class AudioSourceError extends Error {}

/** Resolves the network URL for a track, or throws when no template is configured. */
export function audioUrl(track) {
	if (!AUDIO_URL_TEMPLATE) {
		throw new AudioSourceError("Streaming is not set up for this site. Only downloaded tracks can play.");
	}
	const values = {
		id: track.id,
		album: track.album.id,
		lang: track.album.lang.name,
		n: track.n,
	};
	return AUDIO_URL_TEMPLATE.replace(/\{(id|album|lang|n)\}/g, (_, key) => encodeURIComponent(String(values[key])));
}
