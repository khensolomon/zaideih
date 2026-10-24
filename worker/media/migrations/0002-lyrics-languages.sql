-- Lyrics per language (docs/lyrics.md): a song's own words and translations
-- are kept apart, keyed by (track, lang); the original is lang ''. Adds
-- `words` (what is sung, for searching; filled by the Worker when first
-- asked for the index) and `changed_at` (for the index's "changed since").
--
-- A database from before lyrics existed gets the old tables first (empty),
-- so the copies below work either way. Run by `tools/d1.mjs schema` before
-- schema.sql, as one import that either completes or leaves the database as
-- it was.
CREATE TABLE IF NOT EXISTS lyrics (
    track INTEGER PRIMARY KEY, version INTEGER NOT NULL, text TEXT NOT NULL, updated_at INTEGER NOT NULL,
    updated_by INTEGER NOT NULL, hidden_at INTEGER, hidden_by TEXT, hidden_reason TEXT
);
CREATE TABLE IF NOT EXISTS lyrics_versions (
    track INTEGER NOT NULL, version INTEGER NOT NULL, text TEXT NOT NULL, member_id INTEGER NOT NULL,
    at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (track, version)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS lyrics_reports (
    id INTEGER PRIMARY KEY, track INTEGER NOT NULL, member_id INTEGER NOT NULL, reason TEXT NOT NULL,
    at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT
);

CREATE TABLE lyrics_new (
    track          INTEGER NOT NULL,
    lang           TEXT    NOT NULL DEFAULT '',
    version        INTEGER NOT NULL,
    text           TEXT    NOT NULL,
    words          TEXT,
    updated_at     INTEGER NOT NULL,
    updated_by     INTEGER NOT NULL,
    hidden_at      INTEGER,
    hidden_by      TEXT,
    hidden_reason  TEXT,
    changed_at     INTEGER NOT NULL,
    PRIMARY KEY (track, lang)
);
INSERT INTO lyrics_new (track, lang, version, text, words, updated_at, updated_by, hidden_at, hidden_by, hidden_reason, changed_at)
    SELECT track, '', version, text, NULL, updated_at, updated_by, hidden_at, hidden_by, hidden_reason, MAX(updated_at, COALESCE(hidden_at, 0)) FROM lyrics;
DROP TABLE lyrics;
ALTER TABLE lyrics_new RENAME TO lyrics;

CREATE TABLE lyrics_versions_new (
    track      INTEGER NOT NULL,
    lang       TEXT    NOT NULL DEFAULT '',
    version    INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    member_id  INTEGER NOT NULL,
    at         INTEGER NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (track, lang, version)
) WITHOUT ROWID;
INSERT INTO lyrics_versions_new (track, lang, version, text, member_id, at, note)
    SELECT track, '', version, text, member_id, at, note FROM lyrics_versions;
DROP TABLE lyrics_versions;
ALTER TABLE lyrics_versions_new RENAME TO lyrics_versions;

ALTER TABLE lyrics_reports ADD COLUMN lang TEXT NOT NULL DEFAULT '';
