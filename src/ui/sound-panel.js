/**
 * The Sound panel in Now playing: the sound features of core/sound.js
 * (skip silence, clean up, even volume, one-sided fix, equaliser) with what
 * they are doing for the current song. It is a popover with the "menu"
 * class, so it closes like the other menus (outside click, Escape).
 */
import { html } from "../core/html.js";
import { DEFAULTS, sound } from "../core/sound.js";

const EQ = [["bass", "Bass"], ["voice", "Voice"], ["treble", "Treble"]];
const CLEAN = [["off", "Off"], ["light", "Light"], ["strong", "Strong"]];

function statusText(st, s) {
	const parts = [];
	if (s.skip && st.skipped > 0) parts.push(`Skipped ${st.skipped} s of silence at the start`);
	if (s.balance && st.side !== "both") parts.push(`One-sided recording (${st.side} only): playing in both ears`);
	if (s.level && st.gainDb) parts.push(`Volume evened out by ${st.gainDb > 0 ? "+" : ""}${st.gainDb} dB`);
	return parts.join(". ");
}

function body() {
	const s = sound.settings;
	const off = sound.unavailable;
	const dis = off ? "disabled" : "";
	const eqDb = (v) => `${v > 0 ? "+" : ""}${v} dB`;
	return html`
		<div class="label">Sound</div>
		${off ? html`<p class="sp-note">${off}</p>` : ""}
		${sound.partial ? html`<p class="sp-note">${sound.partial}</p>` : ""}
		<label class="sp-row"><input type="checkbox" data-sound="skip" ${s.skip ? "checked" : ""} ${dis}><span><b>Skip silence</b><small>Passes quickly over silent tape at the start, and moves on at a silent end</small></span></label>
		<div class="sp-row sp-col"><span><b>Clean up</b><small>Light removes air blowing and rumble and softens hiss; Strong reduces hiss further</small></span>
			<span class="sp-seg" role="group" aria-label="Clean up">${CLEAN.map(([v, label]) => html`<button type="button" data-sound-clean="${v}" aria-pressed="${String(s.clean === v)}" ${dis}>${label}</button>`)}</span></div>
		<label class="sp-row"><input type="checkbox" data-sound="level" ${s.level ? "checked" : ""} ${dis}><span><b>Even out volume</b><small>Quiet and loud recordings play at a similar volume</small></span></label>
		<label class="sp-row"><input type="checkbox" data-sound="balance" ${s.balance ? "checked" : ""} ${dis}><span><b>Fix one-sided sound</b><small>A recording heard in one ear only plays in both</small></span></label>
		<div class="sp-eq">${EQ.map(([k, label]) => html`<label><span>${label}</span><input type="range" min="-6" max="6" step="1" value="${s[k]}" data-sound-eq="${k}" aria-label="${label}" ${dis}><output>${eqDb(s[k])}</output></label>`)}</div>
		<div class="sp-foot"><span class="sp-status" aria-live="polite">${statusText(sound.status, s)}</span><button type="button" class="link-btn" data-sound-reset ${dis}>Reset</button></div>`;
}

let unsubscribe = null;

export function openSoundPanel(anchor, closeMenu) {
	closeMenu();
	const panel = document.createElement("div");
	panel.className = "menu sound-panel";
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", "Sound");
	const render = () => { panel.innerHTML = body(); };
	render();
	document.body.append(panel);
	const r = anchor.getBoundingClientRect();
	const w = panel.offsetWidth, h = panel.offsetHeight;
	const left = Math.min(Math.max(12, r.right - w), innerWidth - w - 12);
	const top = r.bottom + h + 8 > innerHeight ? Math.max(12, innerHeight - h - 12) : r.bottom + 6;
	Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });

	panel.addEventListener("change", (e) => {
		const key = e.target.dataset.sound;
		if (key) sound.set({ [key]: e.target.checked });
	});
	panel.addEventListener("input", (e) => {
		const key = e.target.dataset.soundEq;
		if (!key) return;
		const v = Number(e.target.value);
		e.target.nextElementSibling.textContent = `${v > 0 ? "+" : ""}${v} dB`;
		sound.set({ [key]: v });
	});
	panel.addEventListener("click", (e) => {
		const clean = e.target.closest("[data-sound-clean]");
		if (clean) {
			sound.set({ clean: clean.dataset.soundClean });
			for (const b of panel.querySelectorAll("[data-sound-clean]")) b.setAttribute("aria-pressed", String(b === clean));
		}
		if (e.target.closest("[data-sound-reset]")) { sound.set({ ...DEFAULTS }); render(); }
	});
	unsubscribe?.();
	unsubscribe = sound.onStatus((st) => {
		if (!panel.isConnected) { unsubscribe?.(); unsubscribe = null; return; }
		const el = panel.querySelector(".sp-status");
		if (el) el.textContent = statusText(st, sound.settings);
	});
	(panel.querySelector("input, button:not([disabled])") ?? panel).focus?.();
}
