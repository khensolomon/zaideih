/**
 * Tiny observable store. Modules publish named topics ("player", "library",
 * "downloads", ...) and views subscribe to the topics they render.
 */
const listeners = new Map();

export function emit(topic, detail) {
	for (const fn of listeners.get(topic) ?? []) {
		try {
			fn(detail);
		} catch (err) {
			console.error(`listener for "${topic}" failed`, err);
		}
	}
}

export function on(topic, fn) {
	if (!listeners.has(topic)) listeners.set(topic, new Set());
	listeners.get(topic).add(fn);
	return () => listeners.get(topic).delete(fn);
}

/** User-visible notices: errors and confirmations. */
/**
 * Shows a notice. `code` is a playback diagnostic code shown under an error;
 * `help` adds a link to the help page.
 */
export function notify(message, { kind = "info", action, code, help = false } = {}) {
	emit("notice", { message, kind, action, code, help });
}
