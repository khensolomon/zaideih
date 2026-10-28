import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHeaders } from "../tools/serve.mjs";
import { VersionError, datePart, nextVersion, parseVersion } from "../tools/lib/version.mjs";

test("parseVersion accepts yy.mm.dd.changes and rejects everything else", () => {
	assert.deepEqual(parseVersion("26.10.19.1"), { date: "26.10.19", changes: 1 });
	assert.deepEqual(parseVersion("26.10.19.12"), { date: "26.10.19", changes: 12 });
	for (const bad of ["26.10.19", "v26.10.19.1", "26.10.19.0", "26.10.19.01", "26.1.19.1", "27.0.0", "", undefined]) {
		assert.throws(() => parseVersion(bad), VersionError, String(bad));
	}
	assert.throws(() => parseVersion("26.02.30.1"), /does not exist/);
	assert.doesNotThrow(() => parseVersion("28.02.29.1"));
});

test("nextVersion increments within a day and restarts on a new day", () => {
	// UTC days: the same version from any time zone.
	const oct19 = new Date(Date.UTC(2026, 9, 19, 12));
	const oct20 = new Date(Date.UTC(2026, 9, 20, 0, 5));
	assert.equal(datePart(new Date(Date.UTC(2026, 9, 19, 23, 59))), "26.10.19", "late in the UTC day, whatever the local clock says");
	assert.equal(datePart(oct19), "26.10.19");
	assert.equal(nextVersion(undefined, oct19), "26.10.19.1");
	assert.equal(nextVersion("26.10.19.1", oct19), "26.10.19.2");
	assert.equal(nextVersion("26.10.19.9", oct20), "26.10.20.1");
	assert.throws(() => nextVersion("26.10.20.1", oct19), /dated after today/);
});

test("parseHeaders reads Cloudflare _headers rules", () => {
	const rules = parseHeaders("# comment\n/*\n  X-A: 1\n  CSP: a; b: c\n\n/assets/*\n  Cache-Control: immutable\n");
	assert.deepEqual(rules, [
		{ pattern: "/*", headers: [["X-A", "1"], ["CSP", "a; b: c"]] },
		{ pattern: "/assets/*", headers: [["Cache-Control", "immutable"]] },
	]);
});
