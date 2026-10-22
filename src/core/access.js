/**
 * Who is using the app, as far as the admin page knows: the level of the
 * person signed in on this device, so every page can offer what that level
 * may do (a link to the admin page for editors, "Suggest edits" for guests).
 *
 * The level comes from the repository permission GitHub reports for the
 * person (src/admin/github.js); it is a convenience for the interface only.
 * What anyone can actually change is decided by GitHub on every request.
 *
 *   admin        repository admin or maintainer: everything
 *   editor       write access: edit, publish, merge and release
 *   contributor  triage access: suggestions, reviewed by an editor
 *   guest        any other GitHub account: suggestions, reviewed by an editor
 *   viewer       not signed in (listeners)
 */
export const WHO_KEY = "zaideih.admin.who";
/** The GitHub sign-in (src/admin/session.js) and the fine-grained token, as the admin page keeps them. */
export const SESSION_KEY = "zaideih.admin.session";
export const TOKEN_KEY = "zaideih.admin.token";

export const LEVELS = Object.freeze({
	admin: { name: "Admin", canWrite: true },
	editor: { name: "Editor", canWrite: true },
	contributor: { name: "Contributor", canWrite: false },
	guest: { name: "Guest", canWrite: false },
	viewer: { name: "Viewer", canWrite: false },
});

/** The level for GitHub's repository `permissions` object of a signed-in person. */
export function levelOf(permissions = {}) {
	if (permissions.admin || permissions.maintain) return "admin";
	if (permissions.push) return "editor";
	if (permissions.triage) return "contributor";
	return "guest";
}

const read = (storage, key) => {
	try { return JSON.parse(storage.getItem(key) ?? "null"); } catch { return null; }
};

/**
 * The person signed in on this device, { login, level, via }, or null for a
 * viewer. Answers null once the sign-in or token it was based on is gone or
 * has run out, so a stale level is never shown.
 */
export function readWho(storage, now = Date.now()) {
	const who = read(storage, WHO_KEY);
	if (!who || !LEVELS[who.level] || who.level === "viewer" || typeof who.login !== "string") return null;
	if (who.via === "github") {
		const t = read(storage, SESSION_KEY);
		const live = (at) => at === null || at === undefined || at > now;
		if (!t?.access_token || !(live(t.expires_at) || (t.refresh_token && live(t.refresh_expires_at)))) return null;
	} else if (who.via === "token") {
		if (!read(storage, TOKEN_KEY)) return null;
	} else {
		return null;
	}
	return who;
}

/** Keeps (or with null, forgets) who is signed in. */
export function saveWho(storage, who) {
	try {
		if (who) storage.setItem(WHO_KEY, JSON.stringify({ login: who.login, level: who.level, via: who.via }));
		else storage.removeItem(WHO_KEY);
	} catch { /* the pages then show what a viewer sees */ }
}
