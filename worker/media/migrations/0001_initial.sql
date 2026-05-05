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
-- tracks_status
-- =============================================================================
-- One row per track. Records what the Worker observed when serving /audio/:id.
--
-- IMPORTANT: The Worker only sees the FIRST request per (browser, cache
-- lifetime). After the response is cached, range continuations and replays
-- come from the browser's cache and never reach the Worker. So `served` is
-- a count of fresh-fetch events, NOT a play counter.
--
-- The real play counter lives in Django, populated by an explicit POST
-- from the SPA (which sees every play regardless of cache).
--
-- Columns:
--   served       Worker fetched the MP3 from R2 and returned it (initial
--                or full request, status 200/206 to the client).
--   not_found    D1 had the track row, but R2 returned no object for the
--                computed key. Indicates a sync drift between Django and R2.
--   fetch_error  R2 threw or behaved unexpectedly during the fetch.
--   first_seen   Unix seconds, set on insert, never updated.
--   last_seen    Unix seconds of the most recent observation of any kind.
--
-- Useful queries:
--   "Tracks with R2 issues":
--     SELECT * FROM tracks_status WHERE not_found > 0 OR fetch_error > 0;
--   "Recently active":
--     SELECT * FROM tracks_status ORDER BY last_seen DESC LIMIT 50;
--   "Never served (uploaded but unused)":
--     SELECT t.id FROM tracks t
--     LEFT JOIN tracks_status s ON s.track_id = t.id
--     WHERE s.track_id IS NULL;
CREATE TABLE IF NOT EXISTS tracks_status (
    track_id     INTEGER PRIMARY KEY,
    served       INTEGER NOT NULL DEFAULT 0,
    not_found    INTEGER NOT NULL DEFAULT 0,
    fetch_error  INTEGER NOT NULL DEFAULT 0,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_status_last_seen
    ON tracks_status (last_seen);
