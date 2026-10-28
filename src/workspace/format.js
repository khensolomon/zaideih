/**
 * Words and numbers as the Workspace shows them: counts, sizes, times and
 * dates in the reader's locale. Pure functions, shared by its sections.
 */

/** "1 change", "3 changes"; `many` when the plural is not an s. */
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Bytes as "12.3 MB". */
export const mb = (n) => `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
/** Bytes as "1.2 GB" from a billion, else MB. */
export const space = (n) => (n >= 1e9 ? `${(n / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB` : mb(n));

/** A moment (seconds) as its date. */
export const ago = (t) => new Date(t * 1000).toLocaleDateString();
/** A moment (seconds) as "28 Oct 2026". */
export const day = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
/** A moment (seconds) as date and time. */
export const when = (sec) => new Date(sec * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
/** A day ("2026-10-28") as "28 Oct", or with `opts`. */
export const dayLabel = (dayText, opts = { day: "numeric", month: "short" }) => new Date(`${dayText}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });

/** How long ago, in words: "2 h ago", "yesterday", "3 days ago", or the date. */
export function since(t, now = Date.now()) {
	const sec = Math.max(0, now / 1000 - t);
	if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min ago`;
	if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
	if (sec < 2 * 86400) return "yesterday";
	if (sec < 14 * 86400) return `${Math.round(sec / 86400)} days ago`;
	return day(t);
}

/** Seconds as "m:ss", rounded to the second first (so 119.6 is "2:00", never "1:60"). */
export function duration(sec) {
	const whole = Math.round(sec);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** GitHub's avatar address at twice the shown size, for sharp photos. */
export const sized = (url) => {
	try { const u = new URL(url); u.searchParams.set("s", "96"); return u.href; } catch { return ""; }
};
/** A member's photo: GitHub's at a sharp size, any other as it is. */
export const photoOf = (url) => (/^https:\/\/avatars\.githubusercontent\.com\//.test(url) ? sized(url) : url);
