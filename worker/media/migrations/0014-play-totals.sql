-- Running sums of the counted plays (docs/worker-audio.md, "Play counts"), kept
-- in the same batch as each day's count: every song's total, and every day's.
-- GET /plays and GET /plays/stats read these instead of summing the whole
-- `plays` table (one row per song and day, growing for ever) on each cache
-- miss. Filled once here from `plays`; run by `tools/d1.mjs schema` before
-- schema.sql. Plays counted by the Worker still running between this and the
-- new Worker's deploy (a minute or two) are in `plays` but not in the sums.
CREATE TABLE IF NOT EXISTS play_totals (
    track_id  INTEGER PRIMARY KEY,
    total     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS play_days (
    day  TEXT    PRIMARY KEY,             -- UTC date, YYYY-MM-DD
    n    INTEGER NOT NULL
) WITHOUT ROWID;
INSERT OR REPLACE INTO play_totals (track_id, total) SELECT track_id, SUM(n) FROM plays GROUP BY track_id;
INSERT OR REPLACE INTO play_days (day, n) SELECT day, SUM(n) FROM plays GROUP BY day;
