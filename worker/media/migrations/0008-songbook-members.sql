-- Collaborators on one songbook (docs/songbooks.md): an editor changes the
-- book, its numbers and its songs; a reader sees it while it is private. The
-- owner, co-owners and the Songbooks right appoint them. New table only; run
-- by `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS songbook_members (
    book_id     INTEGER NOT NULL,
    member_id   INTEGER NOT NULL,
    role        TEXT    NOT NULL,              -- editor | reader
    added_by    TEXT    NOT NULL,
    at          INTEGER NOT NULL,
    PRIMARY KEY (book_id, member_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_songbook_members_member ON songbook_members (member_id);
