/**
 * The Sound panel in Now playing: the sound features of core/sound.js with
 * what they are doing for the current song. Two tabs: "Clean up" (skip
 * silence, clean up, even volume, one-sided fix) and "Equaliser" (presets
 * and ten bands). It is a popover with the "menu" class, so it closes like
 * the other menus (outside click, Escape).
 */
import { html } from "../core/html.js";
import { DEFAULTS, EQ_BANDS, EQ_LIMIT, PRESETS, sound } from "../core/sound.js";

const CLEAN = [["off", "Off"], ["light", "Light"], ["strong", "Strong"]];
const hz = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));
const db = (v) => `${v > 0 ? "+" : ""}${v}`;
let tab = "clean";

function statusText(st, s) {
	const parts = [];
	if (s.skip && st.skipped > 0) parts.push(`Skipped ${st.skipped} s of silence at the start`);
	if (s.balance && st.side !== "both") parts.push(`One-sided recording (${st.side} only): playing in both ears`);
	if (s.level && st.gainDb) parts.push(`Volume evened out by ${st.gainDb > 0 ? "+" : ""}${st.gainDb} dB`);
	return parts.join(". ");
}

function cleanTab(s, dis) {
	return html`
		<label class="sp-row"><input type="checkbox" data-sound="skip" ${s.skip ? "checked" : ""} ${dis}><span><b>Skip silence</b><small>Passes quickly over silent tape at the start, and moves on at a silent end</small></span></label>
		<div class="sp-row sp-col"><span><b>Clean up</b><small>Light removes air blowing and rumble and softens hiss; Strong reduces hiss further</small></span>
			<span class="sp-seg" role="group" aria-label="Clean up">${CLEAN.map(([v, label]) => html`<button type="button" data-sound-clean="${v}" aria-pressed="${String(s.clean === v)}" ${dis}>${label}</button>`)}</span></div>
		<label class="sp-row"><input type="checkbox" data-sound="level" ${s.level ? "checked" : ""} ${dis}><span><b>Even out volume</b><small>Quiet and loud recordings play at a similar volume</small></span></label>
		<label class="sp-row"><input type="checkbox" data-sound="balance" ${s.balance ? "checked" : ""} ${dis}><span><b>Fix one-sided sound</b><small>A recording heard in one ear only plays in both</small></span></label>`;
}

function eqTab(s, dis) {
	const lowBoost = Math.max(s.eq[0], s.eq[1]) > 2 && s.clean !== "off";
	return html`
		<div class="sp-presets" role="group" aria-label="Equaliser presets">
			${PRESETS.map((p) => html`<button type="button" data-sound-preset="${p.id}" aria-pressed="${String(s.preset === p.id)}" ${dis}>${p.name}</button>`)}
			${s.preset === "custom" ? html`<button type="button" aria-pressed="true" disabled>Custom</button>` : ""}
		</div>
		<div class="sp-bands" role="group" aria-label="Equaliser bands, ${EQ_LIMIT} dB up or down">
			${EQ_BANDS.map((f, i) => html`<label class="sp-band">
				<output>${db(s.eq[i])}</output>
				<input type="range" min="${-EQ_LIMIT}" max="${EQ_LIMIT}" step="1" value="${s.eq[i]}" data-sound-band="${i}" aria-label="${hz(f)}Hz" aria-valuetext="${db(s.eq[i])} dB at ${hz(f)}Hz" ${dis}>
				<span>${hz(f)}</span>
			</label>`)}
		</div>
		<p class="sp-hint">${lowBoost
			? "The lowest bands are boosted, so the rumble cut of Clean up moves down to 45 Hz. Cassettes hold little below 60 Hz, so those bands mostly raise tape rumble."
			: "dB per band, up to 12 up or down. Boosting lowers the overall level a little first, so the sound never distorts."}</p>`;
}

function body() {
	const s = sound.settings;
	const off = sound.unavailable;
	const dis = off ? "disabled" : "";
	return html`
		<div class="sp-head">
			<span class="label">Sound</span>
			<span class="sp-tabs" role="tablist">
				<button type="button" role="tab" data-sound-tab="clean" aria-selected="${String(tab === "clean")}">Clean up</button>
				<button type="button" role="tab" data-sound-tab="eq" aria-selected="${String(tab === "eq")}">Equaliser</button>
			</span>
		</div>
		${off ? html`<p class="sp-note">${off}</p>` : ""}
		${sound.partial ? html`<p class="sp-note">${sound.partial}</p>` : ""}
		${tab === "clean" ? cleanTab(s, dis) : eqTab(s, dis)}
		<div class="sp-foot"><span class="sp-status" aria-live="polite">${statusText(sound.status, s)}</span>
			<button type="button" class="link-btn" data-sound-reset ${dis}>${tab === "eq" ? "Flat" : "Reset"}</button></div>`;
}

let unsubscribe = null;

export function openSoundPanel(anchor, closeMenu) {
	closeMenu();
	const panel = document.createElement("div");
	panel.className = "menu sound-panel";
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", "Sound");
	const place = () => {
		const r = anchor.getBoundingClientRect();
		const w = panel.offsetWidth, h = panel.offsetHeight;
		const left = Math.min(Math.max(12, r.right - w), innerWidth - w - 12);
		const top = r.bottom + h + 8 > innerHeight ? Math.max(12, innerHeight - h - 12) : r.bottom + 6;
		Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
	};
	const render = (focusSel) => {
		panel.innerHTML = body();
		place();
		if (focusSel) panel.querySelector(focusSel)?.focus();
	};
	document.body.append(panel);
	render();

	panel.addEventListener("change", (e) => {
		const key = e.target.dataset.sound;
		if (key) sound.set({ [key]: e.target.checked });
	});
	panel.addEventListener("input", (e) => {
		const band = e.target.dataset.soundBand;
		if (band === undefined) return;
		const eq = [...sound.settings.eq];
		eq[Number(band)] = Number(e.target.value);
		e.target.previousElementSibling.textContent = db(eq[Number(band)]);
		e.target.setAttribute("aria-valuetext", `${db(eq[Number(band)])} dB at ${hz(EQ_BANDS[Number(band)])}Hz`);
		const wasCustom = sound.settings.preset === "custom";
		sound.set({ eq, preset: "custom" });
		// The preset buttons and the hint follow; the slider being dragged stays as it is.
		if (!wasCustom) {
			for (const b of panel.querySelectorAll("[data-sound-preset]")) b.setAttribute("aria-pressed", "false");
		}
	});
	panel.addEventListener("pointerup", (e) => { if (e.target.dataset?.soundBand !== undefined) render(`[data-sound-band="${e.target.dataset.soundBand}"]`); });
	panel.addEventListener("keyup", (e) => { if (e.target.dataset?.soundBand !== undefined) render(`[data-sound-band="${e.target.dataset.soundBand}"]`); });
	panel.addEventListener("click", (e) => {
		const t = e.target.closest("[data-sound-tab]");
		if (t) { tab = t.dataset.soundTab; render(`[data-sound-tab="${tab}"]`); return; }
		const clean = e.target.closest("[data-sound-clean]");
		if (clean) {
			sound.set({ clean: clean.dataset.soundClean });
			for (const b of panel.querySelectorAll("[data-sound-clean]")) b.setAttribute("aria-pressed", String(b === clean));
			return;
		}
		const preset = e.target.closest("[data-sound-preset]");
		if (preset) { sound.set({ preset: preset.dataset.soundPreset }); render(`[data-sound-preset="${preset.dataset.soundPreset}"]`); return; }
		if (e.target.closest("[data-sound-reset]")) {
			sound.set(tab === "eq" ? { preset: "flat" } : { skip: DEFAULTS.skip, clean: DEFAULTS.clean, level: DEFAULTS.level, balance: DEFAULTS.balance });
			render("[data-sound-reset]");
		}
	});
	unsubscribe?.();
	unsubscribe = sound.onStatus((st) => {
		if (!panel.isConnected) { unsubscribe?.(); unsubscribe = null; return; }
		const el = panel.querySelector(".sp-status");
		if (el) el.textContent = statusText(st, sound.settings);
	});
	(panel.querySelector(`[data-sound-tab="${tab}"]`) ?? panel).focus?.();
}
