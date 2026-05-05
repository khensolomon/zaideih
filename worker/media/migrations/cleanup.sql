-- Periodic cleanup of play_telemetry. Without this the table grows
-- forever, which is fine for D1 storage limits at first but becomes
-- expensive to query.
--
-- Recommended: run via a Cloudflare Worker cron trigger, daily.
-- The retention window is set to 30 days; adjust as needed.
--
-- Manual run: wrangler d1 execute <DB_NAME> --file=./cleanup.sql
-- Or set up a scheduled Worker that issues this DELETE periodically.

DELETE FROM play_telemetry
WHERE recorded_at < (strftime('%s', 'now') - 60 * 60 * 24 * 30);
