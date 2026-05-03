-- D1 migration for Architecture A.
-- Run with: wrangler d1 execute <DB_NAME> --file=./0001_initial.sql

-- =============================================================================
-- tracks
-- =============================================================================
-- Read-only mirror of Django's truth. Contains only what the Worker needs at
-- request time. Writes go through the /sync/track/<id> endpoint, which is
-- HMAC-protected. The Worker never modifies this from /audio/* requests.
CREATE TABLE IF NOT EXISTS tracks (
    id          INTEGER PRIMARY KEY,
    folder_path TEXT NOT NULL,
    mp3         TEXT NOT NULL,
    updated_at  INTEGER NOT NULL  -- unix seconds, set by Worker on upsert
);

-- =============================================================================
-- tracks_stats
-- =============================================================================
-- Per-track, per-status counters with EMA latency. One row per
-- (track_id, status) combination. Updated on every initial-play attempt
-- to call Django.
--
-- Statuses written by audio-worker.js:
--   'success'    Django returned 2xx
--   'timeout'    Worker gave up after DJANGO_TIMEOUT_MS
--   'error'      Network/runtime error before getting a response
--   'http_<N>'   Django returned a non-2xx status, e.g. 'http_500'
--
-- The latency is an exponential moving average (EMA), weighted toward
-- recent events. This means recent slowdowns surface in avg_latency_ms
-- instead of being smoothed out by historical data.
--
-- count gives you "how often", last_seen / first_seen give you
-- "is this a new problem or an old one", last_latency_ms gives you
-- the most recent observation as-is.
CREATE TABLE IF NOT EXISTS tracks_stats (
    track_id         INTEGER NOT NULL,
    status           TEXT NOT NULL,
    count            INTEGER NOT NULL DEFAULT 1,
    avg_latency_ms   INTEGER NOT NULL,  -- EMA, see audio-worker.js
    last_latency_ms  INTEGER NOT NULL,
    first_seen       INTEGER NOT NULL,
    last_seen        INTEGER NOT NULL,
    PRIMARY KEY (track_id, status)
);

-- Useful queries this index supports:
--   "What broke recently?" — WHERE status != 'success' AND last_seen > ?
--   "Show recent activity"  — ORDER BY last_seen DESC
CREATE INDEX IF NOT EXISTS idx_tracks_stats_last_seen
    ON tracks_stats (last_seen);

-- Useful queries this index supports:
--   "Failures in the last hour, by status"
--   "Recent timeouts only"
CREATE INDEX IF NOT EXISTS idx_tracks_stats_status_last_seen
    ON tracks_stats (status, last_seen);