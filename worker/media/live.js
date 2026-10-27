/**
 * Catalog changes made live, without a release (docs/live-catalog.md). The
 * catalog ships with each release, from git; a change applied live in the
 * Workspace is kept here, and the app applies it on top of the catalog it
 * shipped with (src/core/live-catalog.js) until a release carries it.
 *
 *   GET  /live                 public: { at, changes: [{ kind, id, field, value, base, refs }] }
 *                              (cached a minute at the edge)
 *   GET  /live/detail          Catalog right: the changes with who and when, and the latest log
 *   POST /live {changes}       Catalog right: made live (each replaces the one for its field)
 *   POST /live/remove {changes: [{kind, id, field}], why}
 *                              Catalog right: taken away; why is "undo" (the field is
 *                              back as released), "released" (a release carries it) or
 *                              "overtaken" (a release set the field to something else)
 *
 * The owner and co-owners hold the Catalog right; the owner gives it to
 * others (Members), as any right.
 */
import { MemberError, can, memberRow } from "./members.js";
import { sessionMember } from "./accounts.js";
import { cleanValue, DraftError } from "../../src/workspace/draft.js";
import { LIVE_FIELDS } from "../../src/core/live-catalog.js";

const MAX_CHANGES = 500;
const MAX_ROWS = 5000;
const LOG = 100;
const PUBLIC_S = 60;
const PUBLIC_KEY = new Request("https://cache.internal/live/v1");
const edge = () => globalThis.caches?.default ?? null;
const WHY = new Set(["undo", "released", "overtaken"]);

function answer(status, body, cors, extra = {}) {
	const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", ...extra });
	if (cors) headers.set("Access-Control-Allow-Origin", cors);
	if (cors && cors !== "*") headers.set("Vary", "Origin");
	return new Response(JSON.stringify(body), { status, headers });
}

async function readBody(request) {
	const text = await request.text();
	if (text.length > 512 * 1024) throw new MemberError("request body too large", 413);
	try {
		const v = JSON.parse(text || "{}");
		if (v && typeof v === "object" && !Array.isArray(v)) return v;
	} catch { /* below */ }
	throw new MemberError("body must be a JSON object");
}

/** A change's record id, checked: an album's ui, or a track's or artist's id. */
function itemId(kind, id) {
	if (kind === "album") {
		if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new MemberError("an album's id is letters, digits, - and _");
		return id;
	}
	if (!Number.isSafeInteger(id) || id < 0) throw new MemberError(`a ${kind}'s id is a whole number`);
	return String(id);
}
const typedId = (kind, text) => (kind === "album" ? text : Number(text));

const text = (v) => typeof v === "string" && v.length <= 300;
/** What the released catalog may lack to show a change: artists, languages and genres, as the compiled catalog has them. */
function cleanRefs(refs) {
	if (refs === undefined || refs === null) return {};
	if (typeof refs !== "object" || Array.isArray(refs)) throw new MemberError("refs must be an object");
	const out = {};
	const pairs = (list, what) => {
		if (!Array.isArray(list) || list.length > 50 || !list.every((x) => Array.isArray(x) && x.length === 2 && Number.isSafeInteger(x[0]) && text(x[1]))) throw new MemberError(`refs.${what} must be [id, name] pairs`);
		return list;
	};
	if (refs.langs !== undefined) out.langs = pairs(refs.langs, "langs");
	if (refs.genres !== undefined) out.genres = pairs(refs.genres, "genres");
	if (refs.artists !== undefined) {
		const ok = Array.isArray(refs.artists) && refs.artists.length <= 50 && refs.artists.every((a) => Array.isArray(a) && a.length === 5 && Number.isSafeInteger(a[0]) && text(a[1]) && a[1].trim() && typeof a[2] === "string" && Number.isSafeInteger(a[3]) && Array.isArray(a[4]) && a[4].every(text));
		if (!ok) throw new MemberError("refs.artists must be [id, name, aka, type, spellings] records");
		out.artists = refs.artists;
	}
	return out;
}

/** A change from the Workspace, checked as the draft checks it; its base must be another value of the same field. */
function cleanChange(c) {
	if (!c || typeof c !== "object") throw new MemberError("each change is { kind, id, field, value, base }");
	if (!LIVE_FIELDS[c.kind]?.includes(c.field)) throw new MemberError(`${c.kind}.${c.field} cannot change live`);
	const id = itemId(c.kind, c.id);
	let value;
	let base;
	try {
		value = cleanValue(c, c.value);
		base = cleanValue(c, c.base);
	} catch (err) {
		if (err instanceof DraftError) throw new MemberError(`${c.kind} ${c.id}: ${err.message}`);
		throw err;
	}
	if (c.field === "h" && value !== true) throw new MemberError("a hidden song is shown again with a release (it is not shipped)");
	if (JSON.stringify(value) === JSON.stringify(base)) throw new MemberError(`${c.kind} ${c.id}: ${c.field} is already that in the released catalog`);
	return { kind: c.kind, id, field: c.field, value, base, refs: cleanRefs(c.refs) };
}

/** What the app applies: every live change. */
export async function publicLive(env) {
	const rows = (await env.DB.prepare("SELECT kind, item_id, field, value, base, refs, at FROM catalog_live ORDER BY kind, item_id, field").all()).results ?? [];
	let at = 0;
	const changes = rows.map((r) => {
		at = Math.max(at, r.at);
		return { kind: r.kind, id: typedId(r.kind, r.item_id), field: r.field, value: JSON.parse(r.value), base: JSON.parse(r.base), refs: JSON.parse(r.refs) };
	});
	return { at, changes };
}

async function forgetPublic() {
	try { await edge()?.delete(PUBLIC_KEY); } catch (err) { console.warn("could not remove the live changes from the edge cache", err); }
}

export async function handleLive(request, env, ctx, { now = () => Date.now() } = {}) {
	const url = new URL(request.url);
	const match = /^\/live(?:\/(detail|remove))?\/?$/.exec(url.pathname);
	const origin = request.headers.get("origin");
	const origins = new Set((env.AUTH_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
	const cors = origin && origins.has(origin) ? origin : null;
	const m = request.method;
	if (m === "OPTIONS") {
		if (!cors) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" } });
	}
	if (!match) return answer(404, { error: "live catalog addresses are /live, /live/detail and /live/remove" }, cors ?? "*");
	const nowSeconds = Math.floor(now() / 1000);
	try {
		if (!env.DB) throw new MemberError("live catalog changes are not set up on this Worker: missing DB", 503);
		if (!match[1] && (m === "GET" || m === "HEAD")) {
			const cache = edge();
			const hit = cache ? await cache.match(PUBLIC_KEY) : null;
			const headers = { "Cache-Control": `public, max-age=${PUBLIC_S}` };
			if (hit) return answer(200, await hit.json(), "*", headers);
			const body = await publicLive(env);
			if (cache) {
				const put = cache.put(PUBLIC_KEY, new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${PUBLIC_S}` } }));
				if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
			}
			return answer(200, body, "*", headers);
		}
		if (!cors) throw new MemberError("this origin may not change the catalog (AUTH_ORIGINS)", 403);
		const me = await memberRow(env, await sessionMember(env, request, nowSeconds), nowSeconds);
		if (me.blocked) throw new MemberError(`blocked by ${me.blocked.by}: ${me.blocked.reason}`, 403);
		if (!can(me, "catalog")) throw new MemberError("this needs the Catalog right", 403);

		if (match[1] === "detail" && m === "GET") {
			const rows = (await env.DB.prepare("SELECT kind, item_id, field, value, base, refs, set_by, at FROM catalog_live ORDER BY at DESC").all()).results ?? [];
			const log = (await env.DB.prepare("SELECT kind, item_id, field, value, action, set_by, at FROM catalog_live_log ORDER BY at DESC, id DESC LIMIT ?1").bind(LOG).all()).results ?? [];
			return answer(200, {
				changes: rows.map((r) => ({ kind: r.kind, id: typedId(r.kind, r.item_id), field: r.field, value: JSON.parse(r.value), base: JSON.parse(r.base), refs: JSON.parse(r.refs), by: r.set_by, at: r.at })),
				log: log.map((r) => ({ kind: r.kind, id: typedId(r.kind, r.item_id), field: r.field, value: r.value === null ? null : JSON.parse(r.value), action: r.action, by: r.set_by, at: r.at })),
			}, cors);
		}
		if (m !== "POST" || match[1] === "detail") throw new MemberError(`no route ${m} ${url.pathname}`, 404);
		const body = await readBody(request);
		const list = body.changes;
		if (!Array.isArray(list) || !list.length || list.length > MAX_CHANGES) throw new MemberError(`changes must list 1 to ${MAX_CHANGES} changes`);

		if (match[1] === "remove") {
			const why = body.why ?? "undo";
			if (!WHY.has(why)) throw new MemberError(`why is one of ${[...WHY].join(", ")}`);
			const keys = list.map((c) => {
				if (!LIVE_FIELDS[c?.kind]?.includes(c.field)) throw new MemberError("each change to take away is { kind, id, field }");
				return { kind: c.kind, id: itemId(c.kind, c.id), field: c.field };
			});
			await env.DB.batch(keys.flatMap((k) => [
				env.DB.prepare("DELETE FROM catalog_live WHERE kind = ?1 AND item_id = ?2 AND field = ?3").bind(k.kind, k.id, k.field),
				env.DB.prepare("INSERT INTO catalog_live_log (kind, item_id, field, value, action, set_by, at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)").bind(k.kind, k.id, k.field, why, me.login, nowSeconds),
			]));
			await forgetPublic();
			return answer(200, await publicLive(env), cors);
		}

		const changes = list.map(cleanChange);
		const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM catalog_live").first();
		if (n + changes.length > MAX_ROWS) throw new MemberError(`there are ${n} live changes; release them before making more`, 409);
		await env.DB.batch(changes.flatMap((c) => [
			env.DB.prepare(`INSERT INTO catalog_live (kind, item_id, field, value, base, refs, set_by, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
				ON CONFLICT (kind, item_id, field) DO UPDATE SET value = excluded.value, base = excluded.base, refs = excluded.refs, set_by = excluded.set_by, at = excluded.at`)
				.bind(c.kind, c.id, c.field, JSON.stringify(c.value), JSON.stringify(c.base), JSON.stringify(c.refs), me.login, nowSeconds),
			env.DB.prepare("INSERT INTO catalog_live_log (kind, item_id, field, value, action, set_by, at) VALUES (?1, ?2, ?3, ?4, 'set', ?5, ?6)").bind(c.kind, c.id, c.field, JSON.stringify(c.value), me.login, nowSeconds),
		]));
		await forgetPublic();
		return answer(200, await publicLive(env), cors);
	} catch (err) {
		if (err instanceof MemberError) return answer(err.status, { error: err.message }, cors ?? "*");
		console.error("live catalog request failed", err);
		return answer(500, { error: "the live catalog request failed on the Worker" }, cors ?? "*");
	}
}
