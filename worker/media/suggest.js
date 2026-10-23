/**
 * Suggestions from people without write access to the repository (POST
 * /auth/suggest, routed by auth.js). They cannot push a branch, so the
 * Worker opens the pull request for them as the GitHub App "Zaideih", with
 * the commit authored by them, and an editor reviews and merges it.
 *
 * Request: Authorization: Bearer <the person's GitHub sign-in token>
 *   {"base": <commit sha on master>, "note": "...", "lines": ["...", ...],
 *    "files": {"assets/data/albums.json": "<text>", ...}}
 * Answer: {"number", "url", "branch"}
 *
 * The page builds the files (the same way it publishes for editors); the
 * Worker does not parse them, which would cost more CPU time than a request
 * is given. What keeps a suggestion harmless:
 *   - only the catalog's data files may change (SUGGEST_PATHS), up to
 *     MAX_FILE_BYTES each; the release files, code and workflows cannot;
 *   - the change is a pull request: nothing reaches master until someone
 *     with write access merges it, and the checks run on it first;
 *   - the person is who GitHub says the token belongs to, and is named on
 *     the commit and the pull request;
 *   - SUGGEST_LIMIT caps how often one person can send.
 *
 * Bindings: GITHUB_CLIENT_ID, GITHUB_REPO (vars), GITHUB_APP_KEY (secret,
 * the App's private key in PKCS#8 PEM form), SUGGEST_LIMIT (rate limiter).
 */

const API = "https://api.github.com";
const USER_AGENT = "zaideih-media-worker";
// media.json: a reviewer without write access publishing a member's album (docs/library.md).
export const SUGGEST_PATHS = new Set(["assets/data/albums.json", "assets/data/artist.name.json", "assets/data/media.json"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_NOTE = 120;
const MAX_LINES = 300;

export class SuggestError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

/* ------------------------------------------------------------ App token ---- */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

async function importKey(pem) {
	if (!/-----BEGIN PRIVATE KEY-----/.test(pem)) {
		throw new SuggestError("GITHUB_APP_KEY must be the App's private key in PKCS#8 form (BEGIN PRIVATE KEY); convert it with: openssl pkcs8 -topk8 -nocrypt -in key.pem", 503);
	}
	const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** The JWT that authenticates as the App itself (10 minutes at most; issued a minute early for clock drift). */
export async function appJwt(clientId, pem, nowSeconds = Math.floor(Date.now() / 1000)) {
	const head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const body = b64urlText(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: clientId }));
	const key = await importKey(pem);
	const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
	return `${head}.${body}.${b64url(sig)}`;
}

/** Installation token for the repository, kept per isolate until 5 minutes before it ends. */
let installation = null;

async function gh(fetchImpl, method, path, token, body) {
	const res = await fetchImpl(`${API}${path}`, {
		method,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"User-Agent": USER_AGENT,
			"X-GitHub-Api-Version": "2022-11-28",
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		let detail = "";
		try { detail = (await res.json()).message ?? ""; } catch { /* not JSON */ }
		throw new SuggestError(`GitHub ${method} ${path}: HTTP ${res.status} ${detail}`.trim(), res.status === 401 ? 401 : 502);
	}
	return res.status === 204 ? null : res.json();
}

async function installationToken(env, fetchImpl, now) {
	if (installation && installation.expires - 5 * 60_000 > now) return installation.token;
	const jwt = await appJwt(env.GITHUB_CLIENT_ID, env.GITHUB_APP_KEY, Math.floor(now / 1000));
	const inst = await gh(fetchImpl, "GET", `/repos/${env.GITHUB_REPO}/installation`, jwt);
	const repoName = env.GITHUB_REPO.split("/")[1];
	const t = await gh(fetchImpl, "POST", `/app/installations/${inst.id}/access_tokens`, jwt, {
		repositories: [repoName],
		permissions: { contents: "write", pull_requests: "write" },
	});
	installation = { token: t.token, expires: Date.parse(t.expires_at) };
	return installation.token;
}

/** For tests: forget the cached installation token. */
export function resetInstallation() {
	installation = null;
}

/* ---------------------------------------------------------------- input ---- */

/** Checks a suggestion's body; returns it cleaned or throws SuggestError with the reason. */
export function checkSuggestion(body) {
	if (!body || typeof body !== "object") throw new SuggestError("body must be a JSON object");
	const { base, note, lines, files } = body;
	if (typeof base !== "string" || !/^[0-9a-f]{40}$/.test(base)) throw new SuggestError("base must be the commit the files were built on (40 hex characters)");
	if (typeof note !== "string" || !note.trim() || note.length > MAX_NOTE) throw new SuggestError(`note must be 1 to ${MAX_NOTE} characters`);
	if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES || lines.some((l) => typeof l !== "string" || l.length > 500)) {
		throw new SuggestError(`lines must list the changes, 1 to ${MAX_LINES} lines`);
	}
	if (!files || typeof files !== "object" || !Object.keys(files).length) throw new SuggestError("files must name at least one changed file");
	for (const [path, text] of Object.entries(files)) {
		if (!SUGGEST_PATHS.has(path)) throw new SuggestError(`${path} cannot be changed by a suggestion; only ${[...SUGGEST_PATHS].join(", ")}`, 403);
		if (typeof text !== "string" || !text.length) throw new SuggestError(`${path} must be the file's text`);
		if (text.length > MAX_FILE_BYTES) throw new SuggestError(`${path} is larger than ${MAX_FILE_BYTES} bytes`, 413);
	}
	// Markdown in the pull request: one line each, no HTML.
	const plain = (t) => t.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "").trim();
	return { base, note: plain(note), lines: lines.map(plain), files };
}

/* ---------------------------------------------------------------- route ---- */

/**
 * @param {Request} request  already checked for an allowed origin by auth.js
 * @returns {Promise<object>} { number, url, branch }
 */
export async function suggest(request, env, body, { fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
	const missing = ["GITHUB_CLIENT_ID", "GITHUB_REPO", "GITHUB_APP_KEY", "SUGGEST_LIMIT"].filter((k) => !env[k]);
	if (missing.length) throw new SuggestError(`suggestions are not set up on this Worker: missing ${missing.join(", ")}`, 503);
	const auth = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
	if (!auth) throw new SuggestError("sign in with GitHub first", 401);
	const s = checkSuggestion(body);

	// Who is sending: whoever GitHub says the token belongs to.
	const user = await gh(fetchImpl, "GET", "/user", auth[1]);
	const { success } = await env.SUGGEST_LIMIT.limit({ key: `suggest:${user.id}` });
	if (!success) throw new SuggestError("too many suggestions in a short time; wait a minute and send again", 429);

	const token = await installationToken(env, fetchImpl, now());
	const repo = `/repos/${env.GITHUB_REPO}`;
	const parent = await gh(fetchImpl, "GET", `${repo}/git/commits/${s.base}`, token);
	const tree = [];
	for (const [path, content] of Object.entries(s.files)) {
		const blob = await gh(fetchImpl, "POST", `${repo}/git/blobs`, token, { content, encoding: "utf-8" });
		tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
	}
	const newTree = await gh(fetchImpl, "POST", `${repo}/git/trees`, token, { base_tree: parent.tree.sha, tree });
	const title = `Suggestion: ${s.note}`;
	const author = { name: user.login, email: `${user.id}+${user.login}@users.noreply.github.com`, date: new Date(now()).toISOString() };
	const commit = await gh(fetchImpl, "POST", `${repo}/git/commits`, token, {
		message: `${title}\n\nSuggested by @${user.login} on the admin page.`,
		tree: newTree.sha,
		parents: [s.base],
		author,
	});
	const branch = `suggest-${user.login.toLowerCase()}-${now().toString(36)}`;
	await gh(fetchImpl, "POST", `${repo}/git/refs`, token, { ref: `refs/heads/${branch}`, sha: commit.sha });
	const pr = await gh(fetchImpl, "POST", `${repo}/pulls`, token, {
		title,
		head: branch,
		base: "master",
		body: `Suggested by @${user.login} on the admin page.\n\n${s.lines.map((l) => `- ${l}`).join("\n")}\n\nMerging adds it to master; it ships with the next release.`,
		maintainer_can_modify: true,
	});
	return { number: pr.number, url: pr.html_url, branch };
}
