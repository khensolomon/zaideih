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

/**
 * The date part for a given moment, in yy.mm.dd form: the UTC day, so the
 * Workspace in one time zone, a laptop in another and the release workflow
 * (UTC) name the same day and never refuse each other's versions as "dated
 * after today".
 */
export function datePart(day) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${pad(day.getUTCFullYear() % 100)}.${pad(day.getUTCMonth() + 1)}.${pad(day.getUTCDate())}`;
}

/**
 * Next version after `current` on `day`: the change count increments on the
 * same day and restarts at 1 on a new day. A current version dated after
 * `day` is refused, since the next version would sort before it. Days are
 * UTC days (datePart).
 */
export function nextVersion(current, day = new Date()) {
	const today = datePart(day);
	if (current === undefined || current === null || current === "") return `${today}.1`;
	const { date, changes } = parseVersion(current);
	if (date === today) return `${today}.${changes + 1}`;
	if (date > today) throw new VersionError(`current version ${current} is dated after today (${today}); check the system clock`);
	return `${today}.1`;
}

/** The files a release changes, relative to the repository root. */
export const VERSION_FILES = Object.freeze({
	packages: ["package.json", "platforms/desktop/package.json"],
	locks: ["package-lock.json", "platforms/desktop/package-lock.json"],
	changelog: "CHANGELOG.md",
});
export const CHANGELOG_HEAD = "# Version\n\n";

/**
 * New contents of the release files for version `next`: each package.json
 * (only its version field changes), each lock file (top-level and root
 * package version) and, with `notes`, a "## v<next>" section at the top of
 * the changelog. `files` maps paths to current contents; a missing lock
 * file is skipped. Pure, so the CLI (tools/version.mjs) and the Workspace
 * (src/workspace) write releases the same way.
 */
export function releaseFiles(files, next, notes = []) {
	parseVersion(next);
	const out = {};
	for (const path of VERSION_FILES.packages) {
		const text = files[path];
		if (typeof text !== "string") throw new VersionError(`${path} is missing`);
		const updated = text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${next}"`);
		if (updated === text && JSON.parse(text).version !== next) throw new VersionError(`could not find a version field in ${path}`);
		out[path] = updated;
	}
	for (const path of VERSION_FILES.locks) {
		const text = files[path];
		if (typeof text !== "string") continue;
		const lock = JSON.parse(text);
		lock.version = next;
		if (lock.packages?.[""]) lock.packages[""].version = next;
		out[path] = `${JSON.stringify(lock, null, "\t")}\n`;
	}
	const lines = notes.map((n) => n.trim()).filter(Boolean);
	if (lines.length) {
		const changelog = files[VERSION_FILES.changelog];
		if (typeof changelog !== "string") throw new VersionError(`${VERSION_FILES.changelog} is missing`);
		if (!changelog.startsWith(CHANGELOG_HEAD)) throw new VersionError(`${VERSION_FILES.changelog} must start with "${CHANGELOG_HEAD.trim()}"`);
		if (changelog.split("\n").some((l) => l.trim() === `## v${next}`)) throw new VersionError(`${VERSION_FILES.changelog} already has a v${next} section`);
		out[VERSION_FILES.changelog] = `${CHANGELOG_HEAD}## v${next}\n\n${lines.map((n) => `- ${n}`).join("\n")}\n\n${changelog.slice(CHANGELOG_HEAD.length)}`;
	}
	return out;
}
