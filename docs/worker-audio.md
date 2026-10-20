# Audio Worker

The audio Worker (`worker/media`) streams songs from R2 at `https://media.zaideih.com/audio/{id}`. This guide covers what changed in the Worker when Django was removed, how to deploy it, how to verify it, and how to roll back.

## What changed in the Worker

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
- The D1 schema: only comments in `migrations/0001_initial.sql` changed

### What a deploy touches

`wrangler deploy` uploads the Worker code and replaces the plain variables (`[vars]`) with the ones in `wrangler.toml`. It does **not** change:

- data in D1 (tracks, counters)
- files in R2
- secrets: `SECRET_SHARED` stays set, unused, until it is deleted
- the custom domain

So after the deploy the Worker has `ALLOWED_ORIGINS` and no longer has `APP_URL`. Nothing else changed in Cloudflare.

## Why playback stopped before the deploy

Since v26.10.19.2 the player requests audio with `crossorigin` so the visualizer can analyse the sound. Browsers only allow that when the response carries CORS headers. The old Worker sent none, so the browser refused the audio. The new Worker sends them for every origin in `ALLOWED_ORIGINS`.

Any address the app runs from must be in `ALLOWED_ORIGINS`, or playback fails there.

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
ALLOWED_ORIGINS = "https://zaideih.com,https://www.zaideih.com,app://zaideih,http://localhost:8080,http://127.0.0.1:8080"
```

Add any other address the app is served from, for example a Cloudflare Pages URL such as `https://zaideih.pages.dev`. Origins are exact: scheme, host and port, with no trailing slash.

### 3. Check the track paths in D1

```bash
npx wrangler d1 execute audio --remote --command "SELECT COUNT(*) AS n FROM tracks"
```

Expected: `28180`. If the number differs, load the paths from `media.json`. The load only inserts and updates rows; nothing is deleted:

```bash
cd ~/dev/zaideih
node tools/media.mjs d1 --apply
npx wrangler d1 execute audio --remote --file build/d1/tracks.sql --config worker/media/wrangler.toml
cd worker/media
```

To also delete rows for tracks that are no longer in `media.json`, add `--prune` to the first command.

### 4. Deploy

```bash
npx wrangler deploy
```

The same deploy from the repository root:

```bash
npx wrangler deploy --config worker/media/wrangler.toml
```

### 5. Verify

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

## Clean-up after Django is retired

- If the Django site on lethil is still running, its track signals now call the removed `/sync/*` endpoints and get 404. Playback is unaffected; Django edits simply no longer reach D1.
- Delete the unused secret: `npx wrangler secret delete SECRET_SHARED`
