/**
 * Theme switch: System (follows the OS), Light or Dark. The choice is a
 * per-device convenience kept in localStorage; when storage is unavailable
 * the app follows the system setting.
 */
import { icon } from "./icons.js";

const KEY = "zaideih.theme";
const MODES = ["system", "light", "dark"];
const LABEL = { system: "System", light: "Light", dark: "Dark" };
const ICON = { system: "themeAuto", light: "sun", dark: "moon" };

function read() {
	try {
		const v = localStorage.getItem(KEY);
		return MODES.includes(v) ? v : "system";
	} catch {
		return "system";
	}
}

function write(mode) {
	try {
		if (mode === "system") localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, mode);
	} catch { /* not persisted; applies to this session */ }
}

function apply(mode) {
	const root = document.documentElement;
	if (mode === "system") delete root.dataset.theme;
	else root.dataset.theme = mode;
	const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
	for (const btn of document.querySelectorAll("[data-act=theme]")) {
		btn.innerHTML = `${icon(ICON[mode])}<span>${LABEL[mode]}</span>`;
		btn.setAttribute("aria-label", `Theme: ${LABEL[mode]}. Switch to ${LABEL[next]}`);
	}
}

export const theme = {
	init() { apply(read()); },
	cycle() {
		const mode = MODES[(MODES.indexOf(read()) + 1) % MODES.length];
		write(mode);
		apply(mode);
		return LABEL[mode];
	},
};
