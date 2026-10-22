-- D1 schema of the audio Worker (database "audio"): the whole schema in one
-- file, with no migration history.
--
-- Every statement is idempotent (CREATE ... IF NOT EXISTS):
--   node tools/d1.mjs schema --apply   creates what is missing, keeps all data
--                                      (also run by every `release: audio`)
--   node tools/d1.mjs reset --apply    drops every table, creates this schema
--                                      and loads the track paths again
--
-- The release workflow sends this file as one query with comments removed,
-- so "--" must not appear inside string literals here.

-- =============================================================================
-- tracks: track id -> audio object path
-- =============================================================================
-- Loaded from assets/data/media.json (tools/d1.mjs tracks, or reset). The
-- Worker only reads it: the object key is music/{folder_path}/{mp3}.
CREATE TABLE IF NOT EXISTS tracks (
    id          INTEGER PRIMARY KEY,
    folder_path TEXT NOT NULL,
    mp3         TEXT NOT NULL,
    updated_at  INTEGER NOT NULL  -- unix seconds of the last change
);

-- =============================================================================
-- tracks_status: what the Worker observed when serving /audio/:id
-- =============================================================================
-- served       fresh fetches that reached the Worker. Not a play count:
--              browser-cached replays and range continuations never arrive.
-- not_found    a tracks row exists but R2 has no object (drift between
--              media.json and the bucket)
-- fetch_error  R2 threw or behaved unexpectedly
--
--   Storage problems:  SELECT * FROM tracks_status WHERE not_found > 0 OR fetch_error > 0;
--   Recently served:   SELECT * FROM tracks_status ORDER BY last_seen DESC LIMIT 50;
CREATE TABLE IF NOT EXISTS tracks_status (
    track_id     INTEGER PRIMARY KEY,
    served       INTEGER NOT NULL DEFAULT 0,
    not_found    INTEGER NOT NULL DEFAULT 0,
    fetch_error  INTEGER NOT NULL DEFAULT 0,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_status_last_seen ON tracks_status (last_seen);

-- =============================================================================
-- plays: song plays, one row per track and UTC day
-- =============================================================================
-- Written by POST /plays (a play counts after 10 seconds of listening, see
-- src/core/plays.js) and read, summed, by GET /plays. No listener data.
--
--   Total per track:   SELECT track_id, SUM(n) AS plays FROM plays GROUP BY track_id;
--   Last 30 days:      SELECT track_id, SUM(n) AS plays FROM plays
--                      WHERE day >= date('now', '-30 days') GROUP BY track_id ORDER BY plays DESC LIMIT 50;
--   Per day:           SELECT day, SUM(n) FROM plays GROUP BY day ORDER BY day DESC LIMIT 30;
CREATE TABLE IF NOT EXISTS plays (
    track_id  INTEGER NOT NULL,
    day       TEXT    NOT NULL,  -- UTC date, YYYY-MM-DD
    n         INTEGER NOT NULL,
    PRIMARY KEY (track_id, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_plays_day ON plays (day);
