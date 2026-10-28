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
/* global __AUDIO_URL__, __APP_VERSION__, __DEV__, __GA_ID__, __PLAYS_URL__, __SOUND_WORKLET__, __WORKSPACE__, __WORKSPACE_CSS__, __AUTH_URL__, __LIBRARY_URL__ */
export const AUDIO_URL_TEMPLATE = typeof __AUDIO_URL__ === "string" ? __AUDIO_URL__ : "";
/** Release version, yy.mm.dd.changes (see tools/lib/version.mjs). */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0.0";
/** True for `tools/build.mjs --dev` builds: no service worker, unminified. */
export const IS_DEV = typeof __DEV__ === "boolean" ? __DEV__ : true;
/** Google Analytics 4 measurement id; empty when the build has no analytics. */
export const GA_ID = typeof __GA_ID__ === "string" ? __GA_ID__ : "";
/** Where song plays are counted (core/plays.js); empty when counting is off for this build. */
export const PLAYS_URL = typeof __PLAYS_URL__ === "string" ? __PLAYS_URL__ : "";
/** The audio worklet for the sound features (core/sound-worklet.js), relative to the page. */
export const SOUND_WORKLET_URL = typeof __SOUND_WORKLET__ === "string" ? __SOUND_WORKLET__ : "";
/** The Workspace bundle (src/workspace), relative to the page; empty where it is not built (desktop). */
export const WORKSPACE_URL = typeof __WORKSPACE__ === "string" ? __WORKSPACE__ : "";
/** The Workspace's own stylesheet, loaded with it. */
export const WORKSPACE_CSS = typeof __WORKSPACE_CSS__ === "string" ? __WORKSPACE_CSS__ : "";
/** Personal libraries on the audio Worker (worker/media/library.js); empty where they are not built. */
export const LIBRARY_URL = typeof __LIBRARY_URL__ === "string" ? __LIBRARY_URL__ : "";
/** Sign in with GitHub for the Workspace (worker/media/auth.js); empty where it is not built. */
export const AUTH_URL = typeof __AUTH_URL__ === "string" ? __AUTH_URL__ : "";

export class AudioSourceError extends Error {}

/*
 * The version of a song to play (core/audio-edits.js: songs trimmed in the
 * audio studio), or undefined for the one the Worker plays by default. Set
 * once by the app; asked for each address.
 */
let versionOf = () => undefined;
export function setAudioVersions(lookup) { versionOf = lookup; }

/** Resolves the network URL for a track, or throws when no template is configured. */
export function audioUrl(track) {
	// An upload carries its own signed address (core/uploads.js).
	if (track.upload) {
		if (!track.url) throw new AudioSourceError(`"${track.title}" has no address yet; open Uploads in Library to refresh it.`);
		return track.url;
	}
	if (!AUDIO_URL_TEMPLATE) {
		throw new AudioSourceError("Streaming is not set up for this site. Only downloaded tracks can play.");
	}
	const values = {
		id: track.id,
		album: track.album.id,
		lang: track.album.lang.name,
		n: track.n,
	};
	const url = AUDIO_URL_TEMPLATE.replace(/\{(id|album|lang|n)\}/g, (_, key) => encodeURIComponent(String(values[key])));
	// A trimmed song: the version asked for by number, so a cached copy of another version is never played.
	const v = versionOf(track.id);
	return v === undefined ? url : `${url}${url.includes("?") ? "&" : "?"}v=${v}`;
}
