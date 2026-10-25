/**
 * Focus across a redraw. A page drawn again with innerHTML loses the focused
 * button, and a keyboard or screen-reader user is sent back to the top of the
 * document; the button's replacement is found by its data attributes and
 * focused again.
 */
const KEYS = ["data-ly", "data-st", "data-act", "data-ctl", "data-id", "data-to", "data-lang", "data-tab", "data-version"];

/** A selector for the focused element inside `root`, or null. */
export function focusKey(root) {
	const el = document.activeElement;
	if (!el || el === document.body || !root.contains(el)) return null;
	const sel = KEYS.filter((k) => el.hasAttribute(k)).map((k) => `[${k}="${CSS.escape(el.getAttribute(k))}"]`).join("");
	return sel ? `${el.localName}${sel}` : el.id ? `#${CSS.escape(el.id)}` : null;
}

/** Focuses what `focusKey` named, when it is there again. */
export function refocus(root, key) {
	if (key) root.querySelector(key)?.focus({ preventScroll: true });
}
