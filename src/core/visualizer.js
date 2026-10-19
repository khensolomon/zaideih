/**
 * Live audio analysis for the player animation.
 *
 * The playing <audio> element is routed through an AnalyserNode, so the
 * animation follows the actual sound (including the volume setting) rather
 * than a canned loop.
 *
 * Constraints:
 *   - Cross-origin audio can only be analysed when the response carries CORS
 *     headers; otherwise the browser outputs silence. The player therefore
 *     requests audio with crossOrigin="anonymous", and the audio Worker sends
 *     Access-Control-Allow-Origin for allowed origins.
 *   - iOS and iPadOS suspend Web Audio when the screen locks or the app is
 *     backgrounded, which would stop playback. Analysis is disabled there and
 *     the animation stays static; playback is unaffected.
 *   - Routing happens once per element and cannot be undone, so it is set up
 *     on the first play (a user gesture, which also satisfies autoplay rules).
 */
const FFT_SIZE = 512;

function isAppleMobile() {
	const ua = navigator.userAgent;
	// iPadOS reports a desktop Mac user agent; touch support tells them apart.
	return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function unsupportedReason() {
	if (typeof AudioContext !== "function" && typeof webkitAudioContext !== "function") return "Web Audio is not available in this browser";
	if (isAppleMobile()) return "iOS stops Web Audio in the background, which would interrupt playback";
	return "";
}

const reason = unsupportedReason();
let ctx = null;
let analyser = null;
let freq = null;
let wave = null;
let failed = "";

export const visualizer = {
	/** Empty when live analysis is available; otherwise why it is not. */
	get unavailable() { return reason || failed; },
	get active() { return !!analyser && ctx?.state === "running"; },

	/** Routes `audio` through the analyser on its first play. */
	attach(audio) {
		if (reason) return;
		audio.addEventListener("play", () => {
			if (failed) return;
			try {
				if (!ctx) {
					const Ctx = window.AudioContext ?? window.webkitAudioContext;
					ctx = new Ctx();
					analyser = ctx.createAnalyser();
					analyser.fftSize = FFT_SIZE;
					analyser.smoothingTimeConstant = 0.78;
					analyser.minDecibels = -88;
					analyser.maxDecibels = -18;
					const source = ctx.createMediaElementSource(audio);
					source.connect(analyser);
					analyser.connect(ctx.destination);
					freq = new Uint8Array(analyser.frequencyBinCount);
					wave = new Uint8Array(analyser.fftSize);
				}
				if (ctx.state === "suspended") ctx.resume().catch((err) => console.error("audio context resume failed", err));
			} catch (err) {
				// The animation is optional; record why it is off and keep playing.
				failed = `audio analysis could not start (${err.message})`;
				console.error(failed);
			}
		});
	},

	/**
	 * Fills `bars` (Float32Array) with 0..1 band energies on a log frequency
	 * scale and returns the overall loudness (0..1). Returns 0 when inactive.
	 */
	read(bars) {
		if (!this.active) {
			bars.fill(0);
			return 0;
		}
		analyser.getByteFrequencyData(freq);
		analyser.getByteTimeDomainData(wave);
		// Bins above ~16 kHz are near-empty for these recordings; spread bars over the rest.
		const usable = Math.floor(freq.length * 0.72);
		const n = bars.length;
		for (let i = 0; i < n; i++) {
			const lo = Math.floor(Math.pow(usable, i / n));
			const hi = Math.max(lo + 1, Math.floor(Math.pow(usable, (i + 1) / n)));
			let sum = 0;
			for (let b = lo; b < hi; b++) sum += freq[b];
			bars[i] = sum / (hi - lo) / 255;
		}
		let energy = 0;
		for (let i = 0; i < wave.length; i++) {
			const v = (wave[i] - 128) / 128;
			energy += v * v;
		}
		return Math.min(1, Math.sqrt(energy / wave.length) * 2.6);
	},
};
