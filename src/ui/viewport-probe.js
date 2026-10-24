/**
 * Hidden: a live readout of the sizes the browser uses to place the page,
 * for finding layout faults that only show on a device (an iPhone app on
 * the home screen moving the player bar). #/viewport turns it on or off on
 * this device; it stays until turned off. Linked nowhere.
 *
 * Shows, updated as they change: the window (innerWidth x innerHeight), the
 * visible area (visualViewport height and offset), the page's scroll height
 * and position, the safe area at the bottom, the gap between the player
 * bar and the bottom of the window, and whether this is the home screen app.
 */
const KEY = "zaideih.debug.viewport";

export const probeOn = () => {
	try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};

export function toggleProbe() {
	const on = !probeOn();
	try {
		if (on) localStorage.setItem(KEY, "1");
		else localStorage.removeItem(KEY);
	} catch { /* this visit only */ }
	if (on) startProbe();
	else document.getElementById("vv-probe")?.remove();
	return on;
}

export function startProbe() {
	if (document.getElementById("vv-probe")) return;
	const box = document.createElement("pre");
	box.id = "vv-probe";
	box.setAttribute("aria-hidden", "true");
	Object.assign(box.style, {
		position: "fixed", zIndex: "200", left: "8px", top: "calc(env(safe-area-inset-top) + 64px)", margin: "0", padding: "6px 8px",
		font: "11px/1.35 ui-monospace, Menlo, monospace", color: "#fff", background: "rgb(0 0 0 / 0.72)", borderRadius: "8px", pointerEvents: "none", whiteSpace: "pre",
	});
	// The bottom safe area, measured: an invisible bar as tall as it.
	const safe = document.createElement("div");
	Object.assign(safe.style, { position: "fixed", left: "0", bottom: "0", width: "1px", height: "env(safe-area-inset-bottom)", visibility: "hidden", pointerEvents: "none" });
	document.body.append(box, safe);
	const vv = window.visualViewport;
	let frame = 0;
	const log = [];
	const show = () => {
		frame = 0;
		const bar = document.getElementById("bar")?.getBoundingClientRect();
		const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
		const line = `win ${innerWidth}x${innerHeight}  vv ${vv ? `${Math.round(vv.height)} @${Math.round(vv.offsetTop)}` : "-"}  safe ${safe.offsetHeight}`;
		if (log[0] !== line) { log.unshift(line); log.length = Math.min(log.length, 6); }
		// Text only: textContent never reads markup.
		box.textContent = [
			`${standalone ? "home screen app" : "browser"}  ${location.hash.split("?")[0] || "#/"}`,
			`page ${document.scrollingElement.scrollHeight}  scroll ${Math.round(scrollY)}`,
			`bar bottom ${bar ? Math.round(bar.bottom) : "-"}  gap ${bar ? Math.round(innerHeight - bar.bottom) : "-"}`,
			"changes (newest first):",
			...log,
		].join("\n");
	};
	const soon = () => { frame ||= requestAnimationFrame(show); };
	addEventListener("resize", soon);
	addEventListener("scroll", soon, { passive: true });
	addEventListener("hashchange", soon);
	vv?.addEventListener("resize", soon);
	vv?.addEventListener("scroll", soon);
	setInterval(soon, 500);
	show();
}
