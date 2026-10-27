-- Catalog changes made live, without a release (docs/live-catalog.md): the
-- Workspace's own changes (an album's title, year, language and genres; a
-- song's title, artists, hidden; an artist's name, other name, type and
-- spellings), each with the value in the released catalog it was made
-- against. The app applies them on top of the catalog it shipped with until
-- a release carries them. New tables only; run by `tools/d1.mjs schema`
-- before schema.sql.
CREATE TABLE IF NOT EXISTS catalog_live (
    kind         TEXT    NOT NULL,              -- album | track | artist
    item_id      TEXT    NOT NULL,              -- album ui, track id, artist id (as text)
    field        TEXT    NOT NULL,              -- the draft's field name (src/workspace/draft.js)
    value        TEXT    NOT NULL,              -- JSON: the new value
    base         TEXT    NOT NULL,              -- JSON: the released value it was made against
    refs         TEXT    NOT NULL DEFAULT '{}', -- JSON: artists, languages, genres the released catalog may lack
    set_by       TEXT    NOT NULL,
    at           INTEGER NOT NULL,
    PRIMARY KEY (kind, item_id, field)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS catalog_live_log (
    id           INTEGER PRIMARY KEY,
    kind         TEXT    NOT NULL,
    item_id      TEXT    NOT NULL,
    field        TEXT    NOT NULL,
    value        TEXT,                          -- JSON, for set
    action       TEXT    NOT NULL,              -- set | undo | released | overtaken
    set_by       TEXT    NOT NULL,
    at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_live_log_at ON catalog_live_log (at);
