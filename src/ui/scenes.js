/**
 * Now playing scenes: full-screen animations drawn with WebGL that follow the
 * music. Each frame the live analysis (core/visualizer.js) gives 64 band
 * energies and the loudness; from them come bass, mids, highs and a beat
 * pulse, passed to a fragment shader with the spectrum as a texture.
 *
 * Each song gets its own variation: a seed from the track id moves shapes,
 * speeds and the faint tint. "Auto" picks the scene from the album's cover
 * pattern (rings, weave or grooves) and the seed, so an album keeps a look.
 *
 * Long watching: time runs faster when the music is loud and slower when it
 * is quiet, and every scene drifts through its own slow variations, so no
 * two minutes look alike. When analysis is unavailable (iPhone, iPad) or the
 * song is paused, scenes keep a calm motion of their own. With reduced
 * motion requested, one still frame is drawn.
 *
 * Rendering is at a reduced resolution, scaled up by CSS, and drops further
 * when frames take too long, so phones stay smooth and cool.
 */
import { hash32 } from "../core/text.js";
import { visualizer } from "../core/visualizer.js";

const BANDS = 64;
const STORE_KEY = "zaideih.scene";

const PRELUDE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time, u_bass, u_mid, u_high, u_level, u_beat;
uniform vec3 u_seed, u_tint;
uniform sampler2D u_spec;
float spec(float x) { return texture2D(u_spec, vec2(clamp(x, 0.0, 1.0) * 0.97 + 0.015, 0.5)).r; }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
	float v = 0.0, a = 0.5;
	for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
	return v;
}
vec2 centered() { return (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y); }
vec3 base(vec2 uv) { return vec3(0.15) + vec3(0.06) * (1.0 - length(uv) * 0.9); }
vec3 finish(vec3 c, vec2 uv) {
	c *= 1.0 + 0.12 * u_beat;
	c = 1.0 - exp(-c * 1.15);                                    // soft highlights, no clipping
	c *= 1.0 - 0.35 * smoothstep(0.55, 1.25, length(uv));        // vignette
	c += (hash(gl_FragCoord.xy + fract(u_time) * 91.0) - 0.5) * 0.018; // fine grain
	return c;
}
`;

/* Concentric light: a ring that breathes with the bass and bends with the spectrum, ripples on beats. */
const HALO = `
void main() {
	vec2 uv = centered();
	float r = length(uv), a = atan(uv.y, uv.x);
	float t = u_time;
	float side = abs(fract(a / 6.2831853 + 0.25 + u_seed.x * 0.1) * 2.0 - 1.0);
	float s = spec(side);
	float wob = 0.012 * sin(a * (3.0 + floor(u_seed.y * 5.0)) + t * 0.7);
	float R = 0.26 + 0.07 * u_bass + 0.11 * s + wob;
	float ring = smoothstep(0.014, 0.0, abs(r - R)) * (0.55 + 0.9 * s);
	float glow = 0.022 / (abs(r - R) + 0.02) * (0.25 + 0.9 * u_level);
	float rip = 0.0;
	for (int i = 0; i < 7; i++) {
		float fi = float(i);
		float rr = fract(t * (0.07 + 0.02 * u_seed.z) + fi / 7.0) * 1.5;
		rip += smoothstep(0.018, 0.0, abs(r - rr - 0.01 * sin(a * 6.0 + fi))) * (1.0 - rr / 1.5) * (0.18 + 0.4 * u_mid);
	}
	float spokes = pow(abs(sin(a * (12.0 + floor(u_seed.x * 12.0)) + t * 0.2)), 40.0) * smoothstep(0.9, R, r) * smoothstep(R - 0.02, R + 0.08, r) * u_high * 1.4;
	float core = exp(-r * r * 22.0) * (0.15 + 0.8 * u_beat);
	vec3 c = base(uv) + u_tint * (ring + glow * 0.3 + rip + spokes + core);
	gl_FragColor = vec4(finish(c, uv), 1.0);
}`;

/* Northern light: slow, domain-warped curtains lifted by the mids, sparkling with the highs. */
const AURORA = `
void main() {
	vec2 uv = centered();
	vec2 p = uv * vec2(1.4, 1.1) + u_seed.xy * 10.0;
	float t = u_time * 0.12;
	vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
	vec2 w = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.4 * t + 0.6 * u_mid), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.3 * t));
	float f = fbm(p + 3.2 * w);
	float curtain = pow(abs(sin(p.x * 2.2 + w.x * 5.0 + t * 2.0)), 6.0);
	float lift = smoothstep(-0.7, 0.6, uv.y + 0.25 * w.y + 0.15 * u_bass);
	float light = (f * f * 0.9 + curtain * 0.4 * f) * lift * (0.28 + 0.9 * u_mid + 0.3 * u_level);
	float stars = step(0.997 - 0.004 * u_high, hash(floor(gl_FragCoord.xy * 0.5))) * (0.4 + u_high) * (1.0 - lift * 0.8);
	vec3 c = base(uv) + u_tint * light + vec3(stars);
	gl_FragColor = vec4(finish(c, uv), 1.0);
}`;

/* Ridgelines: lines of terrain shaped by the spectrum, flowing towards the viewer, front ridges hiding the back. */
const HORIZON = `
void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec2 cuv = centered();
	vec3 c = base(cuv);
	float px = 1.6 / u_res.y;
	const int N = 26;
	for (int i = 0; i < N; i++) {
		float fi = float(i) / float(N - 1);           // 0 = farthest (top), 1 = nearest (bottom)
		float y0 = mix(0.80, 0.14, fi);
		float edge = 1.0 - smoothstep(0.0, 0.42, abs(uv.x - 0.5));
		float n = fbm(vec2(uv.x * (5.0 + 3.0 * u_seed.x) + fi * 7.3, u_time * 0.25 + fi * 2.0 + u_seed.y * 9.0));
		float s = spec(abs(uv.x - 0.5) * 2.0);
		float amp = (0.015 + 0.07 * n * n + 0.16 * s * (0.4 + u_level)) * edge * (0.35 + fi * 0.9);
		float y = y0 + amp;
		if (uv.y < y) c = base(cuv) * (0.85 - 0.2 * fi);                        // the ridge hides what is behind it
		float line = smoothstep(px * (1.0 + fi), 0.0, abs(uv.y - y));
		c += u_tint * line * (0.35 + 0.65 * fi) * (0.6 + 0.6 * u_mid);
	}
	c += u_tint * exp(-pow((uv.y - 0.86) * 9.0, 2.0)) * (0.08 + 0.25 * u_beat);    // glow on the horizon
	gl_FragColor = vec4(finish(c, cuv), 1.0);
}`;

/* Warp: a tunnel of stars rushing past, faster with the loudness, flashing rings on beats. */
const TUNNEL = `
void main() {
	vec2 uv = centered();
	float r = max(length(uv), 0.0001), a = atan(uv.y, uv.x);
	float z = 0.35 / r + u_time * (0.6 + 0.4 * u_seed.x);
	float ang = a / 6.2831853 + 0.5;
	vec3 c = base(uv);
	for (int k = 0; k < 2; k++) {
		float fk = float(k);
		vec2 g = vec2(ang * (40.0 + fk * 23.0), z * (3.0 + fk * 2.0) + fk * 0.37);
		vec2 id = floor(g);
		vec2 f = fract(g) - 0.5;
		float h = hash(id + fk * 13.0);
		float star = smoothstep(0.12, 0.0, length(f * vec2(1.0, 0.18 + 0.5 * r))) * step(0.78 - 0.1 * u_high, h);
		c += u_tint * star * smoothstep(0.02, 0.5, r) * (0.5 + 0.9 * h) * (0.5 + u_level);
	}
	float rings = pow(abs(sin(z * 3.14159 * 1.5)), 30.0) * smoothstep(0.05, 0.6, r) * (0.06 + 0.5 * u_beat);
	float s = spec(abs(fract(ang + u_seed.y) * 2.0 - 1.0));
	float rim = smoothstep(0.02, 0.0, abs(r - (0.12 + 0.05 * u_bass + 0.05 * s))) * (0.4 + s);
	c += u_tint * (rings + rim) + vec3(exp(-r * 14.0) * (0.2 + 0.6 * u_bass));
	gl_FragColor = vec4(finish(c, uv), 1.0);
}`;

/* Weave: two sets of threads passing over and under, like woven cloth, swelling with the bass. */
const WEAVE = `
mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
void main() {
	vec2 uv = centered();
	float t = u_time * 0.08;
	vec2 p = rot(t * 0.6 + u_seed.x * 6.28) * uv * (7.0 + 3.0 * u_seed.y);
	p += vec2(sin(t * 2.0), cos(t * 1.7)) * 0.8;
	vec2 cell = floor(p);
	vec2 f = fract(p) - 0.5;
	float over = mod(cell.x + cell.y, 2.0);
	float w = 0.22 + 0.12 * u_bass + 0.05 * sin(t * 6.0 + cell.x * 0.7);
	float h = smoothstep(w, w - 0.06, abs(f.y));                  // horizontal thread
	float v = smoothstep(w, w - 0.06, abs(f.x));                  // vertical thread
	float shadeH = 0.55 + 0.45 * cos(f.x * 3.14159);
	float shadeV = 0.55 + 0.45 * cos(f.y * 3.14159);
	float s = spec(fract(length(cell) * 0.07 + t));
	float top = mix(h * shadeH, v * shadeV, over);
	float under = mix(v * shadeV, h * shadeH, over) * (1.0 - mix(h, v, over));
	float light = (top * (0.35 + 0.7 * s) + under * 0.18) * (0.25 + 0.6 * u_level);
	float pulse = smoothstep(0.6, 0.0, abs(length(uv) - fract(u_time * 0.1) * 1.4)) * u_beat * 0.4;
	vec3 c = base(uv) * 0.7 + u_tint * (light + pulse);
	gl_FragColor = vec4(finish(c, uv), 1.0);
}`;

export const SCENES = [
	{ id: "halo", name: "Halo", frag: HALO },
	{ id: "aurora", name: "Aurora", frag: AURORA },
	{ id: "horizon", name: "Horizon", frag: HORIZON },
	{ id: "tunnel", name: "Warp", frag: TUNNEL },
	{ id: "weave", name: "Weave", frag: WEAVE },
];
const AUTO_BY_PATTERN = { rings: ["halo", "aurora"], weave: ["weave", "halo"], grooves: ["horizon", "tunnel"] };

/** The listener's choice: "auto", "off" or a scene id. */
export function sceneChoice() {
	try {
		const v = localStorage.getItem(STORE_KEY);
		return v === "off" || v === "auto" || SCENES.some((s) => s.id === v) ? v : "auto";
	} catch {
		return "auto";
	}
}
export function setSceneChoice(value) {
	try { localStorage.setItem(STORE_KEY, value); } catch { /* the choice lasts this visit only */ }
}

/** The scene id for a track under a choice; null when scenes are off. */
export function sceneFor(track, pattern, choice = sceneChoice()) {
	if (choice === "off") return null;
	if (choice !== "auto") return choice;
	const options = AUTO_BY_PATTERN[pattern] ?? AUTO_BY_PATTERN.grooves;
	return options[hash32(String(track.album.id)) % options.length];
}

/* ---------------------------------------------------------------- engine ---- */

const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

function compile(gl, type, source) {
	const sh = gl.createShader(type);
	gl.shaderSource(sh, source);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`scene shader failed to compile: ${gl.getShaderInfoLog(sh)}`);
	return sh;
}

/** WebGL cannot be used in this browser; `message` says why and what to do. */
export class ScenesUnavailableError extends Error {
	constructor(message, detail = "", steps = []) {
		super(message);
		this.name = "ScenesUnavailableError";
		this.detail = detail;
		/** How to turn graphics acceleration on in this browser, one line per step. */
		this.steps = steps;
	}
}

/** One scene's shader does not build on this device's graphics; other scenes may. */
export class SceneBuildError extends Error {
	constructor(id, log) {
		super(`the "${id}" background could not be built on this device's graphics: ${log}`);
		this.name = "SceneBuildError";
		this.id = id;
	}
}

/** How to turn WebGL on, step by step, for the browser in use. */
export function enableSteps(ua = navigator.userAgent) {
	if (/Edg\//.test(ua)) return [
		"Open edge://settings/system",
		"Turn on \"Use graphics acceleration when available\"",
		"Restart Edge",
		"Still off? edge://gpu shows the reason next to WebGL",
	];
	if (/OPR\//.test(ua)) return [
		"Open opera://settings/system",
		"Turn on \"Use hardware acceleration when available\"",
		"Restart Opera",
	];
	if (/Chrome\//.test(ua)) return [
		"Open chrome://settings/system",
		"Turn on \"Use graphics acceleration when available\"",
		"Click Relaunch",
		"Still off? chrome://gpu shows the reason next to WebGL; updating the graphics driver often helps",
	];
	if (/Firefox\//.test(ua)) return [
		"Open Settings, General, Performance",
		"Turn on \"Use hardware acceleration when available\" (untick \"Use recommended performance settings\" to see it)",
		"Restart Firefox",
		"Still off? about:support shows the reason under WebGL",
	];
	if (/Safari\//.test(ua)) return [
		"WebGL is on in Safari unless turned off in Develop, Feature Flags",
		"Restart Safari after changing it",
	];
	return ["Turn on graphics (hardware) acceleration in the browser's settings", "Restart the browser"];
}

/**
 * Creates a stage on a canvas. Throws ScenesUnavailableError when WebGL is
 * unavailable (graphics acceleration turned off, the GPU blocked by the
 * browser), with the reason the browser gives and how to turn it on.
 */
export function createStage(canvas) {
	let reason = "";
	const onError = (e) => { reason = e.statusMessage || ""; };
	canvas.addEventListener("webglcontextcreationerror", onError);
	const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
	canvas.removeEventListener("webglcontextcreationerror", onError);
	if (!gl) throw new ScenesUnavailableError("Backgrounds need WebGL, which is turned off in this browser, usually because graphics acceleration is off. To turn it on:", reason, enableSteps());
	const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
	const programs = new Map();
	let buffer = null;
	let tex = null;
	const specBytes = new Uint8Array(BANDS);

	/** Buffers and the spectrum texture; again after the context is restored. */
	function init() {
		programs.clear();
		buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}
	init();
	let lost = false;

	function program(id) {
		let entry = programs.get(id);
		if (entry) return entry;
		const scene = SCENES.find((s) => s.id === id);
		if (!scene) throw new Error(`unknown scene "${id}"`);
		const prog = gl.createProgram();
		try {
			gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
			gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, PRELUDE + scene.frag));
		} catch (err) {
			throw new SceneBuildError(id, err.message);
		}
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new SceneBuildError(id, `link failed: ${gl.getProgramInfoLog(prog)}`);
		const u = {};
		for (const name of ["u_res", "u_time", "u_bass", "u_mid", "u_high", "u_level", "u_beat", "u_seed", "u_tint", "u_spec"]) u[name] = gl.getUniformLocation(prog, name);
		entry = { prog, u, attr: gl.getAttribLocation(prog, "p") };
		programs.set(id, entry);
		return entry;
	}

	const bands = new Float32Array(BANDS);
	const shown = new Float32Array(BANDS);
	const feat = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, avgBass: 0, lastBeat: 0 };
	let current = null;   // { id, seed, tint }
	let raf = 0;
	let running = false;
	let playing = false;
	let time = 0;
	let last = 0;
	let scale = Math.min(1, 1.25 / Math.max(1, devicePixelRatio || 1));
	let slow = 0;

	function resize() {
		const dpr = Math.min(2, devicePixelRatio || 1);
		const w = Math.max(1, Math.round(canvas.clientWidth * dpr * scale));
		const h = Math.max(1, Math.round(canvas.clientHeight * dpr * scale));
		if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
		gl.viewport(0, 0, w, h);
	}

	function analyse(dt) {
		const live = playing && visualizer.active;
		const level = live ? visualizer.read(bands) : 0;
		if (!live) {
			// No live analysis (paused, iPhone, iPad): a slow breathing of its own.
			const breath = playing ? 0.18 + 0.1 * Math.sin(time * 0.9) : 0.06;
			for (let i = 0; i < BANDS; i++) bands[i] = breath * (0.6 + 0.4 * Math.sin(time * 0.5 + i * 0.35)) * (1 - i / BANDS * 0.6);
		}
		const k = Math.min(1, dt * 8);
		for (let i = 0; i < BANDS; i++) shown[i] += (bands[i] - shown[i]) * (bands[i] > shown[i] ? Math.min(1, dt * 20) : k);
		const avg = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += shown[i]; return s / (to - from); };
		feat.bass = avg(0, 7);
		feat.mid = avg(7, 30);
		feat.high = avg(30, BANDS);
		feat.level += ((live ? level : feat.mid * 0.8) - feat.level) * Math.min(1, dt * 6);
		// A beat: the bass jumping clearly above its recent average.
		feat.avgBass += (feat.bass - feat.avgBass) * Math.min(1, dt * 1.5);
		if (feat.bass > feat.avgBass * 1.3 + 0.04 && feat.bass > 0.22 && time - feat.lastBeat > 0.28) {
			feat.beat = 1;
			feat.lastBeat = time;
		}
		feat.beat *= Math.exp(-dt * 5);
		for (let i = 0; i < BANDS; i++) specBytes[i] = Math.min(255, Math.round(shown[i] * 255));
	}

	function draw() {
		if (!current || lost) return;
		const p = program(current.id);
		resize();
		gl.useProgram(p.prog);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.enableVertexAttribArray(p.attr);
		gl.vertexAttribPointer(p.attr, 2, gl.FLOAT, false, 0, 0);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BANDS, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, specBytes);
		gl.uniform1i(p.u.u_spec, 0);
		gl.uniform2f(p.u.u_res, canvas.width, canvas.height);
		gl.uniform1f(p.u.u_time, time);
		gl.uniform1f(p.u.u_bass, feat.bass);
		gl.uniform1f(p.u.u_mid, feat.mid);
		gl.uniform1f(p.u.u_high, feat.high);
		gl.uniform1f(p.u.u_level, feat.level);
		gl.uniform1f(p.u.u_beat, feat.beat);
		gl.uniform3fv(p.u.u_seed, current.seed);
		gl.uniform3fv(p.u.u_tint, current.tint);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	function frame(now) {
		if (!running || lost) return;
		const dt = Math.min(0.1, (now - (last || now)) / 1000);
		last = now;
		// Loud passages move faster, quiet ones slower; a paused song drifts.
		time += dt * (playing ? 0.45 + 1.4 * feat.level : 0.12);
		analyse(dt);
		draw();
		// Keep frames under ~20 ms: lower the resolution when they run long.
		const cost = performance.now() - now;
		slow = cost > 20 || dt > 0.034 ? slow + 1 : Math.max(0, slow - 1);
		if (slow > 30 && scale > 0.4) { scale *= 0.8; slow = 0; }
		raf = requestAnimationFrame(frame);
	}

	// The browser can take the graphics context away (GPU reset, too many
	// contexts, a driver update); it comes back after "restored".
	canvas.addEventListener("webglcontextlost", (e) => {
		e.preventDefault(); // ask for it back
		lost = true;
		cancelAnimationFrame(raf);
		console.warn("the background's graphics context was lost; waiting for the browser to restore it");
	});
	canvas.addEventListener("webglcontextrestored", () => {
		lost = false;
		init();
		if (running) { last = 0; raf = requestAnimationFrame(frame); } else draw();
	});

	return {
		/** Shows a scene for a track; `id` null stops and clears it. Throws SceneBuildError for a scene this device cannot build. */
		show(id, track) {
			if (!id) { this.stop(); current = null; return; }
			const h = hash32(`scene:${track.id}`);
			const seed = [(h & 1023) / 1023, ((h >>> 10) & 1023) / 1023, ((h >>> 20) & 1023) / 1023];
			// A faint tint per song around the silver accent: low saturation keeps the graphite look.
			const hue = seed[0] * Math.PI * 2;
			const sat = 0.1 + 0.08 * seed[1];
			const tint = [0, 2.094, 4.189].map((o) => 0.92 + sat * Math.cos(hue + o));
			if (!lost) program(id); // builds the shader first, so a failure leaves the current scene as it is
			if (current?.id !== id || current?.track !== track.id) time = seed[2] * 100;
			current = { id, track: track.id, seed, tint };
			if (reduceMotion.matches) { this.stop(); analyse(0.016); draw(); } else this.start();
		},
		setPlaying(on) { playing = on; },
		start() {
			if (running || !current || reduceMotion.matches) return;
			running = true;
			last = 0;
			raf = requestAnimationFrame(frame);
		},
		stop() {
			running = false;
			cancelAnimationFrame(raf);
		},
		/** True while the animation loop runs. */
		get active() { return running; },
	};
}
