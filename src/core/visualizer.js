/**
 * Live audio analysis for the player animation.
 *
 * The playing <audio> element is routed through an AnalyserNode (in the
 * sound graph, core/sound.js), so the
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
 *   - The audio graph itself belongs to core/sound.js; the animations read
 *     its analyser, after all processing, so they show what is heard.
 */
import { sound } from "./sound.js";

let freq = null;
let wave = null;

export const visualizer = {
	/** Empty when live analysis is available; otherwise why it is not. */
	get unavailable() { return sound.unavailable; },
	get active() { return sound.active; },

	/**
	 * Fills `bars` (Float32Array) with 0..1 band energies on a log frequency
	 * scale and returns the overall loudness (0..1). Returns 0 when inactive.
	 */
	read(bars) {
		if (!this.active) {
			bars.fill(0);
			return 0;
		}
		const analyser = sound.analyser;
		if (!freq || freq.length !== analyser.frequencyBinCount) {
			freq = new Uint8Array(analyser.frequencyBinCount);
			wave = new Uint8Array(analyser.fftSize);
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
