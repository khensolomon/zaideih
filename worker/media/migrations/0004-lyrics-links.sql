-- Shared lyrics (docs/lyrics.md, "Shared lyrics"): a recording uses the
-- lyrics of another recording of the same song (lyrics_links), and each
-- recording of a shared text keeps its own timing (lyrics_times). New
-- tables only; run by `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS lyrics_links (
    track        INTEGER PRIMARY KEY,
    source       INTEGER NOT NULL,
    member_id    INTEGER NOT NULL,
    at           INTEGER NOT NULL,
    unlinked_at  INTEGER,
    unlinked_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_lyrics_links_source ON lyrics_links (source);
CREATE TABLE IF NOT EXISTS lyrics_times (
    track      INTEGER NOT NULL,
    lang       TEXT    NOT NULL DEFAULT '',
    times      TEXT    NOT NULL,
    member_id  INTEGER NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (track, lang)
) WITHOUT ROWID;
