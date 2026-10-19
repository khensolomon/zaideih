/**
 * Release version scheme: yy.mm.dd.changes
 *
 *   26.10.19.1   first release on 2026-10-19
 *   26.10.19.2   second release the same day
 *
 * Written as `v26.10.19.1` in tags and the UI; stored without the `v` in
 * package.json. The scheme is not semver: `npm version` cannot bump it, and
 * tooling that requires semver must map it (e.g. to 26.10.19-1).
 */
export class VersionError extends Error {}

const PATTERN = /^(\d{2})\.(\d{2})\.(\d{2})\.([1-9]\d*)$/;

/** Parses and validates a version; throws VersionError with the reason. */
export function parseVersion(value) {
	const m = PATTERN.exec(String(value ?? ""));
	if (!m) {
		throw new VersionError(`version ${JSON.stringify(value)} does not match yy.mm.dd.changes (for example 26.10.19.1)`);
	}
	const [, yy, mm, dd, changes] = m;
	const year = 2000 + Number(yy);
	const date = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) {
		throw new VersionError(`version ${value} names a date that does not exist (20${yy}-${mm}-${dd})`);
	}
	return { date: `${yy}.${mm}.${dd}`, changes: Number(changes) };
}

/** The date part for a given day, in yy.mm.dd form. */
export function datePart(day) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${pad(day.getFullYear() % 100)}.${pad(day.getMonth() + 1)}.${pad(day.getDate())}`;
}

/**
 * Next version after `current` on `day`: the change count increments on the
 * same day and restarts at 1 on a new day. A current version dated after
 * `day` is refused, since the next version would sort before it.
 */
export function nextVersion(current, day = new Date()) {
	const today = datePart(day);
	if (current === undefined || current === null || current === "") return `${today}.1`;
	const { date, changes } = parseVersion(current);
	if (date === today) return `${today}.${changes + 1}`;
	if (date > today) throw new VersionError(`current version ${current} is dated after today (${today}); check the system clock`);
	return `${today}.1`;
}
