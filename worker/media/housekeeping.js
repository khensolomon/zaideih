/**
 * Housekeeping, once a day (wrangler.toml `[triggers]`, the `scheduled`
 * handler in script.js), instead of a little on every request:
 *
 *   - approved requests whose songs the release has loaded are settled
 *     (requests.js settleReleased), all of them;
 *   - uploads left half-done for an hour (a closed tab) go, with any object;
 *   - invites unused for INVITE_DAYS go (shares.js);
 *   - old passkey challenges and sign-in waits go;
 *   - sessions past their expiry go (nothing else ever removed them).
 *
 * Each step is its own try: one failing never stops the others, and each is
 * logged. `run` answers what was done, for the log and for tests.
 */
import { settleReleased } from "./requests.js";
import { INVITE_DAYS } from "./shares.js";
import { isUpload } from "./library.js";

const STALE_UPLOAD_S = 3600;
const CHALLENGE_S = 300;
const WAIT_S = 300;

export async function run(env, nowSeconds = Math.floor(Date.now() / 1000)) {
	const done = {};
	const step = async (name, fn) => {
		try {
			done[name] = await fn();
		} catch (err) {
			done[name] = `failed: ${err.message}`;
			console.error(`housekeeping: ${name} failed`, err);
		}
	};
	await step("settled", async () => {
		let n = 0;
		// A few per call (within one request's queries); until none are ready.
		for (let i = 0; i < 20; i++) {
			const k = await settleReleased(env);
			n += k;
			if (!k) break;
		}
		return n;
	});
	await step("staleUploads", async () => {
		const rows = (await env.DB.prepare("SELECT id, r2_key FROM uploads WHERE status = 'uploading' AND created_at < ?1 LIMIT 500").bind(nowSeconds - STALE_UPLOAD_S).all()).results ?? [];
		if (!rows.length) return 0;
		await env.DB.prepare(`DELETE FROM uploads WHERE id IN (${rows.map((_, i) => `?${i + 1}`).join(", ")})`).bind(...rows.map((r) => r.id)).run();
		const keys = rows.map((r) => r.r2_key).filter(isUpload);
		if (keys.length) await env.BUCKET.delete(keys);
		return rows.length;
	});
	await step("invites", async () => (await env.DB.prepare("DELETE FROM library_shares WHERE member_id IS NULL AND created_at < ?1").bind(nowSeconds - INVITE_DAYS * 86400).run()).meta?.changes ?? 0);
	await step("challenges", async () => (await env.DB.prepare("DELETE FROM passkey_challenges WHERE created_at < ?1").bind(nowSeconds - CHALLENGE_S).run()).meta?.changes ?? 0);
	await step("waits", async () => (await env.DB.prepare("DELETE FROM signin_waiting WHERE created_at < ?1").bind(nowSeconds - WAIT_S).run()).meta?.changes ?? 0);
	await step("sessions", async () => (await env.DB.prepare("DELETE FROM member_sessions WHERE expires_at < ?1").bind(nowSeconds).run()).meta?.changes ?? 0);
	console.log("housekeeping", JSON.stringify(done));
	return done;
}
