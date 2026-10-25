# Releasing

Two workflows in `.github/workflows/`:

- **check** (`ci.yml`): every push and pull request. Runs `npm test` (unit tests, including the audio Worker against stand-ins for D1 and R2), checks that the versions agree (`tools/version.mjs --check`) and that every track has an audio path (`tools/media.mjs check`), builds the web app as a release does, builds the desktop renderer, and checks that the build carries its version.
- **release** (`release.yml`): a push to `master` whose first line, or whose merged pull request's title, starts with `release:`, or "Run workflow" on the Actions tab. Plan, then the same checks as above, then the deploys, then a tag and a GitHub release.

```
plan ──> test (ci.yml) ──┬──> audio  wrangler deploy (worker/media/wrangler.toml), check the live Worker
                         │      │
                         ├──> web    build, wrangler deploy (wrangler.jsonc), check the live version
                         └──> d1     load track paths from media.json
                                     │
                                     └──> publish  tag v<version>, GitHub release from CHANGELOG.md
```

When both web and audio are released, web waits for audio, since the new app may call routes only the new Worker answers; a failed audio deploy stops web.

Nothing built is committed. Cloudflare receives files from wrangler and builds nothing itself.

## Making a release

```bash
node tools/version.mjs --note "Help page" --note "Retry failed streams" --apply
git commit -am "release: web 26.10.20.6 Help page"
git push
```

`--note` writes the `## v<version>` section of `CHANGELOG.md`; without it, write the section by hand. The release refuses a version without one, since it becomes the GitHub release notes.

The first line of the commit decides what is released:

| First line | Releases |
|---|---|
| `release: web …` | the site |
| `release: audio …` | the audio Worker |
| `release: d1 …` | track paths from `assets/data/media.json` into D1 (upserts; never deletes) |
| `release: web+audio …` | several, joined with `+` |
| `release: all …` | web and audio |
| `release: desktop …` | refused for now: the desktop app has no packaging yet |

After the target, an optional version (`26.10.20.6` or `v26.10.20.6`) must equal `package.json`, and the rest of the line is the note Cloudflare shows next to the deployment.

When the head commit's first line does not start with `release:`, the title of the merged pull request it came from is read instead, so a pull request titled `release: web 26.10.20.6 Help page` releases however it is merged. This covers a merge commit ("Merge pull request #…") and a squash under GitHub's default message, where a single-commit pull request is merged with that commit's message rather than the title. Setting the squash message to "Pull request title" (Settings, General, Pull Requests) is optional. A push whose first line and pull request title both lack `release:` releases nothing. Admin "Merge and release" sets the squash commit's first line itself (`commit_title`, see below), so it does not depend on either.

To see what a push would do, without pushing:

```bash
node tools/release-plan.mjs --message "release: web 26.10.20.6 Help page"
```

Run workflow (Actions, release) offers the same targets for the current `master`.

## One-time setup

[setup.md](setup.md) lists every account, credential and setting in order; the release-specific parts are below.

### 1. Cloudflare API token

Cloudflare dashboard, My Profile, API Tokens, Create Token, template **Edit Cloudflare Workers**. Then:

- Account resources: the account that holds `media` and the `audio` database.
- Zone resources: none. The token needs no access to the `zaideih.com` zone, because no settings file declares a domain: `media.zaideih.com` (and later `zaideih.com`) are attached in the dashboard, and deploys leave them as they are. Remove any zone permissions the template adds.
- Add the permission **Account, D1, Edit** (for `release: d1`, and for `release: audio`, which applies the D1 schema in `worker/media/schema.sql` before deploying).

Copy the token once; Cloudflare does not show it again. The account id is on the Workers & Pages overview, or `npx wrangler whoami`.

### 2. GitHub secrets and variables

Repository, Settings, Secrets and variables, Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | the token |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | the account id |
| Variable | `SITE_URL` | optional; the site address whose `data-version` must match after a web release, e.g. `https://zaideih.<subdomain>.workers.dev` |
| Variable | `AUDIO_CHECK_URL` | optional; default `https://media.zaideih.com/audio/1` |

The deploy jobs run in the environments `web` and `audio`, which GitHub creates on the first run. To require an approval before anything is deployed, add required reviewers under Settings, Environments.

A 403 from the live checks is usually Cloudflare bot protection refusing GitHub's machines, not a failed deploy. The workers.dev address is not behind it.

### 3. Domains

`wrangler.jsonc` deploys the site as a Worker named `zaideih` with static assets, at `https://zaideih.<subdomain>.workers.dev` and at the custom domain `zaideih.com`, attached in the dashboard (Workers & Pages, `zaideih`, Settings, Domains & Routes). `media.zaideih.com` is attached to the audio Worker the same way. Neither is declared in a settings file, so the release token needs no zone access and deploys leave the domains as they are. Cloudflare applies `dist/web/_headers` (CSP and caching) as in local development.

Every address the app is served from must be in the audio Worker's `ALLOWED_ORIGINS` (and in `AUTH_ORIGINS` for sign-in), or songs fail there with a CORS error; changing them needs `release: audio`.

## Catalog edits from the admin page

The admin page `#/admin` on the live site opens pull requests with catalog edits and the next version, and releases them with "Merge and release" (a squash merge that passes `commit_title`, so the first line is `release: web <version> <note>` whatever the repository's squash setting), so they go through the same checks and workflow as any release. People sign in with GitHub (or a fine-grained token, see [setup.md](setup.md)); usage statistics must be off on that device. See [architecture.md](architecture.md#admin-page).

Suggestions from people without write access arrive as pull requests titled `Suggestion: …`. Merging one adds it to `master` without releasing; it ships with the next release.

## Rolling back

```bash
npx wrangler deployments list                                   # the site
npx wrangler rollback                                           # the previous site version
npx wrangler rollback --config worker/media/wrangler.toml       # the previous audio Worker
```

Cloudflare's Deployments tab lists each version with the release tag and note. A rollback leaves the tag and GitHub release in place; the next release gets a new version.

## When a release fails

| Step | Usual cause |
|---|---|
| nothing ran (plan only) | neither the first line on `master` nor the merged pull request's title starts with `release:`; the plan log shows the title it read. Release with Run workflow, or push an empty commit (`git commit --allow-empty -m "release: …"`) |
| plan | the message names an unknown target, a version different from `package.json`, or a version without a `CHANGELOG.md` section; the reason is on the run's summary. After `tools/version.mjs --apply` the first line must carry the new version |
| test | the same failure `check` would show on the branch |
| web or audio, "secrets not set" | step 2 is missing |
| deploy, authentication or permission errors | the token lacks a permission or zone from step 1 |
| live checks, 403 | bot protection; use the workers.dev address |
| live checks, wrong version | the deploy did not reach the address checked, or a cache in front of it; the site's `index.html` always revalidates |
| publish, tag names another commit | the version was released before (a tag names one commit, so the same version cannot be released twice); bump it with `tools/version.mjs --apply` and release the new version |
