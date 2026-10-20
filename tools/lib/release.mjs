/**
 * Release plans: what a release commit asks for, checked against the
 * repository before anything is built or deployed.
 *
 * A release is asked for by the first line of the commit pushed to master:
 *
 *   release: web                        the site (dist/web, Workers static assets)
 *   release: audio                      the audio Worker (worker/media)
 *   release: d1                         reload track paths into D1 from media.json
 *   release: web+audio 26.10.20.6 Help  several targets, a version, a note
 *   release: all                        web and audio (not d1, not desktop)
 *
 * A version written in the message must equal the version in package.json.
 * The version needs a "## v<version>" section in CHANGELOG.md, which becomes
 * the notes of the GitHub release.
 */
import { VersionError, parseVersion } from "./version.mjs";

export class ReleaseError extends Error {}

export const TARGETS = ["web", "audio", "d1", "desktop"];
const ALL = ["web", "audio"];
const NOT_READY = {
	desktop: "desktop releases are not set up yet: the app needs packaging (and signing) for each operating system first",
};

/**
 * Reads "release: <targets> [version] [note]". Returns null for a message
 * that does not ask for a release.
 */
export function parseReleaseMessage(message) {
	const first = String(message ?? "").split("\n")[0].trim();
	const m = /^release:\s*(\S+)\s*(.*)$/i.exec(first);
	if (!m) return null;
	const targets = parseTargets(m[1]);
	let rest = m[2].replace(/^[;:,-]\s*/, "");
	let version = null;
	const v = /^v?(\d{2}\.\d{2}\.\d{2}\.\d+)\b\s*[;:,-]?\s*/.exec(rest);
	if (v) {
		version = v[1];
		rest = rest.slice(v[0].length);
	}
	return { targets, version, note: rest.trim() };
}

/** "web+audio", "web,audio" or "all" to a list of targets; throws on unknown names. */
export function parseTargets(text) {
	const names = String(text).toLowerCase().split(/[+,]/).filter(Boolean);
	if (!names.length) throw new ReleaseError("the release names no target");
	const out = new Set();
	for (const n of names) {
		if (n === "all") ALL.forEach((t) => out.add(t));
		else if (TARGETS.includes(n)) out.add(n);
		else throw new ReleaseError(`unknown release target "${n}"; use ${[...TARGETS, "all"].join(", ")} (several joined with +)`);
	}
	return TARGETS.filter((t) => out.has(t));
}

/** The CHANGELOG.md section for a version, without its heading, or null. */
export function changelogSection(changelog, version) {
	const lines = String(changelog).split("\n");
	const start = lines.findIndex((l) => l.trim() === `## v${version}`);
	if (start < 0) return null;
	let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
	if (end < 0) end = lines.length;
	return lines.slice(start + 1, end).join("\n").trim();
}

/**
 * Checks a release request against the repository.
 *
 * @param {object} input
 * @param {{targets: string[], version: string|null, note: string}} input.request
 * @param {string[]} input.packageVersions  version of every package.json
 * @param {string} input.changelog          CHANGELOG.md text
 * @returns {{targets: string[], version: string, tag: string, note: string, notes: string}}
 */
export function planRelease({ request, packageVersions, changelog }) {
	const blocked = request.targets.filter((t) => NOT_READY[t]);
	if (blocked.length) throw new ReleaseError(blocked.map((t) => NOT_READY[t]).join("; "));
	const versions = [...new Set(packageVersions)];
	if (versions.length !== 1) throw new ReleaseError(`package versions differ (${packageVersions.join(", ")}); run node tools/version.mjs --apply`);
	const [version] = versions;
	try {
		parseVersion(version);
	} catch (err) {
		if (err instanceof VersionError) throw new ReleaseError(err.message);
		throw err;
	}
	if (request.version && request.version !== version) {
		throw new ReleaseError(`the message says v${request.version} but package.json has v${version}`);
	}
	const notes = changelogSection(changelog, version);
	if (!notes) throw new ReleaseError(`CHANGELOG.md has no "## v${version}" section; add one (node tools/version.mjs --note "…" --apply writes it)`);
	return { targets: request.targets, version, tag: `v${version}`, note: request.note, notes };
}
