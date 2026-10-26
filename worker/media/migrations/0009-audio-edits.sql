-- The audio studio (docs/audio-studio.md): songs' recordings trimmed without
-- a release. The original in R2 is never changed; each cut is a new object
-- (edits/<track>/<version>.mp3) and a version here, and the version a song
-- plays is its current one (none: the original, version 0). New tables only;
-- run by `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS audio_versions (
    track_id     INTEGER NOT NULL,
    version      INTEGER NOT NULL,              -- 1, 2, ...; 0 is the original, not stored
    object_key   TEXT    NOT NULL,              -- the R2 object
    start_ms     INTEGER NOT NULL,              -- the cut, in the original's time
    end_ms       INTEGER NOT NULL,
    duration_ms  INTEGER NOT NULL,
    bytes        INTEGER NOT NULL,
    note         TEXT    NOT NULL DEFAULT '',
    made_by      TEXT    NOT NULL,
    at           INTEGER NOT NULL,
    PRIMARY KEY (track_id, version)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS audio_current (
    track_id     INTEGER PRIMARY KEY,
    version      INTEGER NOT NULL,              -- 0: the original again
    set_by       TEXT    NOT NULL,
    at           INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audio_log (
    id           INTEGER PRIMARY KEY,
    track_id     INTEGER NOT NULL,
    version      INTEGER NOT NULL,
    action       TEXT    NOT NULL,              -- cut | restore
    by_name      TEXT    NOT NULL,
    at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audio_log_track ON audio_log (track_id, at);
