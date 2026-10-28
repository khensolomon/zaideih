-- Member ids that no longer exist, so a new member never gets one again: an
-- account joined into another (accounts.js mergeMembers) is removed, and
-- SQLite would otherwise give its id, the highest, to the next new member,
-- who would inherit its history (member_log) and default storage folder.
-- New table only; run by `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS member_retired (
    id    INTEGER PRIMARY KEY,           -- the id no longer used
    kept  INTEGER NOT NULL,              -- the member it was joined into
    at    INTEGER NOT NULL
);
