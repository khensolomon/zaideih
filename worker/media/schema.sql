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

-- =============================================================================
-- members: GitHub accounts that use their personal library (docs/library.md)
-- =============================================================================
-- Keyed by GitHub's numeric id, since logins can change. Written by the
-- Worker on library requests (library.js). Roles other than moderator come
-- from GitHub on every request; blocking and moderator rights are Zaideih's.
-- Not rebuildable from git: `tools/d1.mjs reset` refuses while it has rows.
--
--   Blocked:     SELECT login, blocked_by, blocked_reason FROM members WHERE blocked_at IS NOT NULL;
--   Moderators:  SELECT login FROM members WHERE moderator = 1;
CREATE TABLE IF NOT EXISTS members (
    github_id       INTEGER PRIMARY KEY,
    login           TEXT    NOT NULL,
    moderator       INTEGER NOT NULL DEFAULT 0,  -- 1: may block members and delete uploads
    blocked_at      INTEGER,                     -- unix seconds; NULL when not blocked
    blocked_by      TEXT,
    blocked_reason  TEXT,
    first_seen      INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL
);

-- =============================================================================
-- uploads: files in members' personal libraries (R2 users/<github_id>/<id>.<ext>)
-- =============================================================================
-- status: uploading (row made, file not yet stored), private. Later:
-- requested, published, rejected. Upload ids are not catalog track ids.
-- Not rebuildable from git: `tools/d1.mjs reset` refuses while it has rows.
--
--   Space per member:  SELECT owner_id, COUNT(*), SUM(size) FROM uploads GROUP BY owner_id;
CREATE TABLE IF NOT EXISTS uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL,
    r2_key      TEXT    NOT NULL UNIQUE,
    size        INTEGER NOT NULL,
    format      TEXT    NOT NULL,               -- mp3, m4a, flac, wav, ogg
    duration    INTEGER NOT NULL,               -- seconds
    title       TEXT    NOT NULL,
    artist      TEXT    NOT NULL DEFAULT '',
    album       TEXT    NOT NULL DEFAULT '',
    year        INTEGER,
    track_no    INTEGER,
    file_name   TEXT    NOT NULL,               -- as uploaded, for the owner's reference
    status      TEXT    NOT NULL DEFAULT 'uploading',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads (owner_id, status);

-- =============================================================================
-- member_rights: what the owner has trusted a member with (docs/library.md)
-- =============================================================================
-- kind: manage (co-owner: everything below, and gives or takes any right),
-- review (approves or rejects requests to publish), moderate (blocks
-- members, deletes uploads), storage (adds files already in R2 under
-- private/<github_id>/). The repository's owner holds every right without
-- a row. members.moderator = 1 (from before rights existed) counts as moderate.
-- Not rebuildable from git: kept by `tools/d1.mjs reset` like members.
--
--   Who holds what:  SELECT m.login, r.kind, r.granted_by FROM member_rights r JOIN members m ON m.github_id = r.github_id;
CREATE TABLE IF NOT EXISTS member_rights (
    github_id   INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    granted_by  TEXT    NOT NULL,
    granted_at  INTEGER NOT NULL,
    PRIMARY KEY (github_id, kind)
) WITHOUT ROWID;
