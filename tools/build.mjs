#!/usr/bin/env node
/**
 * Platform build. Bundles the shared app (src/) with a platform entry point
 * using esbuild and writes a self-contained output directory.
 *
 *   --platform web       dist/web: PWA with service worker, manifest and Cloudflare _headers
 *   --platform desktop   platforms/desktop/app: renderer files loaded by Electron over app://
 *
 * Both outputs include the catalog from build/catalog, so run
 * `node tools/catalog.mjs --apply` first.
 *
 * Environment:
 *   ZAIDEIH_AUDIO_URL   audio URL template (see src/config.js).
 *   ZAIDEIH_GA_ID       Google Analytics 4 measurement id for the web build
 *                       (default G-65TTKMZEGC; empty disables). Dev and
 *                       desktop builds never include analytics.
 *   ZAIDEIH_PLAYS_URL   where song plays are counted (src/core/plays.js).
 *                       Default: /plays on the audio origin for production
 *                       builds, off for --dev builds; empty disables. Must be
 *                       on the audio origin, which the CSP already allows.
 *
 * Usage:
 *   node tools/build.mjs --platform web
 *   node tools/build.mjs --platform desktop
 *   node tools/build.mjs --platform web --dev     unminified, inline source maps, no service worker
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import * as esbuild from "esbuild";
import { VersionError, parseVersion } from "./lib/version.mjs";

const DEFAULT_AUDIO_URL = "https://media.zaideih.com/audio/{id}";
const DEFAULT_GA_ID = "G-65TTKMZEGC";
const CATALOG = "build/catalog";
const TARGET = ["es2021", "chrome100", "safari15", "firefox100"];

const PLATFORMS = {
	web: {
		entry: "platforms/web/main.js",
		out: "dist/web",
		public: "platforms/web/public",
		head: [
			'<meta name="theme-color" content="#5a5a5a">',
			'<link rel="manifest" href="manifest.webmanifest">',
			'<link rel="icon" href="icons/icon.svg" type="image/svg+xml">',
			'<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
			'<link rel="preload" href="catalog/meta.json" as="fetch" crossorigin="anonymous">',
		],
	},
	desktop: {
		entry: "platforms/desktop/renderer.js",
		out: "platforms/desktop/app",
		public: null,
		head: ['<link rel="icon" href="icons/icon.svg" type="image/svg+xml">'],
	},
};

function die(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

const { values } = parseArgs({
	options: {
		platform: { type: "string" },
		dev: { type: "boolean", default: false },
	},
	strict: true,
});
const platform = PLATFORMS[values.platform];
if (!platform) die(`--platform must be one of: ${Object.keys(PLATFORMS).join(", ")}`);
const dev = values.dev;
const OUT = platform.out;

// Release version (yy.mm.dd.changes) from package.json; shown in the app.
const release = JSON.parse(await readFile("package.json", "utf8")).version;
try {
	parseVersion(release);
} catch (err) {
	if (err instanceof VersionError) die(`package.json: ${err.message}. Run: node tools/version.mjs --apply`);
	throw err;
}

const audioTemplate = (process.env.ZAIDEIH_AUDIO_URL ?? DEFAULT_AUDIO_URL).trim();
let audioOrigin;
try {
	audioOrigin = new URL(audioTemplate.replace(/\{[a-z]+\}/g, "x")).origin;
} catch {
	die(`ZAIDEIH_AUDIO_URL is not a valid URL template: ${audioTemplate}`);
}
if (!/\{(id|n)\}/.test(audioTemplate)) die("ZAIDEIH_AUDIO_URL must contain {id} or {n} so each track resolves to its own file.");

// Play counting: production builds of both platforms (src/core/plays.js).
const playsUrl = (process.env.ZAIDEIH_PLAYS_URL ?? (dev ? "" : `${audioOrigin}/plays`)).trim();
if (playsUrl) {
	let origin;
	try { origin = new URL(playsUrl).origin; } catch { die(`ZAIDEIH_PLAYS_URL is not a valid URL: ${playsUrl}`); }
	if (origin !== audioOrigin) die(`ZAIDEIH_PLAYS_URL must be on the audio origin ${audioOrigin}, got ${playsUrl}`);
}

// Analytics: production web builds only, and only after the listener agrees (src/core/analytics.js).
const gaId = values.platform === "web" && !dev ? (process.env.ZAIDEIH_GA_ID ?? DEFAULT_GA_ID).trim() : "";
if (gaId && !/^G-[A-Z0-9]{4,}$/.test(gaId)) die(`ZAIDEIH_GA_ID must look like G-XXXXXXXXXX (or be empty to disable analytics), got "${gaId}"`);

let catalogMeta;
try {
	catalogMeta = JSON.parse(await readFile(join(CATALOG, "meta.json"), "utf8"));
	await stat(join(CATALOG, catalogMeta.catalog));
} catch (err) {
	die(`catalog is missing or incomplete (${err.message}). Run: node tools/catalog.mjs --apply`);
}

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(p)));
		else out.push(p);
	}
	return out;
}
const posix = (p) => p.split("\\").join("/");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// 1. The sound worklet (src/core/sound-worklet.js): its own file, loaded by
// the app with audioWorklet.addModule(), so the app needs its hashed name.
const worklet = await esbuild.build({
	entryPoints: { "sound-worklet": "src/core/sound-worklet.js" },
	outdir: join(OUT, "assets"),
	entryNames: "[name].[hash]",
	bundle: true,
	format: "esm",
	target: TARGET,
	minify: !dev,
	sourcemap: dev ? "inline" : false,
	legalComments: "none",
	metafile: true,
	logLevel: "warning",
});
const workletFile = Object.keys(worklet.metafile.outputs).map((p) => posix(relative(OUT, p))).find((p) => /^assets\/sound-worklet\.[^/]+\.js$/.test(p));
if (!workletFile) die(`unexpected esbuild output for the sound worklet: ${Object.keys(worklet.metafile.outputs).join(", ")}`);

// 2. App bundle (JS + CSS + fonts), content-hashed.
const app = await esbuild.build({
	entryPoints: { app: platform.entry, style: "src/ui/app.css" },
	outdir: join(OUT, "assets"),
	entryNames: "[name].[hash]",
	assetNames: "[name].[hash]",
	bundle: true,
	format: "esm",
	target: TARGET,
	minify: !dev,
	sourcemap: dev ? "inline" : false,
	legalComments: "none",
	loader: { ".woff2": "file" },
	metafile: true,
	logLevel: "warning",
	define: {
		__AUDIO_URL__: JSON.stringify(audioTemplate),
		__APP_VERSION__: JSON.stringify(release),
		__DEV__: JSON.stringify(dev),
		__GA_ID__: JSON.stringify(gaId),
		__PLAYS_URL__: JSON.stringify(playsUrl),
		__SOUND_WORKLET__: JSON.stringify(workletFile),
	},
});
const outputs = Object.keys(app.metafile.outputs).map((p) => posix(relative(OUT, p)));
const js = outputs.find((p) => /^assets\/app\.[^/]+\.js$/.test(p));
const css = outputs.find((p) => /^assets\/style\.[^/]+\.css$/.test(p));
if (!js || !css) die(`unexpected esbuild outputs: ${outputs.join(", ")}`);

// 3. Static files and catalog.
if (platform.public) await cp(platform.public, OUT, { recursive: true });
else await cp("platforms/web/public/icons", join(OUT, "icons"), { recursive: true });
await cp("platforms/web/public/licenses", join(OUT, "licenses"), { recursive: true, force: true });
await mkdir(join(OUT, "catalog"), { recursive: true });
await cp(join(CATALOG, "meta.json"), join(OUT, "catalog", "meta.json"));
await cp(join(CATALOG, catalogMeta.catalog), join(OUT, "catalog", catalogMeta.catalog));

// 4. index.html.
const template = await readFile("src/index.html", "utf8");
for (const marker of ["%JS%", "%CSS%", "<!--%HEAD%-->"]) {
	if (!template.includes(marker)) die(`src/index.html is missing the ${marker} placeholder`);
}
const index = template
	.replace("%JS%", js)
	.replace("%CSS%", css)
	// The release workflow reads data-version from the live page to confirm a deploy.
	.replace("<!--%HEAD%-->", [`<meta name="application-name" content="Zaideih" data-version="${release}">`, ...platform.head].join("\n  "));
await writeFile(join(OUT, "index.html"), index);

// 5. Build id = hash of everything shipped; names the service worker cache.
const files = (await walk(OUT)).map((p) => posix(relative(OUT, p))).sort();
const h = createHash("sha256");
for (const f of files) h.update(f).update(await readFile(join(OUT, f)));
const buildId = h.digest("hex").slice(0, 12);

// 6. Web only: service worker and Cloudflare headers.
if (values.platform === "web") {
	const precache = [
		"./",
		...files.filter((f) =>
			f.startsWith("assets/") || f.startsWith("icons/") || f === "manifest.webmanifest" ||
			f === "catalog/meta.json" || f === `catalog/${catalogMeta.catalog}`),
	];
	await esbuild.build({
		entryPoints: ["platforms/web/sw.js"],
		outfile: join(OUT, "sw.js"),
		bundle: true,
		format: "iife",
		target: TARGET,
		minify: !dev,
		legalComments: "none",
		logLevel: "warning",
		define: {
			__PRECACHE__: JSON.stringify(precache),
			__VERSION__: JSON.stringify(`${release}-${buildId}`),
		},
	});

	const media = ["'self'", "blob:", audioOrigin].join(" ");
	// Google's documented hosts for GA4 (gtag.js), added only when analytics is built in.
	const ga = gaId ? { script: " https://*.googletagmanager.com", img: " https://*.google-analytics.com https://*.googletagmanager.com", connect: " https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com" } : { script: "", img: "", connect: "" };
	const connect = ["'self'", audioOrigin].join(" ") + ga.connect;
	await writeFile(join(OUT, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'${ga.script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${ga.img}; font-src 'self'; media-src ${media}; connect-src ${connect}; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'

/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/catalog/meta.json
  Cache-Control: no-cache
/catalog/catalog.*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`);
} else {
	// The desktop main process reads this to build its Content-Security-Policy.
	await writeFile(join(OUT, "build.json"), JSON.stringify({ version: release, buildId, audioOrigin }, null, 2) + "\n");
}

const all = await walk(OUT);
const total = (await Promise.all(all.map((f) => stat(f)))).reduce((s, st) => s + st.size, 0);
console.log(`built ${values.platform}${dev ? " (dev)" : ""} v${release} (${buildId}): ${all.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB in ${OUT}`);
console.log(`  catalog ${catalogMeta.version} (${catalogMeta.counts.tracks} tracks)`);
console.log(`  audio   ${audioTemplate}`);
console.log(`  plays   ${playsUrl || "off"}`);
