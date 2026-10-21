-- Song play counts, written by POST /plays (worker/media/script.js).
-- Idempotent: the release workflow runs every migration on each audio release.

-- =============================================================================
-- plays
-- =============================================================================
-- One row per track and UTC day. A play counts after 10 seconds of listening
-- (src/core/plays.js). No listener data is stored.
--
-- Useful queries:
--   "Total plays per track":
--     SELECT track_id, SUM(n) AS plays FROM plays GROUP BY track_id;
--   "Most played in the last 30 days":
--     SELECT track_id, SUM(n) AS plays FROM plays
--     WHERE day >= date('now', '-30 days') GROUP BY track_id ORDER BY plays DESC LIMIT 50;
--   "Plays per day":
--     SELECT day, SUM(n) FROM plays GROUP BY day ORDER BY day DESC LIMIT 30;
CREATE TABLE IF NOT EXISTS plays (
    track_id  INTEGER NOT NULL,
    day       TEXT    NOT NULL,  -- UTC date, YYYY-MM-DD
    n         INTEGER NOT NULL,
    PRIMARY KEY (track_id, day)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_plays_day ON plays (day);
