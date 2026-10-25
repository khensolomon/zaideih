/**
 * Keys renamed on this device, moved once before anything reads them: the
 * Workspace was the admin page until 26.10.25.6, and its sign-in, token,
 * level and unsent draft were kept under "zaideih.admin.". A key already set
 * under its new name is left as it is.
 *
 * Imported first by src/app.js, so it runs before any module reads storage.
 */
const MOVES = [["zaideih.admin.", "zaideih.workspace."]];

export function moveKeys(storage) {
	if (!storage) return 0;
	let moved = 0;
	const keys = [];
	for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
	for (const key of keys) {
		for (const [from, to] of MOVES) {
			if (!key?.startsWith(from)) continue;
			const next = to + key.slice(from.length);
			if (storage.getItem(next) === null) storage.setItem(next, storage.getItem(key));
			storage.removeItem(key);
			moved++;
		}
	}
	return moved;
}

for (const name of ["localStorage", "sessionStorage"]) {
	try {
		moveKeys(globalThis[name]);
	} catch (err) {
		// Storage refused (a private window, blocked site data): nothing was kept there to move.
		console.warn(`could not move renamed keys in ${name}`, err);
	}
}
