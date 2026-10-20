# Releasing

Two workflows in `.github/workflows/`:

- **check** (`ci.yml`): every push and pull request. Runs `npm test` (unit tests, including the audio Worker against stand-ins for D1 and R2), checks that the versions agree (`tools/version.mjs --check`) and that every track has an audio path (`tools/media.mjs check`), builds the web app as a release does, builds the desktop renderer, and checks that the build carries its version.
- **release** (`release.yml`): a push to `master` whose first line starts with `release:`, or "Run workflow" on the Actions tab. Plan, then the same checks as above, then the deploys, then a tag and a GitHub release.

```
plan ──> test (ci.yml) ──┬──> web    build, wrangler deploy (wrangler.jsonc), check the live version
                         ├──> audio  wrangler deploy (worker/media/wrangler.toml), check the live Worker
                         └──> d1     load track paths from media.json
                                     │
                                     └──> publish  tag v<version>, GitHub release from CHANGELOG.md
```

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

With **Squash and merge**, the head commit's first line is the pull request's title, so a pull request titled `release: web 26.10.20.6 Help page` releases when merged. A merge commit ("Merge pull request #…") releases nothing. To use pull-request titles, set Settings, General, Pull Requests, "Allow squash merging" with the default message "Pull request title".

To see what a push would do, without pushing:

```bash
node tools/release-plan.mjs --message "release: web 26.10.20.6 Help page"
```

Run workflow (Actions, release) offers the same targets for the current `master`.

## One-time setup

### 1. Cloudflare API token

Cloudflare dashboard, My Profile, API Tokens, Create Token, template **Edit Cloudflare Workers**. Then:

- Account resources: the account that holds `media` and the `audio` database.
- Zone resources: `zaideih.com` (needed for the custom domains `media.zaideih.com` and, later, `zaideih.com`).
- Add the permission **Account, D1, Edit** (for `release: d1`).

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

### 3. The first web release goes to workers.dev

`wrangler.jsonc` deploys the site as a Worker named `zaideih` with static assets, served only at `https://zaideih.<subdomain>.workers.dev` until a route is added. Cloudflare applies `dist/web/_headers` (CSP and caching) as in local development.

Streaming from that address needs its origin in the audio Worker's `ALLOWED_ORIGINS` (`worker/media/wrangler.toml`), since the player requests audio in CORS mode: add `https://zaideih.<subdomain>.workers.dev` and release `audio`. Without it every song fails there with a CORS error.

### 4. Moving zaideih.com to the new site

In `wrangler.jsonc`, uncomment the `routes` for `zaideih.com` and `www.zaideih.com`, then release `web`. Cloudflare then points those names at this Worker, replacing whatever serves them now. If DNS records already exist for those names (for example a tunnel to the old server), Cloudflare refuses the custom domain until they are removed. Do this when the switch is intended, ideally in a quiet hour, with the old server still running for a rollback.

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
| plan | the message names an unknown target, a version different from `package.json`, or a version without a `CHANGELOG.md` section; the reason is on the run's summary |
| test | the same failure `check` would show on the branch |
| web or audio, "secrets not set" | step 2 is missing |
| deploy, authentication or permission errors | the token lacks a permission or zone from step 1 |
| live checks, 403 | bot protection; use the workers.dev address |
| live checks, wrong version | the deploy did not reach the address checked, or a cache in front of it; the site's `index.html` always revalidates |
| publish, tag names another commit | the version was released before; bump it |
