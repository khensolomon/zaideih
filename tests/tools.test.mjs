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

test("release-plan writes the workflow's outputs ($GITHUB_OUTPUT), the notes as a heredoc", async () => {
	const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { spawnSync } = await import("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "zaideih-plan-"));
	const out = join(dir, "out.txt");
	await writeFile(out, "");
	const version = JSON.parse(await readFile("package.json", "utf8")).version;
	const r = spawnSync(process.execPath, ["tools/release-plan.mjs", "--message", `release: web+audio ${version} the note`], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out } });
	assert.equal(r.status, 0, r.stderr);
	const text = await readFile(out, "utf8");
	assert.match(text, /^release=true\nweb=true\naudio=true\nd1=false\nversion=/m);
	assert.match(text, new RegExp(`^tag=v${version.replace(/\\./g, "\\\\.")}$`, "m"));
	assert.match(text, /^message=the note$/m);
	const heredoc = /^notes<<(EOF_[0-9a-f-]+)\n([\s\S]*?)\n\1\n/m.exec(text);
	assert.ok(heredoc, "the notes are a heredoc with a unique delimiter");
	assert.ok(heredoc[2].length > 0);
	// A message that is not a release: nothing written, exit 0.
	await writeFile(out, "");
	const none = spawnSync(process.execPath, ["tools/release-plan.mjs", "--message", "fix: typo"], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out } });
	assert.equal(none.status, 0);
	assert.equal(await readFile(out, "utf8"), "");
});

test("wrangler helper: the Worker's own copy, else WRANGLER through npx, else a clear error; failures carry wrangler's message", async () => {
	const { wrangler, wranglerCommand, WranglerError } = await import("../tools/lib/wrangler.mjs");
	assert.deepEqual(wranglerCommand({ exists: () => true, env: {} }).length, 1);
	assert.deepEqual(wranglerCommand({ exists: () => false, env: { WRANGLER: "wrangler@4" } }), ["npx", "--yes", "wrangler@4"]);
	assert.throws(() => wranglerCommand({ exists: () => false, env: {} }), WranglerError);
	const calls = [];
	const command = () => ["wrangler"];
	const spawn = (bin, args) => { calls.push([bin, ...args]); return { status: 0, stdout: "[]" }; };
	assert.equal(wrangler(["d1", "execute", "audio"], { spawn, command, config: "c.toml" }), "[]");
	assert.deepEqual(calls[0], ["wrangler", "d1", "execute", "audio", "--config", "c.toml"]);
	assert.throws(() => wrangler(["r2", "object", "delete"], { command, spawn: () => ({ status: 1, stderr: "no such object" }) }), /r2 object delete failed \(exit 1\):\nno such object/);
	assert.throws(() => wrangler(["d1"], { command, spawn: () => ({ error: new Error("ENOENT") }) }), /could not run wrangler: ENOENT/);
});
