# Audio Worker

The audio Worker (`worker/media`, at `https://media.zaideih.com`) streams the catalog's songs from R2 and serves everything else the app needs from a server:

| Route | What | Code |
|---|---|---|
| `GET /audio/:id` | a catalog song from R2 (`music/…`, path from D1 `tracks`), with ranges | `script.js` |
| `POST /plays`, `GET /plays` | count plays; play totals for the app | `script.js` |
| `/auth/*` | sign in with GitHub for the admin page; `POST /auth/suggest` opens suggestions | `auth.js`, `suggest.js` |
| `/auth/session`, `/auth/me`, `/auth/google/*`, `/auth/passkey/*` | accounts: Zaideih sessions from GitHub, Google or passkey sign-ins ([accounts.md](accounts.md)) | `accounts.js`, `google.js`, `passkeys.js` |
| `/lyrics/:song`, `/lyrics/recent`, `/lyrics/index` | lyrics of catalog songs: public reading, editing and reporting signed in, the Lyrics right ([lyrics.md](lyrics.md)) | `lyrics.js` |
| `POST /library/sync` | liked songs and playlists on every device ([sync.md](sync.md)) | `sync.js` |
| `/library/*`, `GET /u/:id`, `GET /k/:key` | personal libraries: uploads, adding from storage, rights and moderation, asking to publish, signed streaming | `library.js`, `members.js`, `requests.js` |

Bindings and settings are in `wrangler.toml`; secrets are listed in [setup.md](setup.md). This guide covers deploying, verifying, inspecting and rolling back, then each part in turn.

## Deploy

All commands run from `worker/media` unless noted.

### 1. Install and log in (once per machine)

```bash
cd ~/dev/zaideih/worker/media
npm install            # installs the pinned wrangler
npx wrangler login     # authorizes wrangler in the browser
```

### 2. Check the allowed origins

In `worker/media/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "https://zaideih.com,https://beta.zaideih.com,app://zaideih,http://localhost:8080,http://127.0.0.1:8080"
```

Add any other address the app is served from, for example the site's `workers.dev` address, and the same to `AUTH_ORIGINS` for sign-in. Origins are exact: scheme, host and port, with no trailing slash.

### 3. Check the track paths in D1

```bash
npx wrangler d1 execute audio --remote --command "SELECT COUNT(*) AS n FROM tracks"
```

Expected: `28180`. If the number differs, load the paths from `media.json`. The load only inserts and updates rows; nothing is deleted:

```bash
cd ~/dev/zaideih
node tools/d1.mjs tracks --apply
```

To also delete rows for tracks that are no longer in `media.json`, add `--prune`.

### 4. The D1 schema

The whole schema is one file, `worker/media/schema.sql`, as it is now; changes it cannot make (renames) are migrations in `worker/media/migrations/`, run once each ([accounts.md](accounts.md#members-from-before-accounts)). Every schema statement is idempotent, and `tools/d1.mjs` (from the repository root, using worker/media's wrangler: `npm --prefix worker/media install`) does the rest. Commands other than `status` are dry runs until `--apply`:

| Command | What it does |
|---|---|
| `node tools/d1.mjs status` | Tables and row counts, marking tables that are not in the schema (leftovers to clean up) |
| `node tools/d1.mjs schema --apply` | Runs the pending migrations, then creates what is missing; keeps all data. `release: audio` runs it before deploying |
| `node tools/d1.mjs tracks --apply` | Loads every track path from `assets/data/media.json` (`--prune` also deletes rows not in it). `release: d1` runs it |
| `node tools/d1.mjs reset --keep-plays --apply` | Drops every table (Cloudflare's own `_cf_*` excepted, old Django tables included), creates the schema and loads the track paths, as one D1 import that either completes or leaves the database as it was |

`reset` refuses to run while the `plays` table holds counts unless `--keep-plays` (they are read first and put back, then counted again to check) or `--drop-plays` (they are lost) is given. It writes the script to `build/d1/reset.sql` before running it. `--local` works on the local development database instead (`wrangler dev`).

`schema` is sent as one query (`--command`): the database stays available. `tracks` and `reset` use D1's import (`--file`), which makes the database unavailable to the Worker for the seconds it runs.

### 5. Deploy

```bash
npx wrangler deploy
```

The same deploy from the repository root:

```bash
npx wrangler deploy --config worker/media/wrangler.toml
```

### 6. Verify

```bash
# Allowed origin: expect 200 and access-control-allow-origin: http://localhost:8080
curl -sI -H "Origin: http://localhost:8080" -H "Sec-Fetch-Dest: audio" \
  https://media.zaideih.com/audio/1 | grep -iE "^HTTP|access-control-allow-origin"

# Other origin: expect 200 and no access-control header
curl -sI -H "Origin: https://example.com" -H "Sec-Fetch-Dest: audio" \
  https://media.zaideih.com/audio/1 | grep -iE "^HTTP|access-control"

# Download request from an allowed origin: expect 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:8080" -H "Sec-Fetch-Dest: empty" \
  https://media.zaideih.com/audio/1

# Play counting from the released app: expect 200 and {"accepted":0,"rejected":[[0,"unknown-track"]]}
curl -s -X POST -H "Origin: https://zaideih.com" -H "Content-Type: text/plain" \
  --data '{"v":1,"plays":[[999999999,'"$(date +%s)"']]}' https://media.zaideih.com/plays

# Play counting from another origin (including localhost): expect 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: http://localhost:8080" \
  --data '{"v":1,"plays":[[1,1]]}' https://media.zaideih.com/plays

# Removed Django endpoint: expect 404
curl -s -o /dev/null -w "%{http_code}\n" https://media.zaideih.com/sync/ping
```

Then run `npm run dev` from the repository root and open <http://localhost:8080>: songs play and the player bars move.

## Inspect and roll back

```bash
npx wrangler deployments list      # recent deployments, newest first
npx wrangler rollback              # return to the previous version
npx wrangler tail                  # live logs while playing a song
```

A rollback restores the old code and variables, including the missing CORS headers, so playback in the current app stops again until the new version is redeployed.

## When one song fails

A failed song shows a diagnostic code under the error ("Code ZE-…", with a Copy button). The code carries the track id, what failed, the probe's HTTP status, the Worker's lookup source and 404 reason, the first bytes of the file and the app version; no paths. Decode it with:

```bash
node tools/diagnose.mjs ZE-0420-R068-...          # cause, track, R2 key, check commands
node tools/diagnose.mjs track 22503 --probe       # the same for any track, plus a request from this machine
```

The app also decodes codes on a page that is not linked anywhere: `#/code/<code>` (or `#/code` to paste one).

The Worker sends two headers for this, exposed to allowed origins:

- `X-Zaideih-Meta`: where the track lookup came from: `memory` (this isolate), `edge` (this data centre's cache, up to 24 hours old) or `d1`.
- `X-Zaideih-Reason`, on 404 only: `no-track` (no D1 row) or `no-object` (the D1 row names a key R2 does not have).

Lookups are cached per data centre for 24 hours, so a path corrected in D1 can keep failing in some regions until the cache expires. To drop every cached lookup at once, change `META_CACHE_VERSION` in `wrangler.toml` and redeploy.

A song that plays in one browser and fails in another, while the server answers it correctly (`curl` shows `206` and `ID3` or `ff fb` at the start), is a stale copy in the failing browser: browsers keep range responses for a day (`Cache-Control: public, max-age=86400, immutable`), and a copy saved from a Worker version without the CORS header is refused by the player, which requests audio in CORS mode. The player retries a failed stream once with a one-off `?fresh=` query that skips the browser cache (the Worker ignores the query), so this heals itself; `#/help` tells listeners how to clear only cached files if it does not.

Myanmar names can hold the same marks in two orders (U+1037 and U+103A) that render identically, so a D1 path and an R2 key can look equal and still differ. `tools/diagnose.mjs` prints the key's code points and its look-alike, and the D1 command it prints shows `hex(folder_path)` for a byte comparison.

## Track statistics

```bash
# Tracks with storage problems (path in D1 but no file in R2, or R2 errors)
npx wrangler d1 execute audio --remote --command \
  "SELECT * FROM tracks_status WHERE not_found > 0 OR fetch_error > 0 LIMIT 50"

# Recently served
npx wrangler d1 execute audio --remote --command \
  "SELECT * FROM tracks_status ORDER BY last_seen DESC LIMIT 20"
```

`served` counts fresh fetches that reach the Worker. It is not a play count: replays from the browser cache never arrive.

## Play counts

The app counts a play after 10 seconds of listening (or at the end of a shorter song) and posts it to `POST /plays` (`src/core/plays.js`). The Worker stores one row per track and UTC day in `plays`; nothing about the listener is stored.

The app reads the counts back with `GET /plays` (`src/core/playcounts.js`): `{"v":1,"updated":<unix seconds>,"recentDays":30,"tracks":[[id, total, last30Days], ...]}`, only tracks with plays, sorted by id. It is public (any origin; totals only) and cached for 5 minutes, at the edge (so D1 is asked at most once per data centre in that time) and in browsers. The app adds each total to the catalog's own count, keeps the last answer per device for offline use, and asks again at start and on returning to the app, at most every 10 minutes.

```bash
# Plays per day, last 14 days
npx wrangler d1 execute audio --remote --command \
  "SELECT day, SUM(n) AS plays FROM plays GROUP BY day ORDER BY day DESC LIMIT 14"

# Most played in the last 30 days
npx wrangler d1 execute audio --remote --command \
  "SELECT track_id, SUM(n) AS plays FROM plays WHERE day >= date('now','-30 days') GROUP BY track_id ORDER BY plays DESC LIMIT 20"
```

Only origins in `PLAY_ORIGINS` are counted (the released app; `localhost` is deliberately absent, so testing never counts). Two rate limiters (`[[ratelimits]]` in `wrangler.toml`, `PLAYS_LIMIT` and `TRACK_LIMIT`) cap each sender address at 20 requests a minute and one counted batch per track a minute; the address is a limiter key only and is never stored. The limiters are approximate and per Cloudflare location: they deter inflation by one sender, not by many. If the account cannot create rate limiter bindings, `wrangler deploy` fails and names them; the Worker refuses `/plays` with 500 when a binding is missing rather than counting without limits.

Answers: 200 `{"accepted": n, "rejected": [[index, reason], ...]}` (reasons `invalid`, `too-old` (over 30 days), `in-future`, `unknown-track`, `repeated` (over 3 of one track in a request), `rate-limited`); 400 or 413 for a malformed request, with the reason; 403 for another origin; 429 with `Retry-After` when a sender sends too often. The app retries on 404, 429, 5xx and network errors and drops a batch only on 400, 403, 405 or 413.

## Sign in with GitHub

The admin page (`#/admin`) signs people in with the GitHub App "Zaideih" (App ID 5427707, owned by khensolomon, installed on `khensolomon/zaideih` only). GitHub's token endpoint needs the App's client secret, which cannot live in a public page, so the Worker finishes the sign-in (`auth.js`). The GitHub tokens stay on the device; for its own routes (personal libraries) the Worker gives a Zaideih session instead (`POST /auth/session`, [accounts.md](accounts.md#sessions)).

1. The page keeps a PKCE verifier and a nonce for its tab and opens `/auth/login?return=<page>&nonce=<n>&challenge=<S256>`; the Worker sends the browser on to GitHub.
2. GitHub returns to `/auth/callback`; the Worker returns to `<page>#/admin?signin=<code>&nonce=<n>` (or `signin-error=<reason>`). The page checks the nonce and removes the code from the address.
3. The page posts the code and verifier to `/auth/token` and gets an access token (8 hours) and a refresh token (6 months), kept on that device; `/auth/refresh` renews the access token, `/auth/signout` revokes it.

What a token may do is what both the App (Contents and Pull requests read and write, Checks read) and the person may do on the repository; GitHub enforces it, so merging still needs write access. The Worker returns only to origins in `AUTH_ORIGINS` (checked at login and again at the callback) and answers tokens only to them (CORS).

Setup, once:

| Where | Setting |
|-------|---------|
| GitHub App | Callback URL `https://media.zaideih.com/auth/callback`; user tokens expire; webhook off; installable on any account (otherwise only the owner can sign in); installed on `zaideih` only; account permission Email addresses read-only (joins sign-ins by email, [accounts.md](accounts.md)) |
| `wrangler.toml` | `GITHUB_CLIENT_ID` (public) and `AUTH_ORIGINS` |
| Worker secret | `npx wrangler secret put GITHUB_CLIENT_SECRET --config worker/media/wrangler.toml` |
| `wrangler.toml` | `GITHUB_REPO`, `OWNER_GITHUB_ID` and the `SUGGEST_LIMIT` rate limiter |
| Worker secret | `GITHUB_APP_KEY`: the App's private key in PKCS#8 form (`openssl pkcs8 -topk8 -nocrypt -in <key>.pem`), for suggestions |

### Suggestions

People without write access cannot push a branch, so `POST /auth/suggest` (`suggest.js`) opens their pull request as the App: the page sends the changed data files built on a master commit, a note and the change lines, with the person's sign-in token. The Worker asks GitHub whose token it is, applies `SUGGEST_LIMIT` (2 a minute per GitHub user), signs a JWT with `GITHUB_APP_KEY`, gets an installation token for `GITHUB_REPO` (Contents and Pull requests write; kept per isolate until 5 minutes before it ends), and creates the commit (authored by the person, with their noreply address), a `suggest-<login>-<time>` branch and a pull request titled `Suggestion: <note>` that names them.

Only `assets/data/albums.json`, `assets/data/artist.name.json` and `assets/data/media.json` (a reviewer without write access publishing a member's album, [library.md](library.md#asking-to-publish)) may change, up to 8 MB each; release files, code and workflows cannot. The files are not parsed on the Worker (a 5 MB parse would cost more CPU time than a request is given); the pull request is the gate: nothing reaches master until someone with write access merges it, after the checks have run on it. A merged suggestion ships with the next release.

A Worker missing any of these answers `/auth/*` with 503 naming what is missing. A new client secret is generated on the App's page and uploaded the same way; the old one is then deleted there. The private key files are not kept in the repository (`*.pem` is ignored).

## Personal libraries

`/library/*` and `/u/<id>` (`library.js`, `members.js`) serve members' own uploads; `/library/requests*` (`requests.js`) asking to publish them. The design is in [library.md](library.md). The upload and storage routes are listed in the header of `library.js`.

| Route | Who | Does |
|---|---|---|
| `GET /library/members` | any right | every member with space used, uploads and rights |
| `GET /library/members/<member id>` | Moderate members | one member's uploads (titles only, no addresses) |
| `POST /library/members/<member id>` | Moderate members; co-owners for rights and folder | `{blocked: true, reason}` or `{blocked: false}`; `{rights: {<right>: true or false}}`; `{folder: "<prefix>/" or null}`, where Storage adds from |
| `POST /library/requests` `{album, lang, note}` | the member | asks to publish an album of their uploads (MP3 only, else 415 naming the files) |
| `GET /library/requests` | signed in | the person's own requests; with Review publishing, every open one and the 50 latest decided, each song with a signed address |
| `DELETE /library/requests/<id>` | the member, a co-owner | withdraws an open request |
| `POST /library/requests/<id>/reject` `{reason}` | Review publishing | rejects; the songs are private again |
| `POST /library/requests/<id>/approve` `{album, tracks: [{upload, track, key}]}` | Review publishing | checks every key (`music/…`, free) and track id (unused), then copies each upload there |
| `POST /library/requests/<id>/pr` `{url}` | Review publishing | records the pull request |

An approved request is settled on the next `GET /library` or `GET /library/requests` after the release has loaded its track paths into `tracks`.

Setup, once, before the first release that includes them:

```bash
# the signing key for streaming addresses (any 32 random bytes)
openssl rand -base64 32 | npx wrangler secret put AUDIO_SIGNING_KEY --config worker/media/wrangler.toml
# the members and uploads tables (also run by every release: audio)
node tools/d1.mjs schema --apply
```

`wrangler.toml` holds `UPLOAD_MAX_BYTES` (95 MB), `UPLOAD_QUOTA_BYTES` (2 GB) and the `UPLOAD_LIMIT` rate limiter. Without any of them, or without the secret, `/library` answers 503 naming what is missing, and `/u/<id>` 503.

```bash
# Members by space used
npx wrangler d1 execute audio --remote --command \
  "SELECT m.name, COUNT(u.id) AS files, SUM(u.size) / 1000000 AS mb, m.blocked_reason FROM members m LEFT JOIN uploads u ON u.owner_id = m.id GROUP BY m.id ORDER BY mb DESC"
```

`tools/d1.mjs reset` refuses while any table that cannot be rebuilt from git holds rows (`LIBRARY_TABLES` in `tools/lib/d1.mjs`: accounts, libraries, synced likes and playlists, lyrics). `--drop-library` overrides it; the files then stay in R2 under `users/` without an owner.

## History: the Worker without Django

Compared with the version that ran alongside Django (commit `dd79f9f`):

### Removed

| Item | What it did | Why it went |
|------|-------------|-------------|
| `POST /sync/track/:id` | Django pushed a track's folder and file name into D1 when a track was saved | Django is gone; D1 is now loaded from `assets/data/media.json` |
| `DELETE /sync/track/:id` | Django removed a track from D1 | Same |
| `GET /sync/ping` | Health check used by Django's `check_d1` command | Same |
| HMAC signature check (`SECRET_SHARED`) | Verified that `/sync/*` calls came from Django | Nothing left to verify |
| `APP_URL` variable | Django's address | Not used anymore |
| `migrations/cleanup.sql` | Cleaned a `play_telemetry` table | That table does not exist in the current schema |

### Added

| Item | What it does |
|------|--------------|
| `ALLOWED_ORIGINS` variable | Lists the sites allowed to read audio with CORS: the web app, the desktop app (`app://zaideih`) and local testing (`localhost:8080`) |
| CORS headers for allowed origins | `Access-Control-Allow-Origin` and the range headers the browser needs. Required for the live visualizer and for offline downloads |
| `fetch()` requests from allowed origins | The app downloads songs for offline play with `fetch()`. These requests were refused with 403 before |
| `OPTIONS /audio/:id` | CORS preflight answer for allowed origins |
| Pinned `wrangler` version (4.150.0) | Previously `latest`, which could change between deploys |

### Unchanged

- `GET /audio/:id`: same lookup (`tracks` table in D1, then `music/{folder_path}/{mp3}` in R2), same Range support, same caching headers
- `tracks_status` counters (`served`, `not_found`, `fetch_error`)
- D1 database (`audio`), R2 bucket (`media`), custom domain (`media.zaideih.com`)
- The D1 schema: the same tables (since then gathered into `schema.sql` with `plays` added; see The D1 schema)

### What a deploy touches

`wrangler deploy` uploads the Worker code and replaces the plain variables (`[vars]`) with the ones in `wrangler.toml`. It does **not** change:

- data in D1 (tracks, counters)
- files in R2
- secrets: `SECRET_SHARED` stays set, unused, until it is deleted
- the custom domain: `media.zaideih.com` is attached in the dashboard (Workers & Pages, `media`, Settings, Domains & Routes) and is not declared in `wrangler.toml`, so deploys need no access to the `zaideih.com` zone and leave the domain as it is. Re-attach it there if the Worker is ever deleted and recreated.

So after the deploy the Worker has `ALLOWED_ORIGINS` and no longer has `APP_URL`. Nothing else changed in Cloudflare.

### Why playback stopped before the deploy

Since v26.10.19.2 the player requests audio with `crossorigin` so the visualizer can analyse the sound. Browsers only allow that when the response carries CORS headers. The old Worker sent none, so the browser refused the audio. The new Worker sends them for every origin in `ALLOWED_ORIGINS`.

Any address the app runs from must be in `ALLOWED_ORIGINS`, or playback fails there.

## Clean-up after Django is retired

- If the Django site on lethil is still running, its track signals now call the removed `/sync/*` endpoints and get 404. Playback is unaffected; Django edits simply no longer reach D1.
- Delete the unused secret: `npx wrangler secret delete SECRET_SHARED`
