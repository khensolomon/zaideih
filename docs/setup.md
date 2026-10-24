# Setup

Everything needed to run Zaideih from a fresh clone to a released site, in order. Each credential says where it comes from, where it goes, why it is needed and what it may do. Details live in the linked docs.

## 1. Local development

Needs Node.js 22 (`node --version`) and git.

```bash
git clone https://github.com/khensolomon/zaideih.git && cd zaideih
npm install
npm test
npm run dev                          # http://localhost:8080, live reload
npm --prefix worker/media install    # wrangler, for the Worker and D1 commands
```

Nothing else is needed to work on the app: songs stream from `media.zaideih.com`, which accepts `http://localhost:8080`. Sign-in and uploads also work from `localhost:8080` against the live Worker.

## 2. Cloudflare

One account holds everything. `npx wrangler login` (from `worker/media`) authorizes the command line in the browser.

| Thing | Name | Made with | Recorded in |
|---|---|---|---|
| R2 bucket (audio files) | `media` | `npx wrangler r2 bucket create media` | `worker/media/wrangler.toml` (`[[r2_buckets]]`) |
| D1 database | `audio` | `npx wrangler d1 create audio` | `worker/media/wrangler.toml` (`database_id`) |
| Audio Worker | `media` | the first `wrangler deploy --config worker/media/wrangler.toml` | `worker/media/wrangler.toml` |
| Site | `zaideih` | the first web release | `wrangler.jsonc` |

Catalog audio lives in the bucket as `music/<folder>/<file>`, the paths in `assets/data/media.json`. Uploads land in `users/…`. Music kept anywhere else in the bucket can be added to a personal library where it is ([library.md](library.md#adding-from-storage)). Load the tables and paths once: `node tools/d1.mjs schema --apply` and `node tools/d1.mjs tracks --apply`.

Domains are attached in the dashboard, never in the settings files (so the release token needs no access to the zone): Workers & Pages, the Worker, Settings, Domains & Routes, Add custom domain. `media.zaideih.com` on `media`; `zaideih.com` on `zaideih`. A domain with existing DNS records is refused until they are removed.

## 3. Credentials

### Cloudflare API token (releases)

- **Why**: GitHub Actions deploys the site and the Worker and loads D1.
- **Get it**: Cloudflare dashboard, My Profile, API Tokens, Create Token, template **Edit Cloudflare Workers**.
- **Permissions**: the template's, plus **Account, D1, Edit**. Account resources: the Zaideih account. Zone resources: none (remove any the template adds).
- **Put it**: GitHub repository, Settings, Secrets and variables, Actions, secret `CLOUDFLARE_API_TOKEN`; and secret `CLOUDFLARE_ACCOUNT_ID` (Workers & Pages overview, or `npx wrangler whoami`).
- Cloudflare shows it once. A new one replaces it in the same place.

Optional Actions variables: `SITE_URL` (the address whose version is checked after a web release; the `workers.dev` one avoids bot protection) and `AUDIO_CHECK_URL` (default `https://media.zaideih.com/audio/1`). More: [releasing.md](releasing.md).

### GitHub App "Zaideih" (sign-in, suggestions)

- **Why**: sign in with GitHub on the admin page, and pull requests opened for people without write access.
- **Get it**: github.com/settings/apps/new, owned by the repository's owner.
  - Callback URL `https://media.zaideih.com/auth/callback`; Expire user authorization tokens on; OAuth during installation off; Device Flow off; Webhook off.
  - Repository permissions: Contents **read and write**, Pull requests **read and write**, Checks **read** (Metadata read is added).
  - Account permissions: Email addresses **read-only**, so a GitHub sign-in and a Google sign-in with the same verified email are one account ([accounts.md](accounts.md)). Nothing else.
  - Where it can be installed: **Any account** (otherwise only its owner can sign in).
  - After creating it: Install App, on the owner's account, only the `zaideih` repository.
- **Public values**, in `worker/media/wrangler.toml`: `GITHUB_CLIENT_ID` (the App's Client ID), `GITHUB_REPO`, and `OWNER_GITHUB_ID`, the owner's numeric GitHub id (`gh api repos/khensolomon/zaideih --jq .owner.id`), whose account holds every right.
- **Adding a permission later** (as Email addresses was, 2026-10-24): the App's page, Permissions & events, Account permissions, Email addresses: Read-only, Save changes. Each person accepts it at their next GitHub sign-in (the owner also under Settings, Applications, Installed GitHub Apps, Zaideih, Review request). Until then their GitHub sign-in works, without the email.
- **Secrets**, on the Worker (from the repository root):

  ```bash
  # the App's client secret (App page, Generate a new client secret)
  npx wrangler secret put GITHUB_CLIENT_SECRET --config worker/media/wrangler.toml
  # the App's private key (App page, Generate a private key), converted to PKCS#8
  openssl pkcs8 -topk8 -nocrypt -in zaideih.*.private-key.pem -out app-key.pem
  npx wrangler secret put GITHUB_APP_KEY --config worker/media/wrangler.toml < app-key.pem
  rm app-key.pem
  ```

  Keep the original `.pem` in a password manager, or nowhere: a new key can be generated on the App's page at any time. `*.pem` is ignored by git.

More: [worker-audio.md](worker-audio.md#sign-in-with-github).

### Google sign-in

- **Why**: most listeners sign in with Google ([accounts.md](accounts.md#sign-in-with-google)).
- **Get it**: [console.cloud.google.com](https://console.cloud.google.com), a project named Zaideih, then Google Auth Platform:
  1. **Get started** (Branding): app name **Zaideih**, a support email, audience **External**, a contact email.
  2. **Branding**: home page `https://zaideih.com`, privacy policy `https://zaideih.com/#/terms`, authorised domain `zaideih.com`. A logo is optional, and adding one asks Google to verify the branding first.
  3. **Data access**: nothing to add; `openid`, `email` and `profile` are there by default and need no review.
  4. **Audience**: **Publish app** (In production). While it is in Testing, only the test users listed there can sign in.
  5. **Clients**, Create client: **Web application**, named "Zaideih Worker"; Authorised redirect URIs: `https://media.zaideih.com/auth/google/callback`. No JavaScript origins (the browser never talks to Google's API).
- **Public value**, in `worker/media/wrangler.toml`: `GOOGLE_CLIENT_ID` (the client's Client ID).
- **Secret**, on the Worker: `npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/media/wrangler.toml` (the client's secret; Google shows it once, a new one can be added on the client's page).
- Without either, Continue with Google answers "Google sign-in is not set up on this Worker" naming what is missing; everything else works.

### Signing key for personal libraries

- **Why**: private songs play only through addresses the Worker signs; this is the key.
- **Get it**: any 32 random bytes.
- **Put it**: `openssl rand -base64 32 | npx wrangler secret put AUDIO_SIGNING_KEY --config worker/media/wrangler.toml`
- A new key makes every address already handed out invalid; the app fetches new ones when it next reads the library.

More: [library.md](library.md).

### Fine-grained GitHub token (optional)

- **Why**: an alternative to signing in on the admin page, for someone with write access.
- **Get it**: GitHub, Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token. Repository access: only `khensolomon/zaideih`. Permissions: Contents read and write, Pull requests read and write, Checks read. An expiry date.
- **Put it**: the admin page, "Use a token instead", on the device used for editing. It stays in that browser only.

## 4. Settings in the files

| File | Setting | What it is |
|---|---|---|
| `worker/media/wrangler.toml` | `ALLOWED_ORIGINS` | sites that may download audio (CORS): every address the app is served from, `app://zaideih`, `localhost:8080` |
| | `PLAY_ORIGINS` | sites whose plays count (the released app only) |
| | `AUTH_ORIGINS` | sites that may sign in and use personal libraries |
| | `UPLOAD_MAX_BYTES`, `UPLOAD_QUOTA_BYTES` | 95 MB per file, 2 GB per member |
| | `[[ratelimits]]` | `PLAYS_LIMIT`, `TRACK_LIMIT`, `SUGGEST_LIMIT`, `UPLOAD_LIMIT`; each `namespace_id` unique in the account |
| build environment | `ZAIDEIH_GA_ID` | Google Analytics id for web releases (default built in; empty turns it off) |

Origins are exact: scheme, host and port, no trailing slash.

## 5. First release

```bash
node tools/version.mjs --note "First release" --apply
git commit -am "release: all $(node -p 'require("./package.json").version') First release"
git push
```

`release: all` deploys the site and the Worker (and applies the D1 schema); `release: d1` loads track paths. Check afterwards: the site shows its version on About, a song plays, and `#/admin` signs in. [releasing.md](releasing.md) covers targets, failures and rollback.

## Checklist

- [ ] `npm test` passes locally
- [ ] R2 `media` holds `music/…`; D1 `audio` has its tables (`node tools/d1.mjs status`) and 28,180 track paths
- [ ] Domains attached: `media.zaideih.com`, `zaideih.com`
- [ ] GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- [ ] Worker secrets: `GITHUB_CLIENT_SECRET`, `GITHUB_APP_KEY`, `AUDIO_SIGNING_KEY`, `GOOGLE_CLIENT_SECRET` (`npx wrangler secret list --config worker/media/wrangler.toml`)
- [ ] GitHub App installed on `zaideih`, callback `https://media.zaideih.com/auth/callback`
