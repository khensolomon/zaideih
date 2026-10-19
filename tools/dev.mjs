#!/usr/bin/env node
/**
 * Development loop for the web app:
 *   1. compiles the catalog into build/catalog (generated files only)
 *   2. builds dist/web with --dev (unminified, source maps, no service worker)
 *   3. serves it on http://localhost:8080 with live reload
 *   4. rebuilds on changes in src/ and platforms/web/, and recompiles the
 *      catalog on changes in assets/data/
 *
 * A failed rebuild keeps the last good build online and prints the error.
 *
 *   node tools/dev.mjs [--port 8080] [--host 127.0.0.1]
 *
 * Audio streams from ZAIDEIH_AUDIO_URL (default https://media.zaideih.com/audio/{id}).
 * http://localhost:8080 is in the audio Worker's ALLOWED_ORIGINS, so downloads work too.
 */
import { spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { parseArgs } from "node:util";
import { serve } from "./serve.mjs";

const { values } = parseArgs({
	options: {
		port: { type: "string", default: "8080" },
		host: { type: "string", default: "127.0.0.1" },
	},
	strict: true,
});

function run(script, args) {
	const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
	return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
}

function catalog() {
	const r = run("tools/catalog.mjs", ["--apply"]);
	if (!r.ok) console.error(r.out);
	return r.ok;
}

function build() {
	const started = Date.now();
	const r = run("tools/build.mjs", ["--platform", "web", "--dev"]);
	if (r.ok) console.log(`${new Date().toLocaleTimeString()}  rebuilt in ${Date.now() - started} ms`);
	else console.error(`${new Date().toLocaleTimeString()}  build failed:\n${r.out}`);
	return r;
}

if (!catalog()) process.exit(1);
const first = build();
if (!first.ok) process.exit(1);
console.log(first.out.split("\n").slice(1).join("\n"));

let dev;
try {
	dev = await serve({ dir: "dist/web", port: Number(values.port), host: values.host, live: true });
} catch (err) {
	console.error(`error: ${err.message}`);
	process.exit(1);
}
console.log(`\nZaideih dev server: ${dev.url}\nWatching src/, platforms/web/ and assets/data/ (Ctrl+C to stop)\n`);

let timer = 0;
let dataChanged = false;
function schedule(isData) {
	dataChanged ||= isData;
	clearTimeout(timer);
	timer = setTimeout(() => {
		const recompile = dataChanged;
		dataChanged = false;
		if (recompile && !catalog()) return;
		const r = build();
		if (r.ok) dev.reload();
		else dev.reload("error-build", r.out);
	}, 150);
}

for (const [dir, isData] of [["src", false], ["platforms/web", false], ["assets/data", true]]) {
	watch(dir, { recursive: true }, (_event, file) => {
		if (file && !/(^|\/)\.|~$/.test(file)) schedule(isData);
	});
}
