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
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { VersionError, nextVersion, parseVersion } from "./lib/version.mjs";

const PACKAGES = ["package.json", "platforms/desktop/package.json"];
const CHANGELOG = "CHANGELOG.md";
const CHANGELOG_HEAD = "# Version\n\n";

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
	for (const p of pkgs) {
		// Replace only the version value so formatting and key order stay intact.
		const updated = p.text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${next}"`);
		if (updated === p.text && p.json.version !== next) fail(`could not find a version field in ${p.path}`);
		await writeFile(p.path, updated);
		console.log(`wrote      ${p.path}`);
		// npm records the root version twice in the lockfile; keep it in step.
		const lockPath = join(dirname(p.path), "package-lock.json");
		if (await access(lockPath).then(() => true, () => false)) {
			const lock = JSON.parse(await readFile(lockPath, "utf8"));
			lock.version = next;
			if (lock.packages?.[""]) lock.packages[""].version = next;
			await writeFile(lockPath, `${JSON.stringify(lock, null, "\t")}\n`);
			console.log(`wrote      ${lockPath}`);
		}
	}
	if (changelog !== null) {
		const section = `## v${next}\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\n`;
		await writeFile(CHANGELOG, CHANGELOG_HEAD + section + changelog.slice(CHANGELOG_HEAD.length));
		console.log(`wrote      ${CHANGELOG}`);
	}
	console.log(`\nRelease with a commit whose first line is: release: web ${next} <note>   (see docs/releasing.md)`);
} catch (err) {
	if (err instanceof VersionError) fail(err.message);
	throw err;
}
