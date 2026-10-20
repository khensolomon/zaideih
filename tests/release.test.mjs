import assert from "node:assert/strict";
import { test } from "node:test";
import { ReleaseError, changelogSection, parseReleaseMessage, parseTargets, planRelease } from "../tools/lib/release.mjs";

const changelog = "# Version\n\n## v26.10.20.6\n\n- Help page\n- Retry\n\n## v26.10.20.5\n\n- Older\n";

test("release lines name targets, an optional version and a note", () => {
	assert.deepEqual(parseReleaseMessage("release: web 26.10.20.6 Help page\n\nbody"), { targets: ["web"], version: "26.10.20.6", note: "Help page" });
	assert.deepEqual(parseReleaseMessage("release: audio+web v26.10.20.6: retry"), { targets: ["web", "audio"], version: "26.10.20.6", note: "retry" });
	assert.deepEqual(parseReleaseMessage("Release: all"), { targets: ["web", "audio"], version: null, note: "" });
	assert.deepEqual(parseReleaseMessage("release: d1 - reload paths"), { targets: ["d1"], version: null, note: "reload paths" });
	assert.equal(parseReleaseMessage("Merge pull request #54 from khensolomon/stale-cache"), null);
	assert.equal(parseReleaseMessage("fix: release: web"), null, "only the start of the first line counts");
	assert.throws(() => parseTargets("site"), /unknown release target "site"/);
});

test("a plan needs one valid version, matching the message, with notes", () => {
	const plan = planRelease({ request: parseReleaseMessage("release: web 26.10.20.6 Help"), packageVersions: ["26.10.20.6", "26.10.20.6"], changelog });
	assert.deepEqual(plan, { targets: ["web"], version: "26.10.20.6", tag: "v26.10.20.6", note: "Help", notes: "- Help page\n- Retry" });
	const req = parseReleaseMessage("release: web");
	assert.throws(() => planRelease({ request: req, packageVersions: ["26.10.20.6", "26.10.20.5"], changelog }), /package versions differ/);
	assert.throws(() => planRelease({ request: parseReleaseMessage("release: web 26.10.20.5"), packageVersions: ["26.10.20.6", "26.10.20.6"], changelog }), /says v26\.10\.20\.5/);
	assert.throws(() => planRelease({ request: req, packageVersions: ["26.10.21.1", "26.10.21.1"], changelog }), /no "## v26\.10\.21\.1" section/);
	assert.throws(() => planRelease({ request: parseReleaseMessage("release: desktop"), packageVersions: ["26.10.20.6", "26.10.20.6"], changelog }), ReleaseError);
	assert.equal(changelogSection(changelog, "26.10.20.5"), "- Older");
});
