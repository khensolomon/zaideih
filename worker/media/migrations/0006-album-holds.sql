-- Albums held back from listeners without a release (docs/holds.md): streaming
-- off, or hidden from the public. New tables only; run by `tools/d1.mjs schema`
-- before schema.sql.
CREATE TABLE IF NOT EXISTS album_holds (
    album_id    TEXT    PRIMARY KEY,
    streaming   INTEGER NOT NULL,
    listed      INTEGER NOT NULL,
    reason      TEXT    NOT NULL,
    set_by      TEXT    NOT NULL,
    at          INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS album_hold_tracks (
    track_id    INTEGER PRIMARY KEY,
    album_id    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_album_hold_tracks_album ON album_hold_tracks (album_id);
CREATE TABLE IF NOT EXISTS album_hold_log (
    id          INTEGER PRIMARY KEY,
    album_id    TEXT    NOT NULL,
    streaming   INTEGER NOT NULL,
    listed      INTEGER NOT NULL,
    reason      TEXT    NOT NULL,
    set_by      TEXT    NOT NULL,
    at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_album_hold_log_album ON album_hold_log (album_id, at);
