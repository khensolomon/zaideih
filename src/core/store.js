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
export function notify(message, { kind = "info", action } = {}) {
	emit("notice", { message, kind, action });
}
