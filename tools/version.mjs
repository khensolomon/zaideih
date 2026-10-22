#!/usr/bin/env node
/**
 * Release version tool (scheme: yy.mm.dd.changes, see tools/lib/version.mjs).
 *
 *   node tools/version.mjs            show the current and next version (dry run)
 *   node tools/version.mjs --apply    write the next version to every package.json
 *   node tools/version.mjs --set 26.10.19.3 --apply   write a specific version
 *   node tools/version.mjs --check    fail unless every package.json has the same valid version
 *   node tools/version.mjs --note "Help page" --note "…" --apply
 *                                     also add a "## v<next>" section with these lines to CHANGELOG.md
 *
 * The local date is used, so a release made just after midnight takes the new day.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { CHANGELOG_HEAD, VERSION_FILES, VersionError, nextVersion, parseVersion, releaseFiles } from "./lib/version.mjs";

const PACKAGES = VERSION_FILES.packages;
const CHANGELOG = VERSION_FILES.changelog;

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(2);
}

const { values } = parseArgs({
	options: {
		apply: { type: "boolean", default: false },
		check: { type: "boolean", default: false },
		set: { type: "string" },
		note: { type: "string", multiple: true },
	},
	strict: true,
});

try {
	const pkgs = await Promise.all(PACKAGES.map(async (path) => {
		const text = await readFile(path, "utf8").catch((err) => fail(`cannot read ${path}: ${err.code}`));
		return { path, text, json: JSON.parse(text) };
	}));
	const versions = new Set(pkgs.map((p) => p.json.version));
	const current = pkgs[0].json.version;

	if (values.check) {
		if (versions.size !== 1) fail(`package versions differ: ${pkgs.map((p) => `${p.path}=${p.json.version}`).join(", ")}`);
		parseVersion(current);
		console.log(`v${current}`);
		process.exit(0);
	}

	if (versions.size !== 1) console.log(`note: package versions differ (${pkgs.map((p) => `${p.path}=${p.json.version}`).join(", ")}); all will be set`);
	let next;
	if (values.set) {
		parseVersion(values.set);
		next = values.set;
	} else {
		let base = current;
		try { parseVersion(current); } catch { base = undefined; } // a pre-scheme version (e.g. 27.0.0) starts today at .1
		next = nextVersion(base);
	}

	console.log(`current    v${current}`);
	console.log(`next       v${next}`);
	const notes = (values.note ?? []).map((n) => n.trim()).filter(Boolean);
	let changelog = null;
	if (notes.length) {
		changelog = await readFile(CHANGELOG, "utf8").catch((err) => fail(`cannot read ${CHANGELOG}: ${err.code}`));
		if (changelog.split("\n").some((l) => l.trim() === `## v${next}`)) fail(`${CHANGELOG} already has a v${next} section`);
		if (!changelog.startsWith(CHANGELOG_HEAD)) fail(`${CHANGELOG} must start with "${CHANGELOG_HEAD.trim()}"`);
		console.log(`changelog  ${notes.length} line(s) under ## v${next}`);
	}
	if (!values.apply) {
		console.log("\ndry run: nothing written. Re-run with --apply to update package.json files.");
		process.exit(0);
	}
	// The release files change in one place, shared with the admin page (tools/lib/version.mjs).
	const texts = {};
	for (const path of [...VERSION_FILES.packages, ...VERSION_FILES.locks, CHANGELOG]) {
		const text = await readFile(path, "utf8").catch(() => null);
		if (text !== null) texts[path] = text;
	}
	for (const [path, text] of Object.entries(releaseFiles(texts, next, changelog === null ? [] : notes))) {
		await writeFile(path, text);
		console.log(`wrote      ${path}`);
	}
	console.log(`\nRelease with a commit whose first line is: release: web ${next} <note>   (see docs/releasing.md)`);
} catch (err) {
	if (err instanceof VersionError) fail(err.message);
	throw err;
}
