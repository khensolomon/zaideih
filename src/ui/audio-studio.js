/**
 * The audio studio (docs/audio-studio.md): a song's recording trimmed at its
 * start and end, for the owner, co-owners and the Audio studio right.
 *
 *   #/audio/<track>
 *
 * The page reads the original (version 0, never changed) and draws it: the
 * whole song, and close up around the start and the end. It suggests where
 * the music starts and ends (core/trim.js, from the tape's own noise floor);
 * the handles are dragged, or the times typed, and each cut is moved to the
 * quietest moment nearby, where it is not heard. What stays and what goes is
 * played before saving; saving asks once more, with what changes.
 *
 * Saved, the audio Worker cuts the original without decoding it (no loss,
 * worker/media/mp3.js) into a new version that plays at once for everyone:
 * no release. The saved file itself is played back from the Worker. Every
 * version stays, and any of them, or the original, can be made the one that
 * plays again.
 */
import { audioUrl } from "../config.js";
import { creditOf } from "../core/catalog.js";
import { editsUrl } from "../core/audio-edits.js";
import { html } from "../core/html.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { clock, envelope, parseClock, quietest, suggestTrim, WINDOW_MS } from "../core/trim.js";
import { icon } from "./icons.js";
import { scriptClass } from "./parts.js";

/** How much a close-up shows on each side of its cut. */
const NEAR_MS = 6000;
/** What a "play" of an edge lasts. */
const PREVIEW_MS = 6000;
const SNAP_MS = 150;

class StudioError extends Error {}

async function call(method, path, body) {
	const base = editsUrl();
	if (!base) throw new StudioError("the audio studio is not available in this version of the app");
	const send = (token) => fetch(`${base}${path}`, {
		method,
		headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
		cache: "no-store",
	});
	let res;
	try {
		res = await account().send(send);
	} catch (err) {
		throw new StudioError(navigator.onLine === false ? "you are offline; try again when you are back online" : `the audio Worker could not be reached (${err.message})`);
	}
	const answer = await res.json().catch(() => null);
	if (!res.ok) throw new StudioError(answer?.error ?? `HTTP ${res.status}`);
	return answer;
}

/** The address of `version` of the song (0: the original). */
function versionUrl(track, version) {
	const u = new URL(audioUrl(track), location.href);
	u.searchParams.set("v", String(version));
	return u.href;
}

let st = null;

export function audioStudio(catalog, id, ctx) {
	const t = catalog.track(id);
	const page = (title, body) => ({ title, body: html`<div class="as-root">${body}</div>` });
	if (!t || t.upload) return page("Audio studio", html`<div class="empty"><h2>No such song in the catalog</h2></div>`);
	if (!account().signedIn || !ctx.canAudio()) {
		return page("Audio studio", html`<div class="empty"><h2>The audio studio needs the Audio studio right</h2><p>The owner and co-owners have it, and give it to members in the Workspace, Members.</p><p><a class="btn" href="${href(`album/${t.album.id}`, { song: t.id })}">Back to the album</a></p></div>`);
	}
	st = { t, ctx, detail: null, buffer: null, levels: null, totalMs: 0, start: 0, end: 0, hint: null, snap: true, note: "", saving: false, playing: null, progress: 0, error: "", savedPlay: null };
	return {
		title: `Audio studio: ${t.title}`,
		body: html`<div class="as-root">${draw()}</div>`,
		mount: (view) => mount(view.querySelector(".as-root"), ctx),
	};
}

/* ------------------------------------------------------------- page ---- */

const currentCut = () => {
	const v = st.detail?.versions.find((x) => x.version === st.detail.current);
	return v ? { start: v.startMs, end: v.endMs } : { start: 0, end: st.totalMs };
};
const changed = () => {
	const c = currentCut();
	return Math.abs(st.start - c.start) > WINDOW_MS || Math.abs(st.end - c.end) > WINDOW_MS;
};

function head() {
	const t = st.t;
	const playing = st.detail ? (st.detail.current ? `Version ${st.detail.current} plays` : "The original plays") : "";
	const blocked = !st.buffer || st.saving || !changed() || st.end - st.start < 1000;
	return html`<header class="st-head">
		<a class="st-icon" href="${href(`album/${t.album.id}`, { song: t.id })}" aria-label="Back to the album" title="Back to the album">${icon("back")}</a>
		<div class="st-title"><b class="${scriptClass(t.title)}">${t.title}</b><span>Audio studio${playing ? ` · ${playing}` : ""}</span></div>
		<button class="st-save" data-as="save" aria-label="Save this cut as a new version" title="${blocked ? "Nothing to save yet" : "Save this cut as a new version"}" ${blocked ? "disabled" : ""}>${icon("check")}</button>
	</header>`;
}

function draw() {
	const t = st.t;
	if (st.error) return html`${head()}<div class="st-page"><p class="error" role="alert">${st.error}</p></div>`;
	if (!st.buffer) {
		return html`${head()}<div class="st-page"><p class="muted" aria-busy="true">Reading the original recording${st.progress ? ` … ${Math.round(st.progress * 100)} %` : "…"}</p></div>`;
	}
	const kept = st.end - st.start;
	const c = currentCut();
	return html`${head()}<div class="st-page as-page">
		<div class="st-banner"><p>The original is never changed. A saved cut is a new version, played at once by everyone; every version, and the original, can be made the one that plays again.</p></div>
		<p class="as-facts muted">${creditOf(t.artists)} · ${t.album.title} · the original is ${clock(st.totalMs)}</p>
		<div class="as-whole">
			<canvas class="as-canvas" data-as="whole" height="120" aria-label="The whole recording: drag the handles to set where it starts and ends"></canvas>
		</div>
		<div class="as-near">
			${edge("start")}
			${edge("end")}
		</div>
		<div class="as-sum">
			<p><b>Cuts ${clock(st.start)} at the start and ${clock(st.totalMs - st.end)} at the end.</b> The song becomes ${clock(kept)}${c.start || c.end !== st.totalMs ? ` (now ${clock(c.end - c.start)})` : ""}.</p>
			<div class="as-tools">
				${st.hint ? html`<button class="btn" data-as="hint">${icon("reload")} Use the suggestion (${clock(st.hint.startMs)} to ${clock(st.hint.endMs)})</button>` : ""}
				<button class="btn" data-as="whole-cut">Back to the whole recording</button>
				<label class="check"><input type="checkbox" data-as="snap" ${st.snap ? "checked" : ""}> Move each cut to the quietest moment nearby</label>
			</div>
			<label class="sb-field as-note"><span>A note for the history (optional)</span><input data-as="note" maxlength="300" value="${st.note}" placeholder="Wind at the start, tape run-out at the end"></label>
			<p><button class="btn primary" data-as="save" ${!changed() || st.saving || kept < 1000 ? "disabled" : ""}>${icon("check")} ${st.saving ? "Saving…" : "Save as a new version"}</button></p>
		</div>
		${versions()}
	</div>`;
}

function edge(which) {
	const at = which === "start" ? st.start : st.end;
	return html`<section class="as-edge panel" data-edge="${which}">
		<header><b>${which === "start" ? "Start" : "End"}</b>
			<label class="as-time"><input data-as="time" data-edge="${which}" value="${clock(at)}" inputmode="decimal" aria-label="${which === "start" ? "Where the song starts" : "Where the song ends"}, minutes:seconds"></label>
			<span class="as-nudge">
				<button class="icon-btn" data-as="nudge" data-edge="${which}" data-by="-100" aria-label="0.1 second earlier" title="0.1 second earlier">−</button>
				<button class="icon-btn" data-as="nudge" data-edge="${which}" data-by="100" aria-label="0.1 second later" title="0.1 second later">+</button>
			</span>
		</header>
		<canvas class="as-canvas" data-as="near" data-edge="${which}" height="110" aria-label="Close up around the ${which}: drag to move it"></canvas>
		<div class="as-plays">
			${which === "start"
				? html`<button class="btn" data-as="play" data-from="${Math.max(0, at - 5000)}" data-to="${at}">${icon("play")} What is cut</button><button class="btn" data-as="play" data-from="${at}" data-to="${at + PREVIEW_MS}">${icon("play")} How it starts</button>`
				: html`<button class="btn" data-as="play" data-from="${Math.max(0, at - PREVIEW_MS)}" data-to="${at}">${icon("play")} How it ends</button><button class="btn" data-as="play" data-from="${at}" data-to="${Math.min(st.totalMs, at + 5000)}">${icon("play")} What is cut</button>`}
		</div>
	</section>`;
}

function versions() {
	const d = st.detail;
	if (!d) return "";
	const row = (v, label, sub) => html`<li class="${v === d.current ? "on" : ""}">
		<span><span class="as-v-title"><b>${label}</b>${v === d.current ? html`<span class="as-now">plays now</span>` : ""}</span><small>${sub}</small></span>
		<span class="as-row-do">
			<button class="btn" data-as="hear" data-v="${v}">${icon(st.savedPlay === v ? "pause" : "play")} ${st.savedPlay === v ? "Stop" : "Listen"}</button>
			${v === d.current ? "" : html`<button class="btn" data-as="restore" data-v="${v}">Make it the one played</button>`}
		</span>
	</li>`;
	return html`<section class="section as-versions"><header><h2>Versions</h2></header>
		<p class="muted">Listen plays the file itself, as the Worker serves it.</p>
		<ol class="sb-list">
			${d.versions.map((v) => row(v.version, `Version ${v.version}`, `${clock(v.startMs)} to ${clock(v.endMs)} of the original, ${clock(v.durationMs)} · ${v.by}, ${new Date(v.at * 1000).toLocaleDateString()}${v.note ? ` · ${v.note}` : ""}`))}
			${row(0, "The original", `${clock(st.totalMs)}, as it was added`)}
		</ol>
	</section>`;
}

/* ---------------------------------------------------------- drawing ---- */

/** Peaks (min, max) of the mono mix in `bins` steps between two times. */
function peaks(fromMs, toMs, bins) {
	const b = st.buffer;
	const rate = b.sampleRate;
	const chans = [...Array(b.numberOfChannels).keys()].map((k) => b.getChannelData(k));
	const from = Math.max(0, Math.floor((fromMs / 1000) * rate));
	const to = Math.min(b.length, Math.ceil((toMs / 1000) * rate));
	const step = Math.max(1, (to - from) / bins);
	const out = new Float32Array(bins * 2);
	for (let i = 0; i < bins; i++) {
		let lo = 0;
		let hi = 0;
		const s0 = Math.floor(from + i * step);
		const s1 = Math.min(to, Math.floor(from + (i + 1) * step));
		// Long stretches: every few samples are enough for the shape.
		const stride = Math.max(1, Math.floor((s1 - s0) / 400));
		for (let s = s0; s < s1; s += stride) {
			let v = 0;
			for (const c of chans) v += c[s];
			v /= chans.length;
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		out[i * 2] = lo;
		out[i * 2 + 1] = hi;
	}
	return out;
}

const cache = new Map();
/** A sample's height on the drawing: its level from -60 dB (nothing) to 0 dB (full). */
const scale = (v) => (v <= 0.001 ? 0 : Math.min(1, (20 * Math.log10(v) + 60) / 60));

function paint(canvas) {
	const which = canvas.dataset.as === "whole" ? "whole" : canvas.dataset.edge;
	const dpr = devicePixelRatio || 1;
	const w = Math.max(100, Math.round(canvas.clientWidth * dpr));
	const h = Math.round(canvas.clientHeight * dpr);
	if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
	const range = rangeOf(which);
	const key = `${which}:${w}:${range[0]}:${range[1]}`;
	let p = cache.get(key);
	if (!p) {
		p = peaks(range[0], range[1], w);
		for (const k of cache.keys()) if (k.startsWith(`${which}:`)) cache.delete(k);
		cache.set(key, p);
	}
	const g = canvas.getContext("2d");
	const css = getComputedStyle(document.documentElement);
	const accent = css.getPropertyValue("--accent").trim() || "#ececec";
	g.clearRect(0, 0, w, h);
	const x = (ms) => ((ms - range[0]) / (range[1] - range[0])) * w;
	// What goes, shaded; what stays, plain.
	g.fillStyle = "rgb(0 0 0 / 0.28)";
	g.fillRect(0, 0, Math.max(0, x(st.start)), h);
	g.fillRect(Math.min(w, x(st.end)), 0, w, h);
	const mid = h / 2;
	for (let i = 0; i < w; i++) {
		const ms = range[0] + (i / w) * (range[1] - range[0]);
		const inside = ms >= st.start && ms <= st.end;
		g.fillStyle = inside ? "rgb(255 255 255 / 0.78)" : "rgb(255 255 255 / 0.3)";
		// On a level scale (60 dB to full), so the tape's hiss before and after the music shows.
		const lo = -scale(-p[i * 2]) * mid * 0.95;
		const hi = scale(p[i * 2 + 1]) * mid * 0.95;
		g.fillRect(i, mid - hi, 1, Math.max(1, hi - lo));
	}
	// The tape's floor and the music's threshold, on the close-ups.
	if (which !== "whole" && st.hint) {
		const y = (db) => mid - Math.max(0, (db + 60) / 60) * mid * 0.95;
		g.strokeStyle = "rgb(255 255 255 / 0.18)";
		g.setLineDash([4 * dpr, 4 * dpr]);
		g.beginPath(); g.moveTo(0, y(st.hint.thresholdDb)); g.lineTo(w, y(st.hint.thresholdDb)); g.stroke();
		g.setLineDash([]);
	}
	// The handles.
	for (const ms of [st.start, st.end]) {
		const hx = x(ms);
		if (hx < -2 || hx > w + 2) continue;
		g.fillStyle = accent;
		g.fillRect(Math.round(hx) - dpr, 0, 2 * dpr, h);
		g.beginPath(); g.arc(hx, 8 * dpr, 6 * dpr, 0, Math.PI * 2); g.fill();
		g.beginPath(); g.arc(hx, h - 8 * dpr, 6 * dpr, 0, Math.PI * 2); g.fill();
	}
	// Where the preview plays.
	if (st.playing) {
		const px = x(st.playing.at);
		if (px >= 0 && px <= w) {
			g.fillStyle = "rgb(255 255 255 / 0.9)";
			g.fillRect(Math.round(px), 0, dpr, h);
		}
	}
	// Times under the whole recording.
	if (which === "whole") {
		g.fillStyle = "rgb(255 255 255 / 0.5)";
		g.font = `${11 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
		const step = st.totalMs > 240000 ? 60000 : 30000;
		for (let ms = step; ms < st.totalMs; ms += step) {
			g.fillRect(x(ms), h - 4 * dpr, 1, 4 * dpr);
			g.fillText(clock(ms).replace(/\.0$/, ""), x(ms) + 3 * dpr, h - 6 * dpr);
		}
	}
}

/** The times a canvas shows: the whole song, or a close-up around its cut. */
function rangeOf(which) {
	if (which === "whole") return [0, st.totalMs];
	// While its cut is dragged, a close-up holds still.
	if (st.held?.which === which) return st.held.range;
	const at = which === "start" ? st.start : st.end;
	// The close-up follows its cut, in steps, so dragging inside it does not move it under the pointer.
	const centre = Math.round(at / 2000) * 2000;
	return [Math.max(0, centre - NEAR_MS), Math.min(st.totalMs, centre + NEAR_MS)];
}

function paintAll(root) {
	for (const c of root.querySelectorAll("canvas.as-canvas")) paint(c);
}

/* -------------------------------------------------------- listening ---- */

let audioCtx = null;
let hearing = null;

function stop() {
	if (st?.playing) {
		try { st.playing.node.stop(); } catch { /* ended */ }
		st.playing = null;
	}
}

function playRange(root, fromMs, toMs) {
	stop();
	stopHearing(root);
	if (player.state.playing) player.pause();
	audioCtx ??= new AudioContext();
	audioCtx.resume();
	const node = audioCtx.createBufferSource();
	node.buffer = st.buffer;
	node.connect(audioCtx.destination);
	const from = Math.max(0, fromMs);
	const to = Math.min(st.totalMs, Math.max(from + 100, toMs));
	node.start(0, from / 1000, (to - from) / 1000);
	const began = audioCtx.currentTime;
	st.playing = { node, from, to, at: from };
	node.onended = () => { if (st.playing?.node === node) { st.playing = null; paintAll(root); } };
	const tick = () => {
		if (!st.playing || st.playing.node !== node || !root.isConnected) return;
		st.playing.at = from + (audioCtx.currentTime - began) * 1000;
		paintAll(root);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

function stopHearing(root) {
	if (hearing) {
		hearing.pause();
		hearing = null;
	}
	if (st.savedPlay !== null) {
		st.savedPlay = null;
		redraw(root);
	}
}

/** Plays version `v` as the Worker serves it: the saved file itself. */
function hear(root, v) {
	if (st.savedPlay === v) { stopHearing(root); return; }
	stop();
	stopHearing(root);
	if (player.state.playing) player.pause();
	hearing = new Audio(versionUrl(st.t, v));
	hearing.play().catch((err) => st.ctx.notify(`Version ${v} could not be played: ${err.message}`, { kind: "error" }));
	hearing.onended = () => stopHearing(root);
	st.savedPlay = v;
	redraw(root);
}

/* ------------------------------------------------------------ mount ---- */

function redraw(root) {
	if (!root.isConnected) return;
	const focused = document.activeElement?.dataset?.as === "note" ? "note" : null;
	root.innerHTML = draw();
	if (focused) {
		const n = root.querySelector("[data-as=note]");
		n.focus();
		n.setSelectionRange(n.value.length, n.value.length);
	}
	if (st.buffer) paintAll(root);
}

function setEdge(which, ms) {
	const at = Math.round(Math.min(st.totalMs, Math.max(0, ms)));
	if (which === "start") st.start = Math.min(at, st.end - 1000);
	else st.end = Math.max(at, st.start + 1000);
}

const snapped = (ms) => (st.snap ? quietest(st.levels, ms, SNAP_MS) : ms);

async function read(root) {
	const t = st.t;
	try {
		const detail = await call("GET", `/${t.id}`);
		st.detail = detail;
		const res = await fetch(versionUrl(t, 0), { mode: "cors", credentials: "omit" });
		if (!res.ok) throw new StudioError(`the original recording could not be read (HTTP ${res.status})`);
		const total = Number(res.headers.get("content-length")) || 0;
		const reader = res.body.getReader();
		const chunks = [];
		let got = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			got += value.byteLength;
			if (total) { st.progress = got / total; redraw(root); }
		}
		const bytes = new Uint8Array(got);
		let at = 0;
		for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
		audioCtx ??= new AudioContext();
		const buffer = await audioCtx.decodeAudioData(bytes.buffer);
		const chans = [...Array(buffer.numberOfChannels).keys()].map((k) => buffer.getChannelData(k));
		st.buffer = buffer;
		st.totalMs = Math.round(buffer.duration * 1000);
		st.levels = envelope(chans, buffer.sampleRate);
		st.hint = suggestTrim(st.levels);
		const c = currentCut();
		// A song never cut opens on the suggestion; one cut before, on its cut.
		if (detail.current) { st.start = c.start; st.end = c.end; } else { st.start = st.hint.startMs; st.end = st.hint.endMs; }
	} catch (err) {
		st.error = err instanceof StudioError ? err.message : `The recording could not be opened: ${err.message}`;
	}
	redraw(root);
}

function mount(root, ctx) {
	const mine = st;
	read(root);
	// Dragging a handle, on the whole recording or a close-up.
	let drag = null;
	const timeAt = (canvas, clientX) => {
		const r = canvas.getBoundingClientRect();
		const range = rangeOf(canvas.dataset.as === "whole" ? "whole" : canvas.dataset.edge);
		return range[0] + ((clientX - r.left) / r.width) * (range[1] - range[0]);
	};
	root.addEventListener("pointerdown", (e) => {
		const canvas = e.target.closest?.("canvas.as-canvas");
		if (!canvas || !st.buffer) return;
		const ms = timeAt(canvas, e.clientX);
		const r = canvas.getBoundingClientRect();
		const range = rangeOf(canvas.dataset.as === "whole" ? "whole" : canvas.dataset.edge);
		const px = (t) => r.left + ((t - range[0]) / (range[1] - range[0])) * r.width;
		let which = canvas.dataset.edge ?? null;
		if (!which) {
			// On the whole recording: the nearer handle, when within reach; else a listen from there.
			const ds = Math.abs(px(st.start) - e.clientX);
			const de = Math.abs(px(st.end) - e.clientX);
			which = Math.min(ds, de) <= 14 ? (ds <= de ? "start" : "end") : null;
			if (!which) { playRange(root, ms, ms + PREVIEW_MS); return; }
		}
		drag = { canvas, which };
		if (canvas.dataset.edge) st.held = { which, range: rangeOf(which) };
		canvas.setPointerCapture(e.pointerId);
		setEdge(which, ms);
		paintAll(root);
	});
	root.addEventListener("pointermove", (e) => {
		if (!drag) return;
		setEdge(drag.which, timeAt(drag.canvas, e.clientX));
		paintAll(root);
	});
	root.addEventListener("pointerup", () => {
		if (!drag) return;
		const which = drag.which;
		drag = null;
		st.held = null;
		setEdge(which, snapped(which === "start" ? st.start : st.end));
		redraw(root);
	});
	root.addEventListener("change", (e) => {
		const el = e.target;
		if (el.dataset.as === "snap") { st.snap = el.checked; return; }
		if (el.dataset.as === "time") {
			const ms = parseClock(el.value);
			if (Number.isNaN(ms)) { ctx.notify("Write the time as minutes:seconds, such as 0:12.4", { kind: "error" }); redraw(root); return; }
			setEdge(el.dataset.edge, snapped(ms));
			redraw(root);
		}
	});
	root.addEventListener("input", (e) => {
		if (e.target.dataset.as === "note") st.note = e.target.value;
	});
	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-as]");
		if (!b || b.tagName === "CANVAS" || b.tagName === "INPUT") return;
		const what = b.dataset.as;
		if (what === "play") playRange(root, Number(b.dataset.from), Number(b.dataset.to));
		else if (what === "nudge") { setEdge(b.dataset.edge, (b.dataset.edge === "start" ? st.start : st.end) + Number(b.dataset.by)); redraw(root); }
		else if (what === "hint") { st.start = st.hint.startMs; st.end = st.hint.endMs; redraw(root); }
		else if (what === "whole-cut") { st.start = 0; st.end = st.totalMs; redraw(root); }
		else if (what === "hear") hear(root, Number(b.dataset.v));
		else if (what === "save") await save(root, ctx);
		else if (what === "restore") await restore(root, ctx, Number(b.dataset.v));
	});
	addEventListener("resize", () => { if (st === mine && root.isConnected && st.buffer) paintAll(root); });
	// Leaving the page stops its listening.
	addEventListener("hashchange", () => { if (st === mine) { stop(); if (hearing) { hearing.pause(); hearing = null; } } }, { once: true });
}

async function save(root, ctx) {
	if (!changed() || st.saving) return;
	const kept = st.end - st.start;
	const ok = await ctx.confirmAction(`Save a new version of “${st.t.title}”, cut from ${clock(st.start)} to ${clock(st.end)} of the original (${clock(kept)})? It plays at once for everyone. The original and every earlier version stay, and can be made the one played again.`, "Save the version");
	if (!ok) return;
	st.saving = true;
	redraw(root);
	try {
		const r = await call("POST", `/${st.t.id}`, { startMs: Math.round(st.start), endMs: Math.round(st.end), base: st.detail.current, note: st.note });
		st.detail = r;
		st.start = r.made.startMs;
		st.end = r.made.endMs;
		st.note = "";
		ctx.notify(`Saved as version ${r.made.version} (${clock(r.made.durationMs)}). Listen to it below: that is the file everyone plays now.`);
		ctx.refreshEdits?.();
	} catch (err) {
		ctx.notify(`It could not be saved: ${err.message}`, { kind: "error" });
	} finally {
		st.saving = false;
		redraw(root);
	}
}

async function restore(root, ctx, version) {
	const label = version ? `version ${version}` : "the original";
	if (!(await ctx.confirmAction(`Make ${label} the one everyone plays?`, "Make it the one played"))) return;
	try {
		st.detail = await call("POST", `/${st.t.id}/restore`, { version, base: st.detail.current });
		const c = currentCut();
		st.start = c.start;
		st.end = c.end;
		ctx.notify(`${label[0].toUpperCase()}${label.slice(1)} plays now`);
		ctx.refreshEdits?.();
	} catch (err) {
		ctx.notify(`It could not be changed: ${err.message}`, { kind: "error" });
	}
	redraw(root);
}
