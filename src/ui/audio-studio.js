/**
 * The audio studio (docs/audio-studio.md): a song's recording trimmed at its
 * start and end, for the owner, co-owners and the Audio studio right.
 *
 *   #/audio/<track>
 *
 * One guided page. The page reads the original (version 0, never changed)
 * and suggests what to cut (core/trim.js): only steady tape noise, with a
 * second kept before the first sound and two after the last; when it is
 * unsure it says "Check this one", and when nothing is safe to cut it says
 * so. The suggestion is drawn as one picture: the first and last seconds
 * close up, the middle folded, what is cut striped and labelled.
 *
 * "Check the start" and "Check the end" play the join itself (what is cut,
 * a short tone, what stays). Saving asks nothing more: Undo follows at once.
 * Fine-tune (exact times, steps, snapping, keys) and the History (every
 * version, any of which, or the original, can be played again) are folded
 * away until asked for. A cut that reaches sound louder than the tape is
 * outlined and said in words.
 *
 * Saved, the audio Worker cuts the original without decoding it (no loss,
 * worker/media/mp3.js) into a new version that plays for everyone without a
 * release. "Listen to the saved file" plays that file as the Worker serves it.
 */
import { audioUrl } from "../config.js";
import { creditOf } from "../core/catalog.js";
import { editsUrl } from "../core/audio-edits.js";
import { html } from "../core/html.js";
import { player } from "../core/player.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { clock, envelope, LEAD_MS, parseClock, quietest, seconds, soundIn, soundMask, suggestTrim, TAIL_MS, WINDOW_MS } from "../core/trim.js";
import { icon } from "./icons.js";
import { scriptClass } from "./parts.js";

/** Each end of the recording is drawn this close up (or wider, to hold its cut). */
const EDGE_MS = 12000;
/** A recording this short is drawn whole, in one piece. */
const SHORT_MS = 40000;
/** A check plays this much of what is cut, and this much of what stays. */
const CUT_HEAR_MS = 2000;
const KEPT_HEAR_MS = 3000;
const TONE_S = 0.25;
const SNAP_MS = 150;
const PREVIEW_MS = 6000;
/** A label that would sit this close (px) to the cut's label, or to its pane's far side, is left out. */
const LABEL_ROOM_PX = 64;
const LABEL_FAR_PX = 120;

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
let waiting = false;

/** True while the page waits for the signed-in member's rights to be read: it is drawn again once they are. */
export const studioWaiting = () => waiting;

export function audioStudio(catalog, id, ctx) {
	const t = catalog.track(id);
	const page = (title, body) => ({ title, body: html`<div class="as-root">${body}</div>` });
	waiting = false;
	if (!t || t.upload) return page("Audio studio", html`<div class="empty"><h2>No such song in the catalog</h2></div>`);
	if (account().signedIn && !ctx.rightsKnown()) {
		waiting = true;
		return page("Audio studio", html`<p class="muted st-pad" aria-busy="true">Reading your rights…</p>`);
	}
	if (!account().signedIn || !ctx.canAudio()) {
		return page("Audio studio", html`<div class="empty"><h2>The audio studio needs the Audio studio right</h2><p>The owner and co-owners have it, and give it to members in the Workspace, Members.</p><p><a class="btn" href="${href(`album/${t.album.id}`, { song: t.id })}">Back to the album</a></p></div>`);
	}
	st = {
		t, ctx, detail: null, buffer: null, levels: null, mask: null, totalMs: 0, start: 0, end: 0, hint: null,
		snap: true, note: "", saving: false, playing: null, progress: 0, error: "", savedPlay: null,
		fine: false, hist: false, active: "start", justSaved: null, held: null,
	};
	return {
		title: `Audio studio: ${t.title}`,
		body: html`<div class="as-root">${draw()}</div>`,
		mount: (view) => mount(view.querySelector(".as-root"), ctx),
	};
}

/* ------------------------------------------------------------ state ---- */

const currentCut = () => {
	const v = st.detail?.versions.find((x) => x.version === st.detail.current);
	return v ? { start: v.startMs, end: v.endMs } : { start: 0, end: st.totalMs };
};
const near = (a, b) => Math.abs(a - b) <= WINDOW_MS;
const isCut = (c) => near(st.start, c.start) && near(st.end, c.end);
const changed = () => !isCut(currentCut());
const cutMs = () => st.start + (st.totalMs - st.end);
const canSave = () => !!st.buffer && !st.saving && changed() && st.end - st.start >= 1000;
const versionName = (v) => (v ? `version ${v}` : "the original");

/** The sound inside each cut: [fromMs, toMs] or null. */
const soundInCuts = () => ({
	start: st.start > 0 ? soundIn(st.mask, 0, st.start) : null,
	end: st.end < st.totalMs ? soundIn(st.mask, st.end, st.totalMs) : null,
});

/** The quiet sounds the suggestion kept, as far as they are still kept. */
function quietKept() {
	const q = st.hint?.quiet ?? {};
	const clip = (r) => (r && r[1] > st.start && r[0] < st.end ? [Math.max(r[0], st.start), Math.min(r[1], st.end)] : null);
	return { start: clip(q.start), end: clip(q.end) };
}

/** The tape kept for safety between each cut and the sound: [fromMs, toMs] or null. */
function margins() {
	const h = st.hint;
	if (!h || h.soundStartMs === null) return { start: null, end: null };
	return {
		start: h.soundStartMs - st.start >= 300 ? [st.start, h.soundStartMs] : null,
		end: st.end - h.soundEndMs >= 300 ? [h.soundEndMs, st.end] : null,
	};
}

/**
 * What the page says about the cut as it stands: the chip (kind: safe,
 * check or plain), the line after it, the sentence, a warning, the question
 * before saving and the save button's words.
 */
function verdict() {
	const T = st.totalMs;
	const h = st.hint;
	const lead = seconds(LEAD_MS).replace(/\.0$/, "");
	const tail = seconds(TAIL_MS).replace(/\.0$/, "");
	const cut = cutMs();
	const save = cut ? `Save · cut ${seconds(cut)} s` : "Save · nothing cut";
	const inside = soundInCuts();
	if (inside.start || inside.end) {
		const where = inside.start && inside.end ? "Both cuts go" : inside.start ? "The cut at the start goes" : "The cut at the end goes";
		const r = inside.start ?? inside.end;
		return {
			kind: "check", chip: "Check this one", note: "a cut goes into the sound",
			sentence: `Cut by hand: ${seconds(st.start)} s at the start, ${seconds(T - st.end)} s at the end.`,
			warn: { title: `${where} into the sound`, text: `From ${clock(r[0])} to ${clock(r[1])} the recording is clearly louder than the tape: music, a voice or wind. Listen before saving, or go back to the suggestion.` },
			ask: "", save: `Save anyway · cut ${seconds(cut)} s`,
		};
	}
	const isHint = h && isCut({ start: h.startMs, end: h.endMs });
	if (st.detail?.current && isCut(currentCut()) && !isHint) {
		return {
			kind: "plain", chip: `Version ${st.detail.current} plays`, note: "the cut everyone hears now",
			sentence: `This is the cut everyone hears now: ${seconds(st.start)} s at the start, ${seconds(T - st.end)} s at the end. Move a cut, or use the suggestion, to make a new version.`,
			warn: null, ask: "", save,
		};
	}
	if (isHint && h.verdict === "safe") {
		const both = h.startMs > 0 && h.endMs < T;
		return {
			kind: "safe", chip: "Safe to cut", note: `steady tape noise ${both ? "at both ends" : h.startMs > 0 ? "at the start" : "at the end"}`,
			sentence: `The music starts at ${clock(h.musicStartMs)} and ends at ${clock(h.musicEndMs)}. The cut keeps ${lead} s of tape before the first sound and ${tail} s after the last, so none of the music is lost.`,
			warn: null, ask: "Sounds right?", save,
		};
	}
	if (isHint && h.verdict === "check") {
		const q = h.quiet;
		const parts = [];
		if (q.start) parts.push(`From ${clock(q.start[0])} to ${clock(q.start[1])}, before the music, there is a quiet sound (a hum, a count-in or a voice); it is kept.`);
		if (q.end) parts.push(`From ${clock(q.end[0])} to ${clock(q.end[1])}, after the music, the recording goes on quietly (a fade, applause or a voice); it is kept.`);
		return {
			kind: "check", chip: "Check this one", note: q.start && q.end ? "quiet sounds before and after the music" : q.start ? "a quiet sound before the music" : "a quiet sound after the music",
			sentence: `Only the steady tape noise is cut. ${parts.join(" ")} Listen, and move the cut by hand if it is not part of the song.`,
			warn: null, ask: "After listening:", save,
		};
	}
	if (isHint) {
		return {
			kind: "plain", chip: "Nothing to cut", note: "no steady tape noise at either end",
			sentence: h.musicStartMs === null
				? "No music was found above the tape, so nothing is suggested. Set a cut by hand if the recording needs one."
				: "The sound starts within the first second and goes on to the end, so there is no steady tape noise long enough to cut safely. Nothing is cut unless you set a cut by hand.",
			warn: null, ask: "", save,
		};
	}
	if (!cut) return { kind: "plain", chip: "Nothing cut", note: "the whole recording", sentence: "The whole recording is kept.", warn: null, ask: "", save };
	return {
		kind: "plain", chip: "Set by hand", note: "only tape inside the cuts",
		sentence: `Cut by hand: ${seconds(st.start)} s at the start, ${seconds(T - st.end)} s at the end. There is only tape noise inside the cuts.`,
		warn: null, ask: "", save,
	};
}

/**
 * The picture's panes: the first seconds, the folded middle and the last
 * seconds ({ key, from, to, edges }), or the whole of a short recording.
 * While a cut is dragged, the panes hold still.
 */
function panes() {
	if (st.held) return st.held;
	const T = st.totalMs;
	if (T <= SHORT_MS) return [{ key: "all", from: 0, to: T, edges: ["start", "end"] }];
	const q = st.hint?.quiet ?? {};
	let a = Math.max(EDGE_MS, st.start + 4000, (q.start?.[1] ?? 0) + 2000);
	let b = Math.min(T - EDGE_MS, st.end - 4000, (q.end?.[0] ?? T) - 2000);
	a = Math.min(a, T / 2 - 2000);
	b = Math.max(b, T / 2 + 2000);
	return [
		{ key: "start", from: 0, to: a, edges: ["start"] },
		{ key: "mid", from: a, to: b, edges: [] },
		{ key: "end", from: b, to: T, edges: ["end"] },
	];
}

/* ------------------------------------------------------------- page ---- */

function head() {
	const t = st.t;
	const playing = st.detail ? (st.detail.current ? `Version ${st.detail.current} plays` : "The original plays") : "";
	return html`<header class="st-head">
		<a class="st-icon" href="${href(`album/${t.album.id}`, { song: t.id })}" aria-label="Back to the album" title="Back to the album">${icon("back")}</a>
		<div class="st-title"><b class="${scriptClass(t.title)}">${t.title}</b><span>Audio studio · ${creditOf(t.artists)}${playing ? ` · ${playing}` : ""}</span></div>
	</header>`;
}

function draw() {
	if (st.error) return html`${head()}<div class="st-page"><p class="error" role="alert">${st.error}</p></div>`;
	if (!st.buffer) {
		return html`${head()}<div class="st-page"><p class="muted" aria-busy="true">Reading the original recording${st.progress ? ` … ${Math.round(st.progress * 100)} %` : "…"}</p></div>`;
	}
	const v = verdict();
	const saved = st.justSaved && st.detail?.current === st.justSaved.version;
	return html`${head()}<div class="st-page as-page">
		<section class="as-card">
			<div class="as-status"><span class="as-chip as-${v.kind}"><i aria-hidden="true"></i>${v.chip}</span><span class="as-said">${v.note}</span></div>
			<p class="as-sentence">${v.sentence}</p>
			${picture()}
			${legend()}
			${v.warn ? html`<div class="as-warn" role="alert">${icon("alert")}<div><b>${v.warn.title}</b><small>${v.warn.text}</small></div>${st.hint ? html`<button class="btn" data-as="hint">Back to the suggestion</button>` : ""}</div>` : ""}
			${joinStrip()}
			${saved ? savedBanner() : actions(v)}
			<p class="as-summary">${summary()}</p>
		</section>
		${fineTune()}
		${history()}
	</div>`;
}

function summary() {
	const T = st.totalMs;
	const cut = cutMs();
	if (!cut) return `The length stays ${clock(T)}.`;
	return `Before ${clock(T)} · after ${clock(st.end - st.start)} · ${seconds(cut)} s cut (${seconds(st.start)} s at the start, ${seconds(T - st.end)} s at the end)`;
}

/** The labels over one pane: what is cut there, and what is kept beside it. */
function labelsOf(pane, { all = false } = {}) {
	const T = st.totalMs;
	const pct = (ms) => ((ms - pane.from) / (pane.to - pane.from)) * 100;
	const px = (p) => (p / 100) * (st.paneW ?? 480);
	const fits = (from, to) => all || (px(from) >= LABEL_ROOM_PX && px(to) >= LABEL_FAR_PX);
	const inside = soundInCuts();
	const quiet = quietKept();
	const margin = margins();
	const out = [];
	const at = (side, ms) => (side === "left" ? `left:${Math.max(0, pct(ms)).toFixed(2)}%` : `right:${Math.max(0, 100 - pct(ms)).toFixed(2)}%`);
	if (pane.edges.includes("start")) {
		out.push(st.start > 0
			? { t: `Cut · ${seconds(st.start)} s`, u: inside.start ? "sound inside" : "tape noise", kind: "cut", style: at("left", 0) }
			: { t: "Nothing cut", u: "the song starts here", kind: "plain", style: at("left", 0) });
		const second = inside.start ? { r: inside.start, t: "Sound inside the cut", u: `${clock(inside.start[0])} – ${clock(inside.start[1])}`, kind: "cut" }
			: quiet.start ? { r: quiet.start, t: "Quiet sound · kept", u: "listen: part of the song?", kind: "quiet" }
			: margin.start ? { r: margin.start, t: `${seconds(margin.start[1] - margin.start[0])} s kept`, u: "for safety", kind: "plain" } : null;
		if (second && fits(pct(second.r[0]), 100 - pct(second.r[0]))) out.push({ ...second, style: at("left", second.r[0]) });
	}
	if (pane.edges.includes("end")) {
		out.push(st.end < T
			? { t: `Cut · ${seconds(T - st.end)} s`, u: inside.end ? "sound inside" : "tape runs on", kind: "cut", style: at("right", T), right: true }
			: { t: "Nothing cut", u: "the song ends here", kind: "plain", style: at("right", T), right: true });
		const second = inside.end ? { r: inside.end, t: "Sound inside the cut", u: `${clock(inside.end[0])} – ${clock(inside.end[1])}`, kind: "cut" }
			: quiet.end ? { r: quiet.end, t: "Quiet sound · kept", u: "listen: part of the song?", kind: "quiet" }
			: margin.end ? { r: margin.end, t: `${seconds(margin.end[1] - margin.end[0])} s kept`, u: "for safety", kind: "plain" } : null;
		if (second && fits(100 - pct(second.r[1]), pct(second.r[1]))) out.push({ ...second, style: at("right", second.r[1]), right: true });
	}
	return out;
}

/** The times under one pane. */
function ticksOf(pane) {
	const short = (ms) => clock(ms).replace(/\.\d$/, "");
	if (pane.key === "mid") return [{ t: `≈ ${short(pane.to - pane.from)}`, more: " of the song", cls: "c" }];
	return [{ t: short(pane.from), cls: "l" }, { t: short(pane.to), cls: "r" }];
}

function picture() {
	const ps = panes();
	const zig = html`<svg class="as-zig" viewBox="0 0 12 100" preserveAspectRatio="none" aria-hidden="true"><path d="M2 0 10 10 2 20 10 30 2 40 10 50 2 60 10 70 2 80 10 90 2 100"/></svg>`;
	const aria = (p) => (p.key === "mid" ? "The middle of the song, folded: tap to listen from there"
		: p.key === "start" ? `The first ${seconds(p.to)} seconds: drag to move the cut at the start, now at ${clock(st.start)}`
		: p.key === "end" ? `The last ${seconds(p.to - p.from)} seconds: drag to move the cut at the end, now at ${clock(st.end)}`
		: `The whole recording: drag to move the cuts, now at ${clock(st.start)} and ${clock(st.end)}`);
	// On a phone the labels do not fit over the picture: they are said in two lines under it.
	const lines = ps.flatMap((p) => labelsOf(p, { all: true }).filter((l, i) => i === 0 || l.kind !== "plain").map((l) => ({ ...l, side: l.right ? "End" : "Start" })));
	return html`<div class="as-pic">
		<div class="as-row as-labels" aria-hidden="true">${ps.map((p) => html`<div class="as-pane as-p-${p.key}">${labelsOf(p).map((l) => html`<span class="as-lab as-lab-${l.kind}${l.right ? " r" : ""}" style="${l.style}"><b>${l.t}</b><small>${l.u}</small></span>`)}</div>`)}</div>
		<div class="as-row as-waves">${ps.map((p) => html`<div class="as-pane as-p-${p.key}"><canvas class="as-canvas" data-pane="${p.key}" role="img" aria-label="${aria(p)}"></canvas>${p.key === "mid" ? html`${zig}${zig}` : ""}</div>`)}</div>
		<div class="as-row as-axis" aria-hidden="true">${ps.map((p) => html`<div class="as-pane as-p-${p.key}">${ticksOf(p).map((k) => html`<span class="${k.cls}">${k.t}${k.more ? html`<span class="as-wide">${k.more}</span>` : ""}</span>`)}</div>`)}</div>
		<ul class="as-lines">${lines.map((l) => html`<li class="as-lab-${l.kind}"><b>${l.side}:</b> ${l.t} · ${l.u}</li>`)}</ul>
	</div>`;
}

function legend() {
	const q = quietKept();
	return html`<ul class="as-legend">
		<li><i class="sw-cut" aria-hidden="true"></i>Cut away</li>
		<li><i class="sw-tape" aria-hidden="true"></i>Tape noise</li>
		<li><i class="sw-sound" aria-hidden="true"></i>Music and sound</li>
		${q.start || q.end ? html`<li><i class="sw-quiet" aria-hidden="true"></i>Quiet sound, kept</li>` : ""}
		${st.totalMs > SHORT_MS ? html`<li class="as-fold-note">The first and last seconds are drawn close up; the middle is folded.</li>` : ""}
	</ul>`;
}

function joinStrip() {
	const p = st.playing;
	if (!p?.join) return "";
	return html`<div class="as-join">
		<b>${p.join === "start" ? "Playing the start" : "Playing the end"}</b>
		<div class="as-join-bar">${p.parts.map((x) => html`<span class="as-seg as-seg-${x.kind}" style="flex:${x.dur.toFixed(3)} 1 0">${x.label}</span>`)}<i class="as-join-head" style="left:0%"></i></div>
		<button class="btn" data-as="stop">Stop</button>
	</div>`;
}

function actions(v) {
	const p = st.playing?.join;
	const nothing = !cutMs() && !st.detail?.current;
	return html`<div class="as-actions">
		<div class="as-checks">
			<button class="btn as-big${p === "start" ? " on" : ""}" data-as="join" data-edge="start">${icon(p === "start" ? "pause" : "play")} <span>Check <span class="as-wide">the </span>start</span></button>
			<button class="btn as-big${p === "end" ? " on" : ""}" data-as="join" data-edge="end">${icon(p === "end" ? "pause" : "play")} <span>Check <span class="as-wide">the </span>end</span></button>
		</div>
		<div class="as-decide">
			${v.ask && canSave() ? html`<span class="as-ask">${v.ask}</span>` : ""}
			${changed() ? html`<button class="btn primary as-big" data-as="save" ${canSave() ? "" : "disabled"}>${st.saving ? "Saving…" : v.save}</button>` : ""}
			<button class="btn as-big" data-as="adjust" aria-expanded="${st.fine}">${st.fine ? "Hide fine-tune" : nothing ? "Cut by hand" : "Adjust"}</button>
		</div>
	</div>
	<p class="as-hint">Check the start plays the last ${seconds(CUT_HEAR_MS).replace(/\.0$/, "")} s that are cut, a short tone, then the first ${seconds(KEPT_HEAR_MS).replace(/\.0$/, "")} s that stay: the join you will hear. Check the end is the same the other way. Saving asks nothing more; Undo comes right after.</p>`;
}

function savedBanner() {
	const j = st.justSaved;
	const on = st.savedPlay === j.version;
	const next = nextSong();
	return html`<div class="as-saved" role="status">
		${icon("check")}
		<div><b>Saved as version ${j.version} · everyone hears it within about five minutes</b><small>Now ${clock(j.durationMs)} long. The original is kept. Undo plays ${versionName(j.previous)} again; version ${j.version} stays in the history.</small></div>
		<button class="btn" data-as="hear" data-v="${j.version}">${icon(on ? "pause" : "play")} ${on ? "Stop" : "Listen to the saved file"}</button>
		<button class="btn primary" data-as="undo">Undo</button>
	</div>
	${next ? html`<p class="as-next"><a class="btn" href="${href(`audio/${next.id}`)}">Next song in the album: <span class="${scriptClass(next.title)}">${next.title}</span> ${icon("chevron")}</a></p>` : ""}`;
}

function nextSong() {
	const list = st.t.album.tracks ?? [];
	const i = list.findIndex((x) => x.id === st.t.id);
	return list.slice(i + 1).find((x) => !x.upload) ?? null;
}

function fold(what, ico, title, sub, open, body) {
	return html`<section class="as-fold">
		<button class="as-fold-head" data-as="${what}" aria-expanded="${open}">${icon(ico)}<span><b>${title}</b><small>${sub}</small></span>${icon("chevron")}</button>
		${open ? html`<div class="as-fold-body">${body()}</div>` : ""}
	</section>`;
}

function fineTune() {
	return fold("fine", "sliders", "Fine-tune", "Exact times, 0.1 s steps, snapping to a quiet spot, keys", st.fine, () => html`
		<div class="as-edges">${edgeBox("start")}${edgeBox("end")}</div>
		<label class="check"><input type="checkbox" data-as="snap" ${st.snap ? "checked" : ""}> Move each cut to the quietest moment within ${SNAP_MS / 1000} s, where a cut is not heard</label>
		<label class="sb-field as-note"><span>A note for the history (optional)</span><input data-as="note" maxlength="300" value="${st.note}" placeholder="Wind at the start, tape run-out at the end"></label>
		<p class="as-keys"><span>Keys</span> <kbd>←</kbd><kbd>→</kbd> move the cut 0.1 s · <kbd>Shift</kbd> 1 s · <kbd>[</kbd><kbd>]</kbd> the start or the end · <kbd>Space</kbd> check it · <kbd>Ctrl</kbd><kbd>S</kbd> save</p>
		<div class="as-row-do">
			${st.hint ? html`<button class="btn" data-as="hint">Back to the suggestion</button>` : ""}
			<button class="btn" data-as="whole-cut">Cut nothing</button>
		</div>`);
}

function edgeBox(which) {
	const h = st.hint;
	const at = which === "start" ? st.start : st.end;
	const said = which === "start"
		? (h?.musicStartMs != null ? `the music starts at ${clock(h.musicStartMs)}` : "")
		: (h?.musicEndMs != null ? `the music ends at ${clock(h.musicEndMs)}` : "");
	const steps = [[-1000, "−1 s", "1 second earlier"], [-100, "−0.1", "0.1 second earlier"], [100, "+0.1", "0.1 second later"], [1000, "+1 s", "1 second later"]];
	return html`<div class="as-edge${st.active === which ? " on" : ""}" data-edge="${which}">
		<header><b>${which === "start" ? "Start" : "End"}</b><small>${said}</small></header>
		<div class="as-edge-row">
			<label for="as-${which}">${which === "start" ? "Cut before" : "Cut after"}</label>
			<input id="as-${which}" data-as="time" data-edge="${which}" value="${clock(at)}" inputmode="decimal" aria-describedby="as-${which}-fmt">
			<span class="sr" id="as-${which}-fmt">minutes:seconds</span>
			${steps.map(([by, label, aria]) => html`<button class="btn as-step" data-as="nudge" data-edge="${which}" data-by="${by}" aria-label="${aria}">${label}</button>`)}
		</div>
		<button class="btn" data-as="across" data-edge="${which}">${icon("play")} Play across the cut</button>
	</div>`;
}

function history() {
	const d = st.detail;
	if (!d) return "";
	const n = d.versions.length;
	const sub = `Plays now: ${versionName(d.current)} · ${n ? `${n} version${n === 1 ? "" : "s"} and the original` : "no versions yet"}`;
	const row = (v, label, sub2) => {
		const on = st.savedPlay === v;
		return html`<li class="${v === d.current ? "on" : ""}">
			<span class="as-v"><b>${label}</b><small>${sub2}</small></span>
			${v === d.current ? html`<span class="as-now">Plays now</span>` : ""}
			<button class="btn" data-as="hear" data-v="${v}">${icon(on ? "pause" : "play")} ${on ? "Stop" : "Listen"}</button>
			${v === d.current ? "" : html`<button class="btn" data-as="restore" data-v="${v}">Play this one</button>`}
		</li>`;
	};
	return fold("hist", "history", "History", sub, st.hist, () => html`
		<ol class="as-versions">
			${d.versions.map((v) => row(v.version, `Version ${v.version}`, `${clock(v.durationMs)} · cut ${seconds(v.startMs)} s at the start, ${seconds(st.totalMs - v.endMs)} s at the end · ${v.by}, ${new Date(v.at * 1000).toLocaleDateString()}${v.note ? ` · “${v.note}”` : ""}`))}
			${row(0, "The original", `${clock(st.totalMs)} · as it was added, never changed`)}
		</ol>
		<p class="as-hint">Listen plays the file itself, as the Worker serves it. Play this one makes it the one everyone hears.</p>`);
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
/** Whether any window between two times holds sound. */
function soundAt(fromMs, toMs) {
	const a = Math.max(0, Math.floor(fromMs / WINDOW_MS));
	const b = Math.min(st.mask.length - 1, Math.floor(toMs / WINDOW_MS));
	for (let w = a; w <= b; w++) if (st.mask[w]) return true;
	return false;
}

let hatch = null;
function hatchOf(g, dpr, colour) {
	if (hatch?.dpr === dpr && hatch.colour === colour) return g.createPattern(hatch.tile, "repeat");
	const size = Math.round(12 * dpr);
	const tile = document.createElement("canvas");
	tile.width = tile.height = size;
	const t = tile.getContext("2d");
	t.globalAlpha = 0.09;
	t.fillStyle = colour;
	t.fillRect(0, 0, size, size);
	t.globalAlpha = 0.16;
	t.strokeStyle = colour;
	t.lineWidth = 4 * dpr;
	t.beginPath();
	for (const o of [-size, 0, size]) { t.moveTo(o, size); t.lineTo(o + size, 0); }
	t.stroke();
	hatch = { dpr, colour, tile };
	return g.createPattern(tile, "repeat");
}

function paint(canvas) {
	const pane = panes().find((p) => p.key === canvas.dataset.pane);
	if (!pane) return;
	const dpr = devicePixelRatio || 1;
	const w = Math.max(40, Math.round(canvas.clientWidth * dpr));
	const h = Math.max(20, Math.round(canvas.clientHeight * dpr));
	if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
	const css = getComputedStyle(canvas);
	const colour = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
	const CUT = colour("--as-cut", "#f5b56a");
	const QUIET = colour("--as-quiet", "#8ec5ff");
	const SOUND = colour("--as-sound", "#e8e8e8");
	const TAPE = colour("--as-tape", "#8c8c8c");
	const g = canvas.getContext("2d");
	g.clearRect(0, 0, w, h);
	const span = pane.to - pane.from;
	const x = (ms) => ((ms - pane.from) / span) * w;
	const box = (r) => [Math.max(0, x(r[0])), Math.min(w, x(r[1]))];

	// What is cut, striped; the tape kept for safety, lighter; a quiet sound kept, dashed; sound inside a cut, outlined.
	const cuts = [[0, st.start], [st.end, st.totalMs]].filter((r) => r[1] > r[0]);
	g.fillStyle = hatchOf(g, dpr, CUT);
	for (const r of cuts) { const [a, b] = box(r); if (b > a) g.fillRect(a, 0, b - a, h); }
	const m = margins();
	g.fillStyle = "rgb(255 255 255 / 0.06)";
	for (const r of [m.start, m.end]) if (r) { const [a, b] = box(r); if (b > a) g.fillRect(a, 0, b - a, h); }
	const q = quietKept();
	for (const r of [q.start, q.end]) {
		if (!r) continue;
		const [a, b] = box(r);
		if (b <= a) continue;
		g.fillStyle = "rgb(142 197 255 / 0.12)";
		g.fillRect(a, 0, b - a, h);
		g.strokeStyle = QUIET;
		g.lineWidth = dpr;
		g.setLineDash([4 * dpr, 3 * dpr]);
		g.strokeRect(a + dpr / 2, dpr / 2, b - a - dpr, h - dpr);
		g.setLineDash([]);
	}
	const inside = soundInCuts();
	for (const r of [inside.start, inside.end]) {
		if (!r) continue;
		const [a, b] = box(r);
		if (b <= a) continue;
		g.fillStyle = "rgb(245 181 106 / 0.28)";
		g.fillRect(a, 0, b - a, h);
		g.strokeStyle = CUT;
		g.lineWidth = 2 * dpr;
		g.strokeRect(a + dpr, dpr, b - a - 2 * dpr, h - 2 * dpr);
	}

	// The sound, in bars, on a level scale (-60 dB to full) so the tape's hiss shows too.
	const step = 3 * dpr;
	const bins = Math.max(8, Math.floor(w / step));
	const key = `${pane.key}:${bins}:${pane.from}:${pane.to}`;
	let p = cache.get(key);
	if (!p) {
		p = peaks(pane.from, pane.to, bins);
		for (const k of cache.keys()) if (k.startsWith(`${pane.key}:`)) cache.delete(k);
		cache.set(key, p);
	}
	const mid = h / 2;
	const barW = Math.max(1, step - dpr);
	const quietAt = (ms) => [q.start, q.end].some((r) => r && ms >= r[0] && ms <= r[1]);
	for (let i = 0; i < bins; i++) {
		const t0 = pane.from + (i / bins) * span;
		const t1 = pane.from + ((i + 1) / bins) * span;
		const tm = (t0 + t1) / 2;
		const cut = tm < st.start || tm > st.end;
		g.fillStyle = cut ? CUT : quietAt(tm) ? QUIET : soundAt(t0, t1) ? SOUND : TAPE;
		const lo = scale(-p[i * 2]);
		const hi = scale(p[i * 2 + 1]);
		const top = Math.max(dpr, hi * mid * 0.92);
		const bottom = Math.max(dpr, lo * mid * 0.92);
		g.fillRect(Math.round((i / bins) * w), mid - top, barW, top + bottom);
	}

	// The cuts: a line and the time.
	g.font = `600 ${12 * dpr}px ${getComputedStyle(document.body).fontFamily}`;
	for (const edge of pane.edges) {
		const ms = edge === "start" ? st.start : st.end;
		const hx = x(ms);
		if (hx < -2 || hx > w + 2) continue;
		g.fillStyle = "#ffffff";
		g.fillRect(Math.round(hx - dpr), 0, 2 * dpr, h);
		const label = clock(ms);
		const pw = g.measureText(label).width + 16 * dpr;
		const ph = 20 * dpr;
		const px = Math.min(w - pw - 2 * dpr, Math.max(2 * dpr, hx - pw / 2));
		const py = h - ph - 8 * dpr;
		g.beginPath();
		g.roundRect(px, py, pw, ph, ph / 2);
		g.fill();
		g.fillStyle = "#262626";
		g.textBaseline = "middle";
		g.fillText(label, px + 8 * dpr, py + ph / 2 + dpr / 2);
	}
	// Where a listen is.
	const at = st.playing?.at;
	if (at != null && at >= pane.from && at <= pane.to) {
		g.fillStyle = "rgb(255 255 255 / 0.95)";
		g.fillRect(Math.round(x(at)), 0, dpr, h);
	}
}

function paintAll(root) {
	for (const c of root.querySelectorAll("canvas.as-canvas")) paint(c);
	// The labels over the picture are placed by the panes' width: drawn again when it is first known, or changes.
	const edge = root.querySelector("canvas.as-canvas[data-pane=start], canvas.as-canvas[data-pane=all]");
	const w = edge?.clientWidth;
	if (w && Math.abs(w - (st.paneW ?? 0)) > 8 && !st.held) {
		st.paneW = w;
		redraw(root);
	}
}

/* -------------------------------------------------------- listening ---- */

let audioCtx = null;
let hearing = null;

function stop() {
	if (st?.playing) {
		for (const n of st.playing.nodes) { try { n.stop(); } catch { /* ended */ } }
		st.playing = null;
	}
}

/**
 * Plays parts one after the other: [{ from, to, kind, label }] of the
 * original, and { tone: true } for a short tone between them. A join check
 * shows its parts in a strip.
 */
function playParts(root, parts, join = null) {
	stop();
	stopHearing(root);
	if (player.state.playing) player.pause();
	audioCtx ??= new AudioContext();
	audioCtx.resume();
	const t0 = audioCtx.currentTime + 0.05;
	let t = t0;
	const nodes = [];
	const timeline = [];
	for (const part of parts) {
		if (part.tone) {
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.frequency.value = 880;
			gain.gain.setValueAtTime(0, t);
			gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
			gain.gain.linearRampToValueAtTime(0, t + TONE_S);
			osc.connect(gain).connect(audioCtx.destination);
			osc.start(t);
			osc.stop(t + TONE_S);
			nodes.push(osc);
			timeline.push({ start: t - t0, dur: TONE_S + 0.05, kind: "tone", label: "tone" });
			t += TONE_S + 0.05;
			continue;
		}
		const from = Math.max(0, part.from);
		const to = Math.min(st.totalMs, part.to);
		if (to - from < 50) continue;
		const node = audioCtx.createBufferSource();
		node.buffer = st.buffer;
		node.connect(audioCtx.destination);
		const dur = (to - from) / 1000;
		node.start(t, from / 1000, dur);
		nodes.push(node);
		timeline.push({ start: t - t0, dur, from, kind: part.kind, label: part.label });
		t += dur;
	}
	if (!nodes.length) return;
	const total = t - t0;
	st.playing = { nodes, join, parts: timeline, total, at: null };
	nodes.at(-1).onended = () => {
		if (st.playing?.nodes === nodes) { st.playing = null; redraw(root); }
	};
	redraw(root);
	const tick = () => {
		if (!st.playing || st.playing.nodes !== nodes || !root.isConnected) return;
		const elapsed = audioCtx.currentTime - t0;
		const part = timeline.find((x) => elapsed >= x.start && elapsed < x.start + x.dur);
		st.playing.at = part?.from != null ? part.from + (elapsed - part.start) * 1000 : null;
		const head = root.querySelector(".as-join-head");
		if (head) head.style.left = `${Math.min(100, Math.max(0, (elapsed / total) * 100)).toFixed(2)}%`;
		paintAll(root);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

/** The join at a cut: what is cut, the tone, what stays (at the end, the other way round). */
function playJoin(root, which) {
	if (st.playing?.join === which) { stop(); redraw(root); return; }
	const at = which === "start" ? st.start : st.end;
	const T = st.totalMs;
	const cutPart = which === "start"
		? { from: at - CUT_HEAR_MS, to: at, kind: "cut", label: `Cut · last ${seconds(Math.min(CUT_HEAR_MS, at))} s` }
		: { from: at, to: at + CUT_HEAR_MS, kind: "cut", label: `Cut · first ${seconds(Math.min(CUT_HEAR_MS, T - at))} s` };
	const keptPart = which === "start"
		? { from: at, to: at + KEPT_HEAR_MS, kind: "kept", label: `Kept · first ${seconds(KEPT_HEAR_MS)} s` }
		: { from: at - KEPT_HEAR_MS, to: at, kind: "kept", label: `Kept · last ${seconds(KEPT_HEAR_MS)} s` };
	const nothingCut = which === "start" ? at <= 0 : at >= T;
	const parts = nothingCut ? [keptPart] : which === "start" ? [cutPart, { tone: true }, keptPart] : [keptPart, { tone: true }, cutPart];
	playParts(root, parts, which);
}

function playRange(root, fromMs, toMs) {
	playParts(root, [{ from: fromMs, to: toMs, kind: "kept", label: "" }]);
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
	hearing.play().catch((err) => st.ctx.notify(`${versionName(v)[0].toUpperCase()}${versionName(v).slice(1)} could not be played: ${err.message}`, { kind: "error" }));
	hearing.onended = () => stopHearing(root);
	st.savedPlay = v;
	redraw(root);
}

/* ------------------------------------------------------------ mount ---- */

function redraw(root) {
	if (!root.isConnected) return;
	const active = document.activeElement;
	const focus = active && root.contains(active)
		? (active.dataset.as === "note" ? "[data-as=note]" : active.dataset.as ? `[data-as="${active.dataset.as}"]${active.dataset.edge ? `[data-edge="${active.dataset.edge}"]` : ""}${active.dataset.by ? `[data-by="${active.dataset.by}"]` : ""}${active.dataset.v ? `[data-v="${active.dataset.v}"]` : ""}` : null)
		: null;
	root.innerHTML = draw();
	if (focus) {
		const el = root.querySelector(focus);
		if (el) {
			el.focus();
			if (el.dataset.as === "note") el.setSelectionRange(el.value.length, el.value.length);
		}
	}
	if (st.buffer) paintAll(root);
}

function setEdge(which, ms) {
	const at = Math.round(Math.min(st.totalMs, Math.max(0, ms)));
	if (which === "start") st.start = Math.min(at, st.end - 1000);
	else st.end = Math.max(at, st.start + 1000);
	st.active = which;
	st.justSaved = null;
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
		st.mask = soundMask(st.levels, st.hint.floorDb);
		// A song never cut opens on the suggestion; one cut before, on the cut that plays.
		const c = currentCut();
		if (detail.current) { st.start = c.start; st.end = c.end; } else { st.start = st.hint.startMs; st.end = st.hint.endMs; }
	} catch (err) {
		st.error = err instanceof StudioError ? err.message : `The recording could not be opened: ${err.message}`;
	}
	redraw(root);
}

let keys = null;

function mount(root, ctx) {
	const mine = st;
	read(root);
	// Dragging a cut on its pane; a tap on the folded middle listens from there.
	let drag = null;
	const timeAt = (canvas, pane, clientX) => {
		const r = canvas.getBoundingClientRect();
		return pane.from + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (pane.to - pane.from);
	};
	root.addEventListener("pointerdown", (e) => {
		const canvas = e.target.closest?.("canvas.as-canvas");
		if (!canvas || !st.buffer) return;
		const ps = panes();
		const pane = ps.find((p) => p.key === canvas.dataset.pane);
		const ms = timeAt(canvas, pane, e.clientX);
		if (!pane.edges.length) { playRange(root, ms, ms + PREVIEW_MS); return; }
		const which = pane.edges.length === 1 ? pane.edges[0] : Math.abs(ms - st.start) <= Math.abs(ms - st.end) ? "start" : "end";
		stop();
		drag = { canvas, pane, which };
		st.held = ps;
		canvas.setPointerCapture(e.pointerId);
		setEdge(which, ms);
		paintAll(root);
	});
	root.addEventListener("pointermove", (e) => {
		if (!drag) return;
		setEdge(drag.which, timeAt(drag.canvas, drag.pane, e.clientX));
		paintAll(root);
	});
	const release = () => {
		if (!drag) return;
		const which = drag.which;
		drag = null;
		st.held = null;
		setEdge(which, snapped(which === "start" ? st.start : st.end));
		redraw(root);
	};
	root.addEventListener("pointerup", release);
	root.addEventListener("pointercancel", release);
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
		const edge = b.dataset.edge;
		if (what === "join") playJoin(root, edge);
		else if (what === "stop") { stop(); redraw(root); }
		else if (what === "across") { const at = edge === "start" ? st.start : st.end; st.active = edge; playRange(root, at - KEPT_HEAR_MS, at + KEPT_HEAR_MS); }
		else if (what === "nudge") { setEdge(edge, (edge === "start" ? st.start : st.end) + Number(b.dataset.by)); redraw(root); }
		else if (what === "hint") { st.start = st.hint.startMs; st.end = st.hint.endMs; st.justSaved = null; redraw(root); }
		else if (what === "whole-cut") { st.start = 0; st.end = st.totalMs; st.justSaved = null; redraw(root); }
		else if (what === "adjust" || what === "fine") { st.fine = !st.fine; redraw(root); }
		else if (what === "hist") { st.hist = !st.hist; redraw(root); }
		else if (what === "hear") hear(root, Number(b.dataset.v));
		else if (what === "save") await save(root, ctx);
		else if (what === "undo") await restore(root, ctx, st.justSaved.previous, { undo: true });
		else if (what === "restore") await restore(root, ctx, Number(b.dataset.v));
	});
	addEventListener("resize", () => { if (st === mine && root.isConnected && st.buffer) paintAll(root); });

	// Keys, ahead of the app's own (Space plays and pauses, the arrows seek): only while nothing is being typed.
	if (keys) document.removeEventListener("keydown", keys, true);
	keys = (e) => {
		if (st !== mine || !root.isConnected || !st.buffer) return;
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || e.altKey) return;
		const which = st.active;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); save(root, ctx); return; }
		if (e.ctrlKey || e.metaKey) return;
		if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
			e.preventDefault();
			e.stopPropagation();
			const by = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1000 : 100);
			setEdge(which, (which === "start" ? st.start : st.end) + by);
			redraw(root);
		} else if (e.key === "[" || e.key === "]") {
			e.preventDefault();
			st.active = e.key === "[" ? "start" : "end";
			redraw(root);
		} else if (e.key === " " && document.activeElement?.tagName !== "BUTTON") {
			e.preventDefault();
			e.stopPropagation();
			playJoin(root, which);
		} else if (e.key === "Escape" && st.playing) {
			stop();
			redraw(root);
		}
	};
	document.addEventListener("keydown", keys, true);
	// Leaving the page stops its listening and its keys.
	addEventListener("hashchange", () => {
		if (st !== mine) return;
		stop();
		if (hearing) { hearing.pause(); hearing = null; }
		if (keys) { document.removeEventListener("keydown", keys, true); keys = null; }
	}, { once: true });
}

async function save(root, ctx) {
	if (!canSave()) return;
	stop();
	st.saving = true;
	redraw(root);
	const previous = st.detail.current;
	try {
		const r = await call("POST", `/${st.t.id}`, { startMs: Math.round(st.start), endMs: Math.round(st.end), base: previous, note: st.note });
		st.detail = r;
		st.start = r.made.startMs;
		st.end = r.made.endMs;
		st.note = "";
		st.justSaved = { version: r.made.version, previous, durationMs: r.made.durationMs };
		ctx.refreshEdits?.();
	} catch (err) {
		ctx.notify(`It could not be saved: ${err.message}`, { kind: "error" });
	} finally {
		st.saving = false;
		redraw(root);
	}
}

async function restore(root, ctx, version, { undo = false } = {}) {
	try {
		st.detail = await call("POST", `/${st.t.id}/restore`, { version, base: st.detail.current });
		const made = st.justSaved?.version;
		// Undone, the page keeps the cut just saved, to be changed and saved again; another version played shows its own cut.
		if (!undo) {
			const c = currentCut();
			st.start = c.start;
			st.end = c.end;
		}
		st.justSaved = null;
		const name = versionName(version);
		ctx.notify(undo ? `Undone: ${name} plays again. Version ${made} stays in the history.` : `${name[0].toUpperCase()}${name.slice(1)} plays now`);
		ctx.refreshEdits?.();
	} catch (err) {
		ctx.notify(`It could not be changed: ${err.message}`, { kind: "error" });
	}
	redraw(root);
}
