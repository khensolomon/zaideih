/**
 * Probes a failed song to find out why it failed, and returns a diagnostic
 * code (see diagnostic.js). The probe reads at most the first 16 bytes:
 * from the downloaded copy, or from the server with a ranged, uncached
 * request, which also reports the Worker's lookup headers.
 */
import { APP_VERSION, audioUrl } from "../config.js";
import { encodeCode, sniff } from "./diagnostic.js";
import { offline } from "./offline.js";

const PROBE_TIMEOUT_MS = 5000;
const HEAD_BYTES = 16;

async function probeServer(track) {
	const out = { probed: true };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const res = await fetch(audioUrl(track), {
			headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
			cache: "no-store",
			credentials: "omit",
			signal: controller.signal,
		});
		out.status = res.status;
		out.lookup = res.headers.get("X-Zaideih-Meta") ?? "not-reported";
		const reason = res.headers.get("X-Zaideih-Reason");
		out.noTrack = reason === "no-track";
		out.noObject = reason === "no-object";
		const total = /\/(\d+)$/.exec(res.headers.get("Content-Range") ?? "")?.[1] ?? res.headers.get("Content-Length");
		if (total) out.sizeBytes = Number(total);
		if (res.ok) out.signature = sniff(new Uint8Array(await res.arrayBuffer()).slice(0, HEAD_BYTES));
	} catch {
		out.unreachable = true;
	} finally {
		clearTimeout(timer);
	}
	return out;
}

async function probeDownload(track) {
	const blob = await offline.blob(track.id);
	if (!blob) return { kind: "download-missing" };
	return {
		sizeBytes: blob.size,
		signature: sniff(new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer())),
	};
}

/**
 * @param {object} track  catalog track
 * @param {string} kind   one of diagnostic KINDS
 * @param {object} [extra] more flags, e.g. { retried: true }
 * @returns {Promise<string>} the diagnostic code
 */
export async function diagnose(track, kind, extra = {}) {
	const download = offline.has(track.id);
	const d = {
		kind,
		trackId: track.id,
		version: APP_VERSION,
		at: Date.now(),
		download,
		desktop: document.documentElement.dataset.platform === "desktop",
		online: navigator.onLine,
		...extra,
	};
	if (kind !== "offline") Object.assign(d, download ? await probeDownload(track) : await probeServer(track));
	return encodeCode(d);
}
