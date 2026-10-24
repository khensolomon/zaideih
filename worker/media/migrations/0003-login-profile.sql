-- The person's own name and photo, as each sign-in gives them (docs/accounts.md):
-- shown to them on Account. GitHub: the profile's name and avatar; Google:
-- the ID token's name and picture. Passkeys give neither. Run by
-- `tools/d1.mjs schema` before schema.sql.
ALTER TABLE member_logins ADD COLUMN full_name TEXT;
ALTER TABLE member_logins ADD COLUMN picture TEXT;
