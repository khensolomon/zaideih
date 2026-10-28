/**
 * The few GitHub REST calls the Workspace needs, with either a GitHub
 * sign-in (the GitHub App's user token, src/workspace/session.js) or a
 * fine-grained token (repository khensolomon/zaideih only: Contents read and
 * write, Pull requests read and write, Checks read). Both can do only what
 * the person may do on the repository. Every failure throws GitHubError with
 * GitHub's own message.
 */
import { LEVELS, levelOf } from "../core/access.js";

export const REPO = "khensolomon/zaideih";
export const BASE = "master";
const API = "https://api.github.com";

export class GitHubError extends Error {
	constructor(message, status) {
		super(message);
		this.name = "GitHubError";
		this.status = status;
	}
}

/**
 * @param {string | (() => Promise<string>)} token  a token, or a function that
 *   answers the current one (a GitHub sign-in renews its token every 8 hours)
 */
export function createGitHub(token, { fetchImpl = (...a) => fetch(...a) } = {}) {
	const tokenNow = typeof token === "function" ? token : async () => token;
	async function call(method, path, body, { accept = "application/vnd.github+json", raw = false } = {}) {
		const res = await fetchImpl(`${API}${path}`, {
			method,
			headers: {
				Accept: accept,
				Authorization: `Bearer ${await tokenNow()}`,
				"X-GitHub-Api-Version": "2022-11-28",
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			cache: "no-store",
		});
		if (!res.ok) {
			let detail = "";
			try { const j = await res.json(); detail = j.message + (j.errors ? ` (${JSON.stringify(j.errors)})` : ""); } catch { /* not JSON */ }
			const hint = res.status === 401 ? " The sign-in or token is wrong or expired." : res.status === 403 || res.status === 404 ? " The token may lack a permission (Contents, Pull requests and Checks on the zaideih repository)." : "";
			throw new GitHubError(`GitHub ${method} ${path}: HTTP ${res.status} ${detail}${hint}`.trim(), res.status);
		}
		if (raw) return res.text();
		return res.status === 204 ? null : res.json();
	}

	return {
		/** The token's user, their level (src/core/access.js) and whether they may write to the repository. */
		async whoami() {
			const [user, repo] = await Promise.all([call("GET", "/user"), call("GET", `/repos/${REPO}`)]);
			const level = levelOf(repo.permissions ?? {});
			return { login: user.login, name: user.name ?? "", avatar: user.avatar_url ?? "", level, canWrite: LEVELS[level].canWrite };
		},
		/**
		 * What the person has had released: their merged catalog edits (pull
		 * requests titled "Catalog: …") and their merged suggestions (opened by
		 * the App, naming them). Answers { edits, suggestions }.
		 */
		async contributions(login) {
			const count = async (q) => (await call("GET", `/search/issues?q=${encodeURIComponent(q)}&per_page=1`)).total_count;
			const [edits, suggestions] = await Promise.all([
				count(`repo:${REPO} is:pr is:merged author:${login} in:title "Catalog:"`),
				count(`repo:${REPO} is:pr is:merged in:body "Suggested by @${login}"`),
			]);
			return { edits, suggestions };
		},
		/** Open suggestions (pull requests opened for people without write access, worker/media/suggest.js). */
		async suggestions() {
			const prs = await call("GET", `/repos/${REPO}/pulls?state=open&base=${BASE}&per_page=50`);
			return prs.filter((p) => p.head.ref.startsWith("suggest-")).map((p) => ({
				number: p.number, title: p.title, url: p.html_url, body: p.body ?? "", created: p.created_at,
				by: /Suggested by @([\w-]+)/.exec(p.body ?? "")?.[1] ?? p.user.login,
			}));
		},
		/** The newest commit on the base branch. */
		async head() {
			const ref = await call("GET", `/repos/${REPO}/git/ref/heads/${BASE}`);
			return ref.object.sha;
		},
		/** A file's text at a commit (one request: the raw content; a blob sha is not needed, propose() makes its own blobs). */
		async file(path, ref) {
			const text = await call("GET", `/repos/${REPO}/contents/${path}?ref=${ref}`, null, { accept: "application/vnd.github.raw+json", raw: true });
			return { text };
		},
		/**
		 * Commits `files` ({path: text}) on a new branch from `parent` and opens a
		 * pull request into the base branch. Returns { number, url, head }.
		 */
		async propose({ parent, files, branch, title, body }) {
			const base = await call("GET", `/repos/${REPO}/git/commits/${parent}`);
			// The blobs at once: a release touches several files.
			const tree = await Promise.all(Object.entries(files).map(async ([path, content]) => {
				const blob = await call("POST", `/repos/${REPO}/git/blobs`, { content, encoding: "utf-8" });
				return { path, mode: "100644", type: "blob", sha: blob.sha };
			}));
			const newTree = await call("POST", `/repos/${REPO}/git/trees`, { base_tree: base.tree.sha, tree });
			const commit = await call("POST", `/repos/${REPO}/git/commits`, { message: title, tree: newTree.sha, parents: [parent] });
			try {
				await call("POST", `/repos/${REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
			} catch (err) {
				if (err.status === 422) throw new GitHubError(`${err.message}. The branch ${branch} could not be created: a branch of that name, or one named like a folder of it, may already exist.`, 422);
				throw err;
			}
			const pr = await call("POST", `/repos/${REPO}/pulls`, { title, head: branch, base: BASE, body });
			return { number: pr.number, url: pr.html_url, head: commit.sha };
		},
		/** The pull request's state and its checks: { state, merged, head, checks: [{name, status, conclusion}] }. */
		async status(number) {
			const pr = await call("GET", `/repos/${REPO}/pulls/${number}`);
			const runs = await call("GET", `/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=50`);
			return {
				state: pr.state,
				merged: pr.merged,
				mergeable: pr.mergeable,
				head: pr.head.sha,
				branch: pr.head.ref,
				title: pr.title,
				url: pr.html_url,
				checks: runs.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url })),
			};
		},
		/** Squash-merges with `title` as the commit's first line (the release line). */
		async merge(number, head, title, message) {
			return call("PUT", `/repos/${REPO}/pulls/${number}/merge`, { merge_method: "squash", sha: head, commit_title: title, commit_message: message });
		},
		/** Closes the pull request without merging. */
		async close(number) {
			return call("PATCH", `/repos/${REPO}/pulls/${number}`, { state: "closed" });
		},
		/** Deletes the pull request's branch after merging. */
		async deleteBranch(branch) {
			return call("DELETE", `/repos/${REPO}/git/refs/heads/${branch}`);
		},
	};
}
