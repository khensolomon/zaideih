/**
 * Hints for icon-only buttons and links: the accessible name (aria-label)
 * shown in a small bubble, so newcomers learn what each icon does.
 *
 * - Mouse: after resting on the icon for a moment.
 * - Keyboard: when the icon receives focus from the keyboard.
 * - Touch: on a long press; the press then does not also activate it.
 *
 * Only controls without visible text get a hint; a button that already says
 * what it does needs none. `data-tip` overrides the text when the label is
 * long-winded for a hint.
 */
const HOVER_DELAY = 450;
const PRESS_DELAY = 480;
const TARGET = "button, a, [role=button]";

let tip = null;
let shownFor = null;
let hoverTimer = 0;
let pressTimer = 0;
let pressedOn = null;
let swallowClick = false;

function hintOf(el) {
	if (!el || el.disabled || el.closest("[hidden], .menu, #sg-panel")) return "";
	if (el.dataset.tip) return el.dataset.tip;
	const label = el.getAttribute("aria-label");
	if (!label) return "";
	// Has its own visible words: no hint needed.
	if (el.textContent.trim()) return "";
	return label;
}

function targetOf(node) {
	const el = node?.closest?.(TARGET);
	return el && hintOf(el) ? el : null;
}

export function showTip(el) {
	const text = hintOf(el);
	if (!text) return hideTip();
	tip.textContent = text;
	tip.hidden = false;
	shownFor = el;
	const r = el.getBoundingClientRect();
	const w = tip.offsetWidth, h = tip.offsetHeight;
	const margin = 8;
	// Below the control when there is room, else above it.
	let top = r.bottom + margin;
	let below = true;
	if (top + h > innerHeight - margin) { top = r.top - h - margin; below = false; }
	const left = Math.max(margin, Math.min(innerWidth - w - margin, r.left + r.width / 2 - w / 2));
	tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
	tip.dataset.side = below ? "below" : "above";
	tip.classList.remove("in");
	void tip.offsetWidth; // restart the fade
	tip.classList.add("in");
}

export function hideTip() {
	clearTimeout(hoverTimer);
	if (!tip || tip.hidden) return;
	tip.hidden = true;
	tip.classList.remove("in");
	shownFor = null;
}

export function initTips() {
	tip = document.getElementById("tip");
	if (!tip) return;

	document.addEventListener("pointerover", (e) => {
		if (e.pointerType !== "mouse") return;
		const el = targetOf(e.target);
		if (el === shownFor) return;
		clearTimeout(hoverTimer);
		if (!el) { hideTip(); return; }
		// Moving from one icon to the next shows the next hint at once.
		hoverTimer = setTimeout(() => showTip(el), shownFor ? 0 : HOVER_DELAY);
	});
	document.addEventListener("pointerout", (e) => {
		if (e.pointerType !== "mouse") return;
		const el = targetOf(e.target);
		if (el && el.contains(e.relatedTarget)) return;
		clearTimeout(hoverTimer);
		if (el === shownFor) hideTip();
	});

	document.addEventListener("focusin", (e) => {
		const el = targetOf(e.target);
		if (el && el.matches(":focus-visible")) showTip(el);
		else hideTip();
	});
	document.addEventListener("focusout", () => hideTip());

	document.addEventListener("pointerdown", (e) => {
		hideTip();
		swallowClick = false;
		if (e.pointerType === "mouse") return;
		const el = targetOf(e.target);
		if (!el) return;
		pressedOn = { el, x: e.clientX, y: e.clientY };
		clearTimeout(pressTimer);
		pressTimer = setTimeout(() => {
			showTip(el);
			swallowClick = true;
			navigator.vibrate?.(8);
		}, PRESS_DELAY);
	}, { passive: true });
	const endPress = () => {
		clearTimeout(pressTimer);
		pressedOn = null;
		// A long-press hint stays a moment after the finger lifts.
		if (swallowClick) setTimeout(hideTip, 1400);
	};
	document.addEventListener("pointerup", endPress, { passive: true });
	document.addEventListener("pointercancel", endPress, { passive: true });
	document.addEventListener("pointermove", (e) => {
		if (pressedOn && Math.hypot(e.clientX - pressedOn.x, e.clientY - pressedOn.y) > 10) { clearTimeout(pressTimer); pressedOn = null; }
	}, { passive: true });
	// The long press showed a hint: the release must not also press the button.
	document.addEventListener("click", (e) => {
		if (!swallowClick) return;
		swallowClick = false;
		e.preventDefault();
		e.stopImmediatePropagation();
	}, true);
	document.addEventListener("contextmenu", (e) => { if (shownFor && targetOf(e.target) === shownFor) e.preventDefault(); });

	document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
	addEventListener("scroll", hideTip, { passive: true, capture: true });
	addEventListener("resize", hideTip);
	addEventListener("hashchange", hideTip);
	// The control the hint belongs to can be re-rendered away (player updates).
	document.addEventListener("click", () => { if (shownFor && !shownFor.isConnected) hideTip(); });
}
