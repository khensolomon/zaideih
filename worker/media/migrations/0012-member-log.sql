-- What the owner, co-owners and moderators did to a member, for the
-- Workspace's Members (a member's History): rights given and taken, the
-- storage folder set, blocks, sign-outs and deleted uploads. New table
-- only; run by `tools/d1.mjs schema` before schema.sql.
CREATE TABLE IF NOT EXISTS member_log (
    id         INTEGER PRIMARY KEY,
    member_id  INTEGER NOT NULL,              -- whom it was done to
    action     TEXT    NOT NULL,              -- right-given | right-taken | folder | blocked | unblocked | signed-out | uploads-deleted
    detail     TEXT    NOT NULL DEFAULT '{}', -- JSON: { right } | { folder } | { reason } | { sessions } | { titles, count }
    by_login   TEXT    NOT NULL,
    at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_log_member ON member_log (member_id, at);
