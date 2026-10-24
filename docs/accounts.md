# Accounts

A Zaideih account is one person, however they sign in. Personal libraries, rights, blocks and, later, synced likes and playlists and lyrics belong to the account, not to a GitHub account. GitHub stays what catalog editing runs on: the admin page edits the catalog with the person's GitHub sign-in, and GitHub decides what it may do.

Status: agreed 2026-10-24. Built: accounts, GitHub as their first sign-in, Zaideih sessions (this release). Next: Google sign-in and a "Your account" page; then passkeys; then likes and playlists synced across devices; then lyrics.

## Sign-ins

D1 `member_logins` holds one row per way a member signs in: the provider (`github`; later `google`, `passkey`), the provider's id for the person (GitHub's numeric user id, never the login, which can be renamed), the GitHub login, and the email the provider gives with whether the provider has verified it.

A sign-in finds its member (`worker/media/accounts.js`):

1. A sign-in seen before belongs to its member.
2. Adding a sign-in while signed in (`link`) joins the signed-in member, unless the sign-in already belongs to another account (409).
3. A sign-in whose provider vouches for an email that exactly one member already has verified joins that member. Every verified address counts (GitHub lists all of a person's addresses; `@users.noreply.github.com` ones are skipped). Two members with that email: neither is guessed; a new member is made.
4. Otherwise a new member is made.

Only verified emails join members: an unverified address could be anyone's. Signing in with GitHub and Google with the same verified address is one person; with different addresses, the second is added from the first while signed in.

GitHub gives the addresses only when the GitHub App has the Email addresses permission ([setup.md](setup.md#github-app-zaideih-sign-in-suggestions)); without it, or with a fine-grained token without that permission, a GitHub sign-in never joins by email.

## Sessions

After a sign-in the Worker gives a session token (`zs_` and 43 base64url characters), kept on the device (`localStorage`, `zaideih.account`, `src/core/account.js`). Only its SHA-256 hash is stored (`member_sessions`). It lasts 90 days after its last use (renewed at most daily); signing out deletes it, and a block applies to it at once. The personal library routes accept nothing else, and no longer ask GitHub on every request.

| Route | Does |
|---|---|
| `POST /auth/session` with `Authorization: Bearer <GitHub token>`, body `{}` or `{"link": "<session>"}` | Checks the token with GitHub (`GET /user`, `GET /user/emails`), finds or makes the member, answers `{token, expires_at, member: {id, name}, joined, email}`; `joined` is `known`, `link`, `email` or `new` |
| `POST /auth/session/end` with `Authorization: Bearer <session>` | Signs that session out |

The app gets a session from the device's GitHub sign-in (or fine-grained token) the first time it needs one, keeps it with the login it was got for, and gets a new one when that login changes or the Worker refuses it.

## The owner

The owner is the member signed in with the GitHub account `OWNER_GITHUB_ID` (`wrangler.toml`; 1753766, the repository owner's id from `GET /repos/khensolomon/zaideih`). A login is not enough: it could be renamed and then taken by someone else.

## Members from before accounts

Until accounts, members were GitHub accounts keyed by GitHub's id. Migration `worker/media/migrations/0001-accounts.sql` turned each into a member with the same id (so R2 `users/<id>/…` did not move) and its GitHub sign-in, renaming `members.github_id` to `id`, `members.login` to `name`, and `github_id` to `member_id` in `member_rights` and `member_folders`. New members are numbered after the highest id.

Migrations are for changes `CREATE … IF NOT EXISTS` cannot make, such as renames. `tools/d1.mjs schema` runs the pending ones, each as one import recorded in `schema_migrations`, before the schema; a database made from the schema records them as run. The release (`audio`) runs it before deploying the Worker, so for the minute between the two the Worker still running reads the old column names and the library routes answer 500.

## Privacy

Emails are stored only as the provider gives them, to recognise the same person. They are shown to nobody in the app.
