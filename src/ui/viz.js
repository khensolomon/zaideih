/**
 * Draws the live frequency bars on every visible canvas[data-viz] and sets
 * --level (loudness, 0..1) on the player deck for the play-button glow.
 *
 * The loop runs only while audio plays and the page is visible; after a pause
 * the bars fall to rest and the loop stops. With reduced motion requested, or
 * where live analysis is unavailable, nothing animates.
 */
import { visualizer } from "../core/visualizer.js";

const BAR_COUNT = { deck: 64, large: 40 };
const FALL = 0.06;

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const state = new Map(); // canvas -> { bars, peaks, kind }
let running = false;
let playing = false;
let levelSmooth = 0;
let deck = null;

function sizeCanvas(canvas) {
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const w = Math.round(canvas.clientWidth * dpr);
	const h = Math.round(canvas.clientHeight * dpr);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	return { w, h, dpr };
}

function entryFor(canvas) {
	let e = state.get(canvas);
	if (!e) {
		const kind = canvas.dataset.viz in BAR_COUNT ? canvas.dataset.viz : "deck";
		e = { kind, bars: new Float32Array(BAR_COUNT[kind]), shown: new Float32Array(BAR_COUNT[kind]) };
		state.set(canvas, e);
	}
	return e;
}

/**
 * Deck: bars radiate outwards from the play button, low frequencies at the
 * centre and higher ones towards the edges, tapering so text stays readable.
 * Large (now playing view): a plain spectrum, low to high.
 */
function draw(canvas, e, hue, centerX) {
	const { w, h, dpr } = sizeCanvas(canvas);
	const g = canvas.getContext("2d");
	g.clearRect(0, 0, w, h);
	if (!w || !h) return;
	const n = e.shown.length;

	if (e.kind === "deck") {
		const bw = 3 * dpr;
		const step = bw + 3 * dpr;
		const cx = Math.round((centerX ?? 0.5 * w / dpr) * dpr);
		const span = Math.max(cx, w - cx);
		const count = Math.ceil(span / step);
		const grad = g.createLinearGradient(0, h, 0, 0);
		grad.addColorStop(0, `hsl(${hue} 90% 66% / 0.6)`);
		grad.addColorStop(0.55, `hsl(${hue} 95% 78% / 0.22)`);
		grad.addColorStop(1, `hsl(${hue} 95% 85% / 0)`);
		g.fillStyle = grad;
		const radius = bw / 2;
		for (let k = 0; k < count; k++) {
			const t = k / count;
			const v = e.shown[Math.min(n - 1, Math.floor(t * n))] * (1 - t * 0.55);
			const bh = v * h * 0.86;
			if (bh < 1) continue;
			for (const x of [cx + k * step + 1.5 * dpr, cx - (k + 1) * step + 1.5 * dpr]) {
				if (x < -bw || x > w) continue;
				g.beginPath();
				g.roundRect ? g.roundRect(x, h - bh, bw, bh, [radius, radius, 0, 0]) : g.rect(x, h - bh, bw, bh);
				g.fill();
			}
		}
		return;
	}

	const gap = Math.max(1, Math.round(4 * dpr));
	const bw = (w - gap * (n - 1)) / n;
	const grad = g.createLinearGradient(0, h, 0, 0);
	grad.addColorStop(0, `hsl(${hue} 60% 38%)`);
	grad.addColorStop(1, `hsl(${hue} 90% 68%)`);
	g.fillStyle = grad;
	const radius = Math.min(bw / 2, 3 * dpr);
	for (let i = 0; i < n; i++) {
		const bh = Math.max(2 * dpr, e.shown[i] * h);
		const x = i * (bw + gap);
		g.beginPath();
		g.roundRect ? g.roundRect(x, h - bh, bw, bh, [radius, radius, 0, 0]) : g.rect(x, h - bh, bw, bh);
		g.fill();
	}
}

function frame() {
	const level = playing ? visualizer.read(scratch) : 0;
	const hue = Number.parseFloat(getComputedStyle(deck).getPropertyValue("--h")) || 352;
	// Deck bars radiate from the visible play button.
	const btn = deck.querySelector(".play-btn");
	const deckRect = deck.getBoundingClientRect();
	const btnRect = btn?.getBoundingClientRect();
	const centerX = btnRect && btnRect.width ? btnRect.left + btnRect.width / 2 - deckRect.left : undefined;
	let moving = playing;
	for (const canvas of document.querySelectorAll("canvas[data-viz]")) {
		if (!canvas.offsetParent && canvas.getClientRects().length === 0) continue;
		const e = entryFor(canvas);
		const n = e.bars.length;
		for (let i = 0; i < n; i++) {
			// Resample the shared band energies to this canvas's bar count.
			const src = scratch[Math.min(scratch.length - 1, Math.floor((i / n) * scratch.length))];
			const target = playing ? src : 0;
			e.shown[i] = target > e.shown[i] ? target : Math.max(target, e.shown[i] - FALL);
			if (e.shown[i] > 0.002) moving = true;
		}
		draw(canvas, e, hue, e.kind === "deck" ? centerX : undefined);
	}
	levelSmooth = level > levelSmooth ? level : Math.max(level, levelSmooth - 0.04);
	deck?.style.setProperty("--level", levelSmooth.toFixed(3));
	if (levelSmooth > 0.002) moving = true;
	if (moving && document.visibilityState === "visible") requestAnimationFrame(frame);
	else running = false;
}

const scratch = new Float32Array(BAR_COUNT.deck);

function start() {
	if (running || reduceMotion.matches || visualizer.unavailable) return;
	running = true;
	requestAnimationFrame(frame);
}

export const viz = {
	init(deckEl) {
		deck = deckEl;
		document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && playing) start(); });
		reduceMotion.addEventListener?.("change", () => { if (!reduceMotion.matches && playing) start(); });
		if (visualizer.unavailable) deck.dataset.vizOff = visualizer.unavailable;
	},
	/** Call when playback starts or stops. */
	setPlaying(on) {
		playing = on;
		if (on) start();
		else if (!running && !reduceMotion.matches && !visualizer.unavailable) {
			running = true;
			requestAnimationFrame(frame); // let the bars fall to rest
		}
	},
};
