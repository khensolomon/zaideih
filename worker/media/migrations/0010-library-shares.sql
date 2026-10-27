-- Sharing private music with other members (docs/library.md, "Sharing"):
-- one album of a member's library, or all of it (songs added later too),
-- shared with one member, through an invite link they open signed in (or
-- named directly by the owner or a co-owner). New table only; run by
-- `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS library_shares (
    id           INTEGER PRIMARY KEY,
    owner_id     INTEGER NOT NULL,              -- whose music
    scope        TEXT    NOT NULL,              -- 'album' | 'all'
    album        TEXT    NOT NULL DEFAULT '',   -- the album's name in the owner's library ('' : Singles); '' for 'all'
    member_id    INTEGER,                       -- who it is shared with; NULL while the invite is unused
    listen_only  INTEGER NOT NULL DEFAULT 0,    -- 1: the app offers no download
    invite_hash  TEXT    UNIQUE,                -- SHA-256 (hex) of the invite code while unused; NULL once taken or named
    created_at   INTEGER NOT NULL,
    accepted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_library_shares_owner ON library_shares (owner_id);
CREATE INDEX IF NOT EXISTS idx_library_shares_member ON library_shares (member_id);
