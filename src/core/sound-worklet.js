/**
 * Audio worklet processors for the sound features (core/sound.js). Built as
 * its own file (tools/build.mjs) and loaded with audioWorklet.addModule().
 * Both run on the audio thread, so they keep working in a background tab,
 * where timers on the page are slowed down.
 *
 * zaideih-meter    Passes the sound through unchanged and reports the level
 *                  of each channel (dBFS, RMS) every 50 ms through its port.
 *
 * zaideih-denoise  Spectral noise reduction for tape hiss. Short-time Fourier
 *                  transform (1024 samples, 75 % overlap, Hann windows); the
 *                  noise level of each frequency is tracked as the slowly
 *                  rising minimum of its smoothed power ("minimum statistics"),
 *                  so it learns the hiss of each recording from its quiet
 *                  moments without a separate noise sample. Each frequency is
 *                  attenuated by how close it is to that noise level, never
 *                  below a floor, and smoothed over time and neighbouring
 *                  frequencies, which keeps the "watery" artefacts of strong
 *                  noise reduction down. Parameter `amount`: 0 passes the sound
 *                  through (with the same 23 ms delay), 0.5 is light, 1 strong.
 */

/* global sampleRate, registerProcessor, AudioWorkletProcessor */

const N = 1024;
const HOP = N / 4;
const BINS = N / 2 + 1;
const METER_SECONDS = 0.05;
const NOISE_BIAS = 2.5;

/* ---------------------------------------------------------------- FFT ---- */

const bitrev = new Uint16Array(N);
const cosT = new Float32Array(N / 2);
const sinT = new Float32Array(N / 2);
{
	const bits = Math.log2(N);
	for (let i = 0; i < N; i++) {
		let r = 0;
		for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
		bitrev[i] = r;
	}
	for (let i = 0; i < N / 2; i++) {
		cosT[i] = Math.cos((2 * Math.PI * i) / N);
		sinT[i] = Math.sin((2 * Math.PI * i) / N);
	}
}

/** In-place complex FFT (inverse when `inv`, without the 1/N scale). */
export function fft(re, im, inv) {
	for (let i = 0; i < N; i++) {
		const j = bitrev[i];
		if (j > i) {
			let t = re[i]; re[i] = re[j]; re[j] = t;
			t = im[i]; im[i] = im[j]; im[j] = t;
		}
	}
	for (let size = 2; size <= N; size <<= 1) {
		const half = size >> 1;
		const step = N / size;
		for (let start = 0; start < N; start += size) {
			for (let k = 0; k < half; k++) {
				const wr = cosT[k * step];
				const wi = inv ? sinT[k * step] : -sinT[k * step];
				const a = start + k;
				const b = a + half;
				const tr = re[b] * wr - im[b] * wi;
				const ti = re[b] * wi + im[b] * wr;
				re[b] = re[a] - tr; im[b] = im[a] - ti;
				re[a] += tr; im[a] += ti;
			}
		}
	}
}

const hann = new Float32Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
// Hann analysis and synthesis windows at 75 % overlap sum to 1.5.
const OLA_SCALE = 1 / 1.5;

/** One channel of the denoiser: input history, spectra and overlap-add output. */
export class DenoiseChannel {
	constructor() {
		this.inBuf = new Float32Array(N);
		this.outBuf = new Float32Array(N);
		this.fill = 0;           // new samples since the last frame
		this.re = new Float32Array(N);
		this.im = new Float32Array(N);
		this.smooth = new Float32Array(BINS);
		this.noise = new Float32Array(BINS).fill(1e-3);
		this.gain = new Float32Array(BINS).fill(1);
		this.frames = 0;
		this.queue = new Float32Array(HOP); // output ready to hand out
		this.qpos = HOP;
	}

	/** Processes one hop of new samples (HOP long) into `out` (HOP long). */
	frame(input, amount) {
		const { inBuf, outBuf, re, im, smooth, noise, gain } = this;
		inBuf.copyWithin(0, HOP);
		inBuf.set(input, N - HOP);
		for (let i = 0; i < N; i++) { re[i] = inBuf[i] * hann[i]; im[i] = 0; }
		fft(re, im, false);
		this.frames += 1;
		// Noise floor: the smoothed power's minimum, allowed to rise ~3 dB a second.
		const rise = 1 + 0.004;
		const over = 1 + 1.2 * amount;              // over-subtraction
		const floor = 1 - 0.8 * amount;             // never below this gain (0.2 = -14 dB at full)
		for (let b = 0; b < BINS; b++) {
			const p = re[b] * re[b] + im[b] * im[b];
			smooth[b] = this.frames === 1 ? p : 0.85 * smooth[b] + 0.15 * p;
			// Starts at the first frames' level and follows the minimum from there.
			noise[b] = this.frames <= 2 || smooth[b] < noise[b] ? smooth[b] : noise[b] * rise;
		}
		for (let b = 0; b < BINS; b++) {
			let g = 1;
			if (amount > 0 && this.frames > 20) {
				// Wiener-like gain from the power above the noise, with the neighbours' average.
				const pb = (smooth[Math.max(0, b - 1)] + smooth[b] + smooth[Math.min(BINS - 1, b + 1)]) / 3 + 1e-12;
				// The minimum sits below the noise's average power; NOISE_BIAS corrects for it.
				g = Math.max(floor, 1 - (over * NOISE_BIAS * noise[b]) / pb);
			}
			// Gains open fast (keeps attacks) and close slowly (avoids flutter).
			gain[b] = g > gain[b] ? 0.6 * g + 0.4 * gain[b] : 0.15 * g + 0.85 * gain[b];
		}
		for (let b = 0; b < BINS; b++) {
			re[b] *= gain[b]; im[b] *= gain[b];
			if (b > 0 && b < N / 2) { re[N - b] = re[b]; im[N - b] = -im[b]; }
		}
		fft(re, im, true);
		outBuf.copyWithin(0, HOP);
		outBuf.fill(0, N - HOP);
		for (let i = 0; i < N; i++) outBuf[i] += (re[i] / N) * hann[i] * OLA_SCALE;
		this.queue.set(outBuf.subarray(0, HOP));
		this.qpos = 0;
	}
}

// The processors exist only in the audio worklet scope; tests import the DSP above.
if (typeof AudioWorkletProcessor === "function" && typeof registerProcessor === "function") {
	class MeterProcessor extends AudioWorkletProcessor {
		constructor() {
			super();
			this.sum = [0, 0];
			this.count = 0;
			this.window = Math.round(sampleRate * METER_SECONDS);
		}

		process(inputs, outputs) {
			const input = inputs[0];
			const output = outputs[0];
			if (!input || input.length === 0) return true;
			const channels = input.length;
			for (let c = 0; c < output.length; c++) output[c].set(input[Math.min(c, channels - 1)]);
			const frames = input[0].length;
			for (let c = 0; c < Math.min(2, channels); c++) {
				const x = input[c];
				let s = 0;
				for (let i = 0; i < frames; i++) s += x[i] * x[i];
				this.sum[c] += s;
			}
			this.count += frames;
			if (this.count >= this.window) {
				const db = (s) => (s > 0 ? 10 * Math.log10(s / this.count) : -120);
				const left = db(this.sum[0]);
				const right = channels > 1 ? db(this.sum[1]) : left;
				this.port.postMessage([left, right]);
				this.sum[0] = this.sum[1] = 0;
				this.count = 0;
			}
			return true;
		}
	}

	class DenoiseProcessor extends AudioWorkletProcessor {
		static get parameterDescriptors() {
			return [{ name: "amount", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
		}

		constructor() {
			super();
			this.channels = [];
			this.pending = [];
		}

		process(inputs, outputs, parameters) {
			const input = inputs[0];
			const output = outputs[0];
			if (!input || input.length === 0) return true;
			const amount = parameters.amount[0];
			const frames = input[0].length;
			for (let c = 0; c < output.length; c++) {
				const src = input[Math.min(c, input.length - 1)];
				let ch = this.channels[c];
				if (!ch) {
					ch = this.channels[c] = new DenoiseChannel();
					this.pending[c] = { buf: new Float32Array(HOP), n: 0 };
				}
				const pend = this.pending[c];
				const out = output[c];
				for (let i = 0; i < frames; i++) {
					pend.buf[pend.n++] = src[i];
					if (pend.n === HOP) { ch.frame(pend.buf, amount); pend.n = 0; }
					out[i] = ch.qpos < HOP ? ch.queue[ch.qpos++] : 0;
				}
			}
			return true;
		}
	}

	registerProcessor("zaideih-meter", MeterProcessor);
	registerProcessor("zaideih-denoise", DenoiseProcessor);
}

