-- Songbooks (docs/songbooks.md): books, their numbered entries, the texts
-- they print (whose words are lyrics rows under the text's id), works, people
-- and credits. New tables only; run by `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS songbooks (
    id           INTEGER PRIMARY KEY,
    title        TEXT    NOT NULL,
    short        TEXT    NOT NULL UNIQUE,
    lang         TEXT    NOT NULL,
    edition      TEXT    NOT NULL DEFAULT '',
    year         INTEGER,
    publisher    TEXT    NOT NULL DEFAULT '',
    rights       TEXT    NOT NULL DEFAULT 'unsettled',
    rights_note  TEXT    NOT NULL DEFAULT '',
    public       INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT    NOT NULL,
    at           INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS songbook_entries (
    book_id      INTEGER NOT NULL,
    number       INTEGER NOT NULL,
    text_id      INTEGER NOT NULL,
    at           INTEGER NOT NULL,
    PRIMARY KEY (book_id, number)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_songbook_entries_text ON songbook_entries (text_id);
CREATE TABLE IF NOT EXISTS song_texts (
    id           INTEGER PRIMARY KEY,
    work_id      INTEGER,
    lang         TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    first_line   TEXT    NOT NULL DEFAULT '',
    from_text    INTEGER,
    created_by   TEXT    NOT NULL,
    at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_texts_work ON song_texts (work_id);
CREATE TABLE IF NOT EXISTS song_works (
    id           INTEGER PRIMARY KEY,
    title        TEXT    NOT NULL,
    lang         TEXT    NOT NULL,
    tune         TEXT    NOT NULL DEFAULT '',
    metre        TEXT    NOT NULL DEFAULT '',
    year         INTEGER,
    scripture    TEXT    NOT NULL DEFAULT '',
    topics       TEXT    NOT NULL DEFAULT '',
    note         TEXT    NOT NULL DEFAULT '',
    created_by   TEXT    NOT NULL,
    at           INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS song_people (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    aka          TEXT    NOT NULL DEFAULT '',
    born         INTEGER,
    died         INTEGER,
    note         TEXT    NOT NULL DEFAULT '',
    created_by   TEXT    NOT NULL,
    at           INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS song_credits (
    subject      TEXT    NOT NULL,
    subject_id   INTEGER NOT NULL,
    person_id    INTEGER NOT NULL,
    role         TEXT    NOT NULL,
    PRIMARY KEY (subject, subject_id, person_id, role)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_song_credits_person ON song_credits (person_id);
