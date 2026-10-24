-- Proposals that two songs are the same (docs/lyrics.md, "Shared lyrics"):
-- members propose, the Lyrics right links or merges, or declines with a
-- reason. New table only; run by `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS lyrics_proposals (
    id           INTEGER PRIMARY KEY,
    track        INTEGER NOT NULL,
    target       INTEGER NOT NULL,
    member_id    INTEGER NOT NULL,
    note         TEXT    NOT NULL DEFAULT '',
    at           INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'open',
    decided_by   TEXT,
    decided_at   INTEGER,
    reason       TEXT
);
CREATE INDEX IF NOT EXISTS idx_lyrics_proposals_open ON lyrics_proposals (status, at);
