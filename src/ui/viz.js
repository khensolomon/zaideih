/**
 * Draws the live frequency bars on every visible canvas[data-viz] and sets
 * --level (loudness, 0..1) on the player deck for the play-button glow.
 *
 * The loop runs only while audio plays and the page is visible. Pausing
 * freezes the bars and the glow where the music left them; they move again
 * on resume. With reduced motion requested, or where live analysis is
 * unavailable, nothing animates.
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
let progress = 0;

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
function draw(canvas, e, color, centerX) {
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
		grad.addColorStop(0, `rgb(${color} / 0.2)`);
		grad.addColorStop(0.55, `rgb(${color} / 0.07)`);
		grad.addColorStop(1, `rgb(${color} / 0)`);
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

	// Large: the bars sit on the progress bar; the played part uses the accent.
	const gap = Math.max(1, Math.round(3 * dpr));
	const bw = (w - gap * (n - 1)) / n;
	const radius = Math.min(bw / 2, 2 * dpr);
	for (let i = 0; i < n; i++) {
		const bh = Math.max(2 * dpr, e.shown[i] * h);
		const x = i * (bw + gap);
		g.fillStyle = (i + 0.5) / n <= progress ? `rgb(${color})` : `rgb(255 255 255 / 0.22)`;
		g.beginPath();
		g.roundRect ? g.roundRect(x, h - bh, bw, bh, [radius, radius, 0, 0]) : g.rect(x, h - bh, bw, bh);
		g.fill();
	}
}

function geometry() {
	// --viz-rgb: the accent as "r g b", set in app.css.
	const color = getComputedStyle(deck).getPropertyValue("--viz-rgb").trim() || "236 236 236";
	// Deck bars radiate from the visible play button.
	const btn = deck.querySelector(".play-btn");
	const deckRect = deck.getBoundingClientRect();
	const btnRect = btn?.getBoundingClientRect();
	const centerX = btnRect && btnRect.width ? btnRect.left + btnRect.width / 2 - deckRect.left : undefined;
	return { color, centerX };
}

function visibleCanvases() {
	return [...document.querySelectorAll("canvas[data-viz]")].filter((c) => c.getClientRects().length > 0);
}

/** Resamples the shared band energies onto a canvas's own bar count. */
function resample(e) {
	const n = e.bars.length;
	for (let i = 0; i < n; i++) e.bars[i] = scratch[Math.min(scratch.length - 1, Math.floor((i / n) * scratch.length))];
}

function frame() {
	// Paused: stop here and leave the last frame (and the glow) where it is.
	if (!playing) {
		running = false;
		return;
	}
	const level = visualizer.read(scratch);
	const { color, centerX } = geometry();
	for (const canvas of visibleCanvases()) {
		const e = entryFor(canvas);
		resample(e);
		for (let i = 0; i < e.bars.length; i++) {
			const target = e.bars[i];
			e.shown[i] = target > e.shown[i] ? target : Math.max(target, e.shown[i] - FALL);
		}
		draw(canvas, e, color, e.kind === "deck" ? centerX : undefined);
	}
	levelSmooth = level > levelSmooth ? level : Math.max(level, levelSmooth - 0.04);
	deck.style.setProperty("--level", levelSmooth.toFixed(3));
	if (document.visibilityState === "visible") requestAnimationFrame(frame);
	else running = false;
}

/**
 * Redraws the frozen frame without reading audio: after a resize (which
 * clears canvases) or when a canvas appears while paused (Now playing view).
 */
function redrawStill() {
	if (running) return;
	const { color, centerX } = geometry();
	const deckEntry = [...state.entries()].find(([c, e]) => e.kind === "deck" && c.isConnected)?.[1];
	for (const canvas of visibleCanvases()) {
		const fresh = !state.has(canvas);
		const e = entryFor(canvas);
		if (fresh && deckEntry) {
			// Borrow the frozen deck shape, resampled to this canvas's bar count.
			const n = e.shown.length;
			for (let i = 0; i < n; i++) e.shown[i] = deckEntry.shown[Math.min(deckEntry.shown.length - 1, Math.floor((i / n) * deckEntry.shown.length))];
		}
		draw(canvas, e, color, e.kind === "deck" ? centerX : undefined);
	}
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
		let resizeTimer = 0;
		addEventListener("resize", () => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(redrawStill, 60);
		});
	},
	/** Draws the frozen frame on canvases that appeared while paused. */
	refresh() { requestAnimationFrame(redrawStill); },
	/** Playback position, 0..1, for colouring the bars over the played part. */
	setProgress(p) {
		const changed = Math.abs(p - progress) > 0.002;
		progress = p;
		if (changed && !running) requestAnimationFrame(redrawStill);
	},
	/** Call when playback starts or stops. Pausing freezes the bars in place. */
	setPlaying(on) {
		playing = on;
		if (on) start();
	},
};
