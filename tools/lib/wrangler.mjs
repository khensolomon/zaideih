/**
 * Running wrangler from the tools (tools/d1.mjs, tools/inplace.mjs): the
 * Worker's own copy (worker/media/node_modules), or the one WRANGLER names
 * through npx. Throws WranglerError with wrangler's own message, so each
 * tool stops with it (fail()).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export class WranglerError extends Error {}

export const CONFIG = "worker/media/wrangler.toml";

/** The command to run wrangler with: [bin, ...leading args]. */
export function wranglerCommand({ exists = existsSync, env = process.env } = {}) {
	const own = resolve("worker/media/node_modules/.bin/wrangler");
	if (exists(own)) return [own];
	if (env.WRANGLER) return ["npx", "--yes", env.WRANGLER];
	throw new WranglerError("wrangler is not installed. Run: npm --prefix worker/media install (or set WRANGLER, e.g. WRANGLER=wrangler@4.151.2)");
}

/** Runs wrangler with `args` (the config added) and answers its stdout. */
export function wrangler(args, { config = CONFIG, maxBuffer = 256 * 1024 * 1024, spawn = spawnSync, command = wranglerCommand } = {}) {
	const [bin, ...pre] = command();
	const r = spawn(bin, [...pre, ...args, "--config", config], { encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
	if (r.error) throw new WranglerError(`could not run wrangler: ${r.error.message}`);
	if (r.status !== 0) throw new WranglerError(`wrangler ${args.slice(0, 3).join(" ")} failed (exit ${r.status}):\n${(r.stderr || r.stdout || "").trim().slice(-2000)}`);
	return r.stdout;
}
