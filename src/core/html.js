/**
 * Escaping template tag. Interpolated values are HTML-escaped unless they are
 * the result of another `html` call (a SafeHtml instance) or an array of them.
 */
class SafeHtml {
	constructor(value) { this.value = value; }
	toString() { return this.value; }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(v) {
	if (v === null || v === undefined || v === false) return "";
	if (v instanceof SafeHtml) return v.value;
	if (Array.isArray(v)) return v.map(render).join("");
	return escape(v);
}

export function html(strings, ...values) {
	let out = strings[0];
	for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
	return new SafeHtml(out);
}

/** Marks a trusted static string (e.g. inline SVG constants) as safe. */
export const raw = (s) => new SafeHtml(s);
