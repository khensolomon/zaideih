# Architecture A — Setup

This guide walks through deploying the Django ↔ audio Worker integration
from scratch. Once done, Django is the source of truth for track data,
D1 is a fast read-only mirror at the edge, and the Worker calls Django
to record plays.

---

## Files in this delivery

```bash
worker-side/
  audio-worker.js     The Worker (audio streaming + sync endpoints).
  wrangler.toml       Worker config (replace REPLACE_ME values).
  0001_initial.sql    D1 schema migration.
  cleanup.sql         Periodic telemetry cleanup.

django-side/
  __init__.py         Top-of-file docstring with installation overview.
  apps.py             AppConfig — registers signals on app load.
  services.py         HTTP client + HMAC signing/verifying.
  signals.py          post_save / post_delete handlers on Track.
  views.py            /api/internal/track/<id>/play/ endpoint.
  urls.py             URL routing.
  sync_d1.py          Goes in worker/management/commands/.
  check_d1.py         Goes in worker/management/commands/.
```

---

## Phase 1 — Generate the shared secret

This single secret is shared between Django and the Worker. They use it
to sign all cross-boundary requests so neither side trusts forged calls.

Generate it once:

```bash
openssl rand -hex 32
```

You'll get something like `7f3a...64c8`. Save it — you'll set it on
both sides next.

---

## Phase 2 — Deploy the Worker

### 2a. Place the files

Copy the contents of `worker-side/` into your Worker project. Your
project should look something like:

```bash
audio-worker/
  audio-worker.js
  wrangler.toml
  migrations/
    0001_initial.sql
    cleanup.sql
```

### 2b. Create the D1 database

```bash
wrangler d1 create audio-paths
```

Copy the `database_id` from the output into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "audio-paths"
database_id = "<the id you just got>"
```

### 2c. Run the schema migration

```bash
wrangler d1 execute audio --file=./migrations/0001_initial.sql
```

This creates the `tracks` and `play_telemetry` tables.

### 2d. Set Worker secrets

```bash
# The signing key for browser-side signed audio URLs (existing).
# Generate a separate one if you want, or reuse if you already had it.
wrangler secret put AUDIO_SIGNING_KEY

# The shared secret for Django↔Worker. Use the value from Phase 1.
wrangler secret put DJANGO_SHARED_SECRET
```

Both prompt you to paste the value. Cloudflare encrypts them at rest;
they never appear in your dashboard or logs.

### 2e. Update `vars` in wrangler.toml

```toml
[vars]
APP_URL = "https://your-django-host.com"  # NO trailing slash
```

For development you can use `http://web:3010` if running both in Docker
(Worker can reach via the Cloudflare tunnel) — but in normal cloud
deployment this should be your public Django URL.

### 2f. Deploy

```bash
wrangler deploy

# or
cd zaideih
npx wrangler deploy --config worker/audio/wrangler.toml
```

Confirm the route is mapped to your Worker:ce

```bash
curl https://api.example.com/sync/ping
# → 403 Forbidden (correct — no signature)
```

---

## Phase 3 — Wire up Django

### 3a. Place the app

In your Django project, create the directory layout:

```bash
your_project/
  worker/
    __init__.py        ← from django-side/__init__.py
    apps.py            ← from django-side/apps.py
    services.py        ← from django-side/services.py
    signals.py         ← from django-side/signals.py
    views.py           ← from django-side/views.py
    urls.py            ← from django-side/urls.py
    management/
      __init__.py      ← create empty
      commands/
        __init__.py    ← create empty
        sync_d1.py     ← from django-side/sync_d1.py
        check_d1.py    ← from django-side/check_d1.py
```

The two `__init__.py` files inside `management/` and `management/commands/`
must exist (can be empty) for Django to discover the commands.

### 3b. Update Track import paths

In **`signals.py`**, **`views.py`**, and **`sync_d1.py`** there's a line:

```python
from music.models import Track
```

Replace `music` with whatever app your `Track` model actually lives in.

### 3c. Settings additions

In your `settings.py`:

```python
INSTALLED_APPS = [
    # ... your existing apps ...
    "worker",
]

# Where the Worker lives. Must be reachable from Django.
WORKER_URL = "https://api.example.com"

# Same secret you set on the Worker.
# Read from environment, NEVER hardcode in settings.
import os
SECRET_SHARED = os.environ["SECRET_SHARED"]
```

Set the env var:

```bash
# In your .env, or wherever you manage secrets
SECRET_SHARED=<paste the same value from Phase 1>
```

### 3d. URL routing

In your project's `urls.py`:

```python
urlpatterns = [
    # ... existing ...
    path("api/internal/", include("worker.urls")),
]
```

### 3e. Restart Django

If you have `runserver` going, restart it. The signal handlers register
on app startup.

---

## Phase 4 — Verify

### 4a. Check connectivity

```bash
python manage.py check_d1
```

Expected output:

```bash
Worker URL: https://api.example.com
Secret:     7f3a...64c8 (length 64)

Connection OK: OK (status 200)
```

If this fails, double-check the secret matches on both sides exactly.
A single trailing newline difference will cause it to fail.

### 4b. Initial bulk sync

Push all your existing tracks to D1:

```bash
python manage.py sync_d1 --all
```

You'll see one line per track and a summary:

```bash
Worker reachable: OK (status 200)
Syncing 50000 track(s) to Worker...
  track 1: ok
  track 2: ok
  ...
Successful: 50000
Failed:     0
```

For a 50k library, this takes a few minutes (one HTTPS call per track).
Use `--quiet` to suppress per-track lines if you don't want to scroll
through them.

### 4c. Test an audio request

Pick a known track id from your database, then:

```bash
curl -I https://api.example.com/audio/123
```

Should return `200 OK` (or `206` for ranged). If `404`, the path isn't
in D1 — check that the bulk sync covered that track id.

### 4d. Verify play counting

Make a real audio request from your browser. Then in Django:

```python
>>> from music.models import Track
>>> Track.objects.get(id=123).plays
```

The number should have incremented. If not:

- Check `wrangler tail` while you make the request — you should see
  the Worker call out to Django.
- Check Django logs — you should see the `track_play` view being hit.
- If neither: HMAC mismatch. Run `check_d1` again.

### 4e. Verify telemetry

```bash
wrangler d1 execute audio-paths --command="SELECT status, COUNT(*) FROM play_telemetry GROUP BY status"
```

You should see rows like `success | 1`. As traffic grows, you'll see
counts of any timeouts or errors here.

---

## Phase 5 — Operations

### Periodic telemetry cleanup

Set up a scheduled cleanup so the telemetry table doesn't grow forever.

Option A: Cloudflare cron trigger (recommended)

Add to `wrangler.toml`:

```toml
[triggers]
crons = ["0 4 * * *"]  # Daily at 04:00 UTC
```

And add a `scheduled` handler to `audio-worker.js`:

```javascript
export default {
  async fetch(request, env, ctx) { /* ... existing ... */ },

  async scheduled(controller, env, ctx) {
    // Delete telemetry older than 30 days.
    await env.DB.prepare(
      "DELETE FROM play_telemetry WHERE recorded_at < ?"
    ).bind(Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30).run();
  },
};
```

Option B: Run manually when needed

```bash
wrangler d1 execute audio-paths --file=./migrations/cleanup.sql
```

### Periodic full re-sync (optional)

Belt-and-suspenders: schedule `sync_d1 --all` weekly via cron on your
Django host. Catches any tracks that drifted due to signal failures.

```cron
0 3 * * 0 cd /app && python manage.py sync_d1 --all --quiet
```

### Monitoring

Useful telemetry queries:

```sql
-- Recent failure rate
SELECT
  status,
  COUNT(*) as count,
  AVG(latency_ms) as avg_latency
FROM play_telemetry
WHERE recorded_at > strftime('%s', 'now') - 3600
GROUP BY status;

-- Slowest plays in the last hour (might indicate Django load)
SELECT track_id, latency_ms, status, recorded_at
FROM play_telemetry
WHERE recorded_at > strftime('%s', 'now') - 3600
ORDER BY latency_ms DESC
LIMIT 20;

-- Tracks that consistently fail (might be missing in D1?)
SELECT track_id, COUNT(*) as fail_count
FROM play_telemetry
WHERE status != 'success'
  AND recorded_at > strftime('%s', 'now') - 86400
GROUP BY track_id
ORDER BY fail_count DESC
LIMIT 20;
```

Run these via `wrangler d1 execute`.

---

## Bulk operations and signals

If you ever do bulk Track operations that bypass `save()`:

```python
Track.objects.bulk_create([...])           # ⚠️ no signal fires
Track.objects.filter(...).update(mp3="x")  # ⚠️ no signal fires
```

D1 won't be updated automatically. After bulk operations, run:

```bash
python manage.py sync_d1 --album <id>      # if you bulk-edited one album
python manage.py sync_d1 --all             # if uncertain
```

---

## Rollback plan

If something goes wrong and you need to disable the sync:

1. Comment out `from . import signals` in `worker/apps.py`
2. Restart Django

Track edits will no longer push to D1. Audio streaming continues
working with whatever is in D1. Plays will fail to record (they go
to the `track_play` view which still exists; the failures will show
in Worker telemetry).

To fully roll back to your pre-Architecture-A Worker, redeploy that
older version. D1 keeps its data; the new Worker just won't read or
write the new tables.

---

## What's next

Once Architecture A is running smoothly, the natural next steps are:

1. **User accounts in Django** — django-allauth for OAuth + email/password,
   matching everything we discussed.
2. **Signed audio URLs** — once authenticated users exist, the audio
   Worker can require a signed URL minted by Django, gating premium
   tracks or future paid content.
3. **Per-user features** — playlists, favorites, listening history —
   all in Django/Postgres, joined naturally with the play data we're
   already collecting.

Each of these layers cleanly on top of the foundation Architecture A
provides. None of them require touching the audio streaming critical
path.
