-- D1 schema of the audio Worker (database "audio"): the whole schema as it
-- is now, in one file.
--
-- Every statement is idempotent (CREATE ... IF NOT EXISTS):
--   node tools/d1.mjs schema --apply   runs the pending migrations
--                                      (worker/media/migrations/, for changes
--                                      CREATE cannot make, such as renames),
--                                      then creates what is missing; keeps
--                                      all data (also run by every `release: audio`)
--   node tools/d1.mjs reset --apply    drops every table, creates this schema
--                                      and loads the track paths again
--
-- The release workflow sends this file as one query with comments removed,
-- so "--" must not appear inside string literals here.

-- =============================================================================
-- tracks: track id -> audio object path
-- =============================================================================
-- Loaded from assets/data/media.json (tools/d1.mjs tracks, or reset). The
-- Worker only reads it: the object key is music/{folder_path}/{mp3}.
CREATE TABLE IF NOT EXISTS tracks (
    id          INTEGER PRIMARY KEY,
    folder_path TEXT NOT NULL,
    mp3         TEXT NOT NULL,
    updated_at  INTEGER NOT NULL  -- unix seconds of the last change
);

-- =============================================================================
-- tracks_status: what the Worker observed when serving /audio/:id
-- =============================================================================
-- served       fresh fetches that reached the Worker. Not a play count:
--              browser-cached replays and range continuations never arrive.
-- not_found    a tracks row exists but R2 has no object (drift between
--              media.json and the bucket)
-- fetch_error  R2 threw or behaved unexpectedly
--
--   Storage problems:  SELECT * FROM tracks_status WHERE not_found > 0 OR fetch_error > 0;
--   Recently served:   SELECT * FROM tracks_status ORDER BY last_seen DESC LIMIT 50;
CREATE TABLE IF NOT EXISTS tracks_status (
    track_id     INTEGER PRIMARY KEY,
    served       INTEGER NOT NULL DEFAULT 0,
    not_found    INTEGER NOT NULL DEFAULT 0,
    fetch_error  INTEGER NOT NULL DEFAULT 0,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_status_last_seen ON tracks_status (last_seen);

-- =============================================================================
-- plays: song plays, one row per track and UTC day
-- =============================================================================
-- Written by POST /plays (a play counts after 10 seconds of listening, see
-- src/core/plays.js) and read, summed, by GET /plays. No listener data.
--
--   Total per track:   SELECT track_id, SUM(n) AS plays FROM plays GROUP BY track_id;
--   Last 30 days:      SELECT track_id, SUM(n) AS plays FROM plays
--                      WHERE day >= date('now', '-30 days') GROUP BY track_id ORDER BY plays DESC LIMIT 50;
--   Per day:           SELECT day, SUM(n) FROM plays GROUP BY day ORDER BY day DESC LIMIT 30;
CREATE TABLE IF NOT EXISTS plays (
    track_id  INTEGER NOT NULL,
    day       TEXT    NOT NULL,  -- UTC date, YYYY-MM-DD
    n         INTEGER NOT NULL,
    PRIMARY KEY (track_id, day)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_plays_day ON plays (day);

-- =============================================================================
-- schema_migrations: which files of worker/media/migrations have run
-- =============================================================================
-- A database made from this file records every migration as run, since this
-- file already has their result.
CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT    PRIMARY KEY,
    applied_at  INTEGER NOT NULL
);

-- =============================================================================
-- members: Zaideih accounts (docs/accounts.md)
-- =============================================================================
-- One row per person, however they sign in (member_logins). Members made
-- before accounts (migration 0001) kept their GitHub id as their id, so
-- their files in R2 (users/<id>/…) did not move; new members are numbered
-- after the highest id. `name` is shown to moderators: the GitHub login, or
-- the name another sign-in gives. Blocking and rights are Zaideih's own.
-- Not rebuildable from git: `tools/d1.mjs reset` refuses while it has rows.
--
--   Blocked:     SELECT name, blocked_by, blocked_reason FROM members WHERE blocked_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS members (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    moderator       INTEGER NOT NULL DEFAULT 0,  -- 1: may block members and delete uploads
    blocked_at      INTEGER,                     -- unix seconds; NULL when not blocked
    blocked_by      TEXT,
    blocked_reason  TEXT,
    first_seen      INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL
);

-- =============================================================================
-- member_logins: the ways a member signs in
-- =============================================================================
-- provider: github (subject: GitHub's numeric user id), later google and
-- passkey. A sign-in whose provider vouches for its email (email_verified = 1)
-- joins the member who already has that verified email; otherwise a member
-- adds it while signed in. `login` is the GitHub login (for GitHub only).
-- Not rebuildable from git: kept by `tools/d1.mjs reset` like members.
--
--   Sign-ins of a member:  SELECT provider, login, email FROM member_logins WHERE member_id = ?;
CREATE TABLE IF NOT EXISTS member_logins (
    provider        TEXT    NOT NULL,
    subject         TEXT    NOT NULL,
    member_id       INTEGER NOT NULL,
    login           TEXT,
    email           TEXT,                        -- lower case
    email_verified  INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    last_used       INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_member_logins_member ON member_logins (member_id);
CREATE INDEX IF NOT EXISTS idx_member_logins_email ON member_logins (email) WHERE email_verified = 1;

-- =============================================================================
-- member_sessions: Zaideih sign-in tokens (worker/media/accounts.js)
-- =============================================================================
-- Only a SHA-256 hash of each token is kept. A token lasts SESSION_DAYS after
-- its last use; signing out deletes its row, and a block applies at once.
CREATE TABLE IF NOT EXISTS member_sessions (
    token_hash  TEXT    PRIMARY KEY,
    member_id   INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    last_used   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions (member_id);

-- =============================================================================
-- uploads: files in members' personal libraries (R2 users/<member id>/<id>.<ext>)
-- =============================================================================
-- status: uploading (row made, file not yet stored), private, requested,
-- published, released (see publish_requests). Upload ids are not catalog
-- track ids. owner_id is the member's id.
-- Not rebuildable from git: `tools/d1.mjs reset` refuses while it has rows.
--
--   Space per member:  SELECT owner_id, COUNT(*), SUM(size) FROM uploads GROUP BY owner_id;
CREATE TABLE IF NOT EXISTS uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL,
    r2_key      TEXT    NOT NULL UNIQUE,
    size        INTEGER NOT NULL,
    format      TEXT    NOT NULL,               -- mp3, m4a, flac, wav, ogg
    duration    INTEGER NOT NULL,               -- seconds
    title       TEXT    NOT NULL,
    artist      TEXT    NOT NULL DEFAULT '',
    album       TEXT    NOT NULL DEFAULT '',
    year        INTEGER,
    track_no    INTEGER,
    file_name   TEXT    NOT NULL,               -- as uploaded, for the owner's reference
    status      TEXT    NOT NULL DEFAULT 'uploading',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads (owner_id, status);

-- =============================================================================
-- member_rights: what the owner has trusted a member with (docs/library.md)
-- =============================================================================
-- kind: manage (co-owner: everything below, and gives or takes any right),
-- review (approves or rejects requests to publish), moderate (blocks
-- members, deletes uploads), storage (adds files already in R2 under
-- private/<member id>/). The owner (the member signed in with the GitHub
-- account OWNER_GITHUB_ID) holds every right without a row.
-- members.moderator = 1 (from before rights existed) counts as moderate.
-- Not rebuildable from git: kept by `tools/d1.mjs reset` like members.
--
--   Who holds what:  SELECT m.name, r.kind, r.granted_by FROM member_rights r JOIN members m ON m.id = r.member_id;
CREATE TABLE IF NOT EXISTS member_rights (
    member_id   INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    granted_by  TEXT    NOT NULL,
    granted_at  INTEGER NOT NULL,
    PRIMARY KEY (member_id, kind)
) WITHOUT ROWID;

-- =============================================================================
-- member_folders: where in R2 a member with the Storage right adds files from
-- =============================================================================
-- Set by the owner or a co-owner on the admin page (Members). Without a row
-- the folder is private/<member id>/. The owner and co-owners add from the
-- whole bucket except users/ (members' uploads).
-- Not rebuildable from git: kept by `tools/d1.mjs reset` like members.
CREATE TABLE IF NOT EXISTS member_folders (
    member_id  INTEGER PRIMARY KEY,
    prefix     TEXT    NOT NULL,
    set_by     TEXT    NOT NULL,
    set_at     INTEGER NOT NULL
);

-- =============================================================================
-- publish_requests: a member's album asked to join the public catalog
-- =============================================================================
-- status: open (waiting for review), withdrawn (by the member), rejected
-- (with a reason), approved (files copied to music/…, the catalog pull
-- request opened), released (the release loaded the songs: the member's
-- uploaded copies are gone and the library rows point at the catalog files).
-- Reviewed by Review publishing; the owner and co-owners may do or undo
-- anything. Not rebuildable from git: kept by `tools/d1.mjs reset`.
CREATE TABLE IF NOT EXISTS publish_requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id       INTEGER NOT NULL,
    album          TEXT    NOT NULL,
    lang           INTEGER NOT NULL,
    note           TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'open',
    reviewer       TEXT,
    reason         TEXT,
    catalog_album  TEXT,
    pr_url         TEXT,
    created_at     INTEGER NOT NULL,
    decided_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_publish_requests_status ON publish_requests (status, created_at);

-- =============================================================================
-- published_tracks: each song of an approved request and its catalog place
-- =============================================================================
-- The member stays credited: their library lists these as published by them.
CREATE TABLE IF NOT EXISTS published_tracks (
    upload_id   INTEGER PRIMARY KEY,
    request_id  INTEGER NOT NULL,
    owner_id    INTEGER NOT NULL,
    track_id    INTEGER NOT NULL UNIQUE,
    r2_key      TEXT    NOT NULL UNIQUE      -- music/<folder>/<file>
);

-- =============================================================================
-- signin_waiting: sign-ins finishing in a browser sheet (auth.js, waitPage)
-- =============================================================================
-- An app added to the home screen opens Google's or GitHub's sign-in in a
-- browser sheet that cannot hand the result back. The callback keeps the
-- code here under a hash of the sign-in's nonce, for 10 minutes, and the app
-- takes it once (POST /auth/wait). The code is useless without the PKCE
-- verifier, which never left the app.
CREATE TABLE IF NOT EXISTS signin_waiting (
    nonce_hash  TEXT    PRIMARY KEY,
    code        TEXT,
    error       TEXT,
    created_at  INTEGER NOT NULL
);

-- =============================================================================
-- passkeys: signing in with the device's own lock (passkeys.js)
-- =============================================================================
-- One row per passkey: its credential id (base64url), the member, its public
-- key (a JWK WebCrypto imports) and algorithm (-7 ES256, -257 RS256), and the
-- signature counter (0 for devices that keep none). Each is also a sign-in
-- in member_logins (provider "passkey"); removing that removes this.
-- Not rebuildable from git: kept by `tools/d1.mjs reset` like members.
CREATE TABLE IF NOT EXISTS passkeys (
    credential_id  TEXT    PRIMARY KEY,
    member_id      INTEGER NOT NULL,
    jwk            TEXT    NOT NULL,
    alg            INTEGER NOT NULL,
    sign_count     INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    last_used      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_member ON passkeys (member_id);

-- passkey_challenges: one-time challenges for making or using a passkey (5 minutes).
CREATE TABLE IF NOT EXISTS passkey_challenges (
    challenge   TEXT    PRIMARY KEY,
    kind        TEXT    NOT NULL,          -- create, get
    member_id   INTEGER,                   -- create: the member adding it
    rp_id       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
);

-- =============================================================================
-- library_likes, library_playlists, library_sync: Library on every device (sync.js)
-- =============================================================================
-- A member's liked songs and playlists, as the devices have sent them. Every
-- row written in one sync takes the member's new counter (library_sync.seq),
-- so a device asks for "changed since" the counter it last saw. Song ids are
-- text: catalog ids, or u<id> for uploads. A deleted playlist stays as a mark
-- (deleted = 1) so every device removes it. `at` is the device's clock (ms).
-- Not rebuildable from git: kept by `tools/d1.mjs reset` like members.
CREATE TABLE IF NOT EXISTS library_likes (
    member_id  INTEGER NOT NULL,
    track      TEXT    NOT NULL,
    liked      INTEGER NOT NULL,
    at         INTEGER NOT NULL,
    seq        INTEGER NOT NULL,
    PRIMARY KEY (member_id, track)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_library_likes_seq ON library_likes (member_id, seq);
CREATE TABLE IF NOT EXISTS library_playlists (
    member_id  INTEGER NOT NULL,
    uid        TEXT    NOT NULL,            -- 16 hex, made by the device
    name       TEXT    NOT NULL,
    tracks     TEXT    NOT NULL,            -- JSON list of song ids
    deleted    INTEGER NOT NULL DEFAULT 0,
    at         INTEGER NOT NULL,
    version    INTEGER NOT NULL,
    seq        INTEGER NOT NULL,
    PRIMARY KEY (member_id, uid)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_library_playlists_seq ON library_playlists (member_id, seq);
CREATE TABLE IF NOT EXISTS library_sync (
    member_id  INTEGER PRIMARY KEY,
    seq        INTEGER NOT NULL
);

-- =============================================================================
-- lyrics, lyrics_versions: lyrics of catalog songs (lyrics.js, docs/lyrics.md)
-- =============================================================================
-- lyrics holds what is shown (the latest version); lyrics_versions every
-- version ever saved, with who and when, so a bad edit is undone by
-- restoring an earlier one. Hidden lyrics (hidden_at set, by the Lyrics
-- right) are not shown to listeners. Not rebuildable from git: kept by
-- `tools/d1.mjs reset`; `tools/d1.mjs lyrics` writes them to a file.
--
--   Latest edits:  SELECT v.track, v.version, m.name, v.at FROM lyrics_versions v JOIN members m ON m.id = v.member_id ORDER BY v.at DESC LIMIT 50;
CREATE TABLE IF NOT EXISTS lyrics (
    track          INTEGER PRIMARY KEY,     -- catalog song id (tracks.id)
    version        INTEGER NOT NULL,
    text           TEXT    NOT NULL,
    updated_at     INTEGER NOT NULL,        -- unix seconds
    updated_by     INTEGER NOT NULL,        -- member id
    hidden_at      INTEGER,
    hidden_by      TEXT,
    hidden_reason  TEXT
);
CREATE TABLE IF NOT EXISTS lyrics_versions (
    track      INTEGER NOT NULL,
    version    INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    member_id  INTEGER NOT NULL,
    at         INTEGER NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',  -- e.g. "restored version 2"
    PRIMARY KEY (track, version)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_lyrics_versions_member ON lyrics_versions (member_id);
