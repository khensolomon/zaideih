-- Accounts (docs/accounts.md): members stop being GitHub accounts and become
-- Zaideih's own, which GitHub and other sign-ins belong to.
--
-- Every member so far signed in with GitHub and was keyed by GitHub's id. The
-- ids stay (so R2 users/<id>/… does not move); each becomes a GitHub sign-in
-- in member_logins. Run by `tools/d1.mjs schema` before schema.sql, as one
-- import that either completes or leaves the database as it was.
ALTER TABLE members RENAME COLUMN github_id TO id;
ALTER TABLE members RENAME COLUMN login TO name;
ALTER TABLE member_rights RENAME COLUMN github_id TO member_id;
ALTER TABLE member_folders RENAME COLUMN github_id TO member_id;
CREATE TABLE IF NOT EXISTS member_logins (
    provider        TEXT    NOT NULL,
    subject         TEXT    NOT NULL,
    member_id       INTEGER NOT NULL,
    login           TEXT,
    email           TEXT,
    email_verified  INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    last_used       INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
);
INSERT INTO member_logins (provider, subject, member_id, login, created_at, last_used)
    SELECT 'github', CAST(id AS TEXT), id, name, first_seen, last_seen FROM members;
