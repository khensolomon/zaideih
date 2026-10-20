#!/usr/bin/env node
/**
 * Release plan: what a push would release, checked before anything is built.
 *
 *   node tools/release-plan.mjs --message "release: web 26.10.20.6 Help page"
 *   node tools/release-plan.mjs --target web+audio
 *
 * Without --message or --target, the message is read from RELEASE_MESSAGE
 * (set by the release workflow). Read-only. In GitHub Actions the plan is
 * also written to $GITHUB_OUTPUT: web, audio, d1 (true/false), version, tag,
 * message (the note, or "v<version>") and notes (the CHANGELOG section).
 *
 * Exit status: 0 with a plan; 0 with "nothing to release" for a message
 * that does not ask for one; 2 when the request cannot be released.
 */
import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { ReleaseError, TARGETS, parseReleaseMessage, parseTargets, planRelease } from "./lib/release.mjs";

const PACKAGES = ["package.json", "platforms/desktop/package.json"];

function fail(message) {
	// "::error::" shows the reason on the run's summary page in GitHub Actions.
	console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : `error: ${message}`);
	process.exit(2);
}

const { values } = parseArgs({
	options: {
		message: { type: "string" },
		target: { type: "string" },
	},
	strict: true,
});

let request;
try {
	if (values.target) request = { targets: parseTargets(values.target), version: null, note: "" };
	else request = parseReleaseMessage(values.message ?? process.env.RELEASE_MESSAGE ?? "");
} catch (err) {
	if (err instanceof ReleaseError) fail(err.message);
	throw err;
}
if (!request) {
	console.log("nothing to release: the message does not start with \"release:\"");
	process.exit(0);
}

const packageVersions = await Promise.all(PACKAGES.map(async (p) => JSON.parse(await readFile(p, "utf8")).version));
const changelog = await readFile("CHANGELOG.md", "utf8").catch(() => "");

let plan;
try {
	plan = planRelease({ request, packageVersions, changelog });
} catch (err) {
	if (err instanceof ReleaseError) fail(err.message);
	throw err;
}

const message = (plan.note || plan.tag).slice(0, 100);
console.log(`release    ${plan.tag}`);
for (const t of TARGETS) if (t !== "desktop") console.log(`  ${t.padEnd(8)} ${plan.targets.includes(t) ? "yes" : "no"}`);
console.log(`message    ${message}`);
console.log(`notes      ${plan.notes.split("\n").length} line(s) from CHANGELOG.md`);

if (process.env.GITHUB_OUTPUT) {
	const delimiter = `EOF_${randomUUID()}`;
	const lines = [
		...["web", "audio", "d1"].map((t) => `${t}=${plan.targets.includes(t)}`),
		`version=${plan.version}`,
		`tag=${plan.tag}`,
		`message=${message.replace(/[\r\n]+/g, " ")}`,
		`notes<<${delimiter}`, plan.notes, delimiter,
	];
	await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
