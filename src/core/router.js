/**
 * Hash router. Hash URLs need no server rewrite rules, so the app runs from
 * any static host and from a cached shell offline.
 *
 * Routes are declared as patterns like "album/:id"; the handler receives the
 * decoded params plus the query string as URLSearchParams.
 */
const routes = [];

export function route(pattern, handler) {
	const keys = [];
	const re = new RegExp(
		"^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$",
	);
	routes.push({ re, keys, handler, pattern });
}

export function parse(hash = location.hash) {
	const body = hash.replace(/^#\/?/, "");
	const [path, qs = ""] = body.split("?");
	for (const r of routes) {
		const m = r.re.exec(path);
		if (m) {
			// A cut-off link ("%2" at its end) is no address: not found, not an error that stops the app.
			let params;
			try {
				params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
			} catch {
				return null;
			}
			return { handler: r.handler, params, query: new URLSearchParams(qs), path, pattern: r.pattern };
		}
	}
	return null;
}

export const href = (path, query) => `#/${path}${query ? `?${new URLSearchParams(query)}` : ""}`;

export function go(path, query, { replace = false } = {}) {
	const next = href(path, query);
	if (replace) history.replaceState(history.state, "", next);
	else location.hash = next;
	if (replace) dispatchEvent(new HashChangeEvent("hashchange"));
}
