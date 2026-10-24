# Accounts

A Zaideih account is one person, however they sign in. Personal libraries, rights, blocks and, later, synced likes and playlists and lyrics belong to the account, not to a GitHub account. GitHub stays what catalog editing runs on: the admin page edits the catalog with the person's GitHub sign-in, and GitHub decides what it may do.

Status: agreed 2026-10-24. Built: accounts, GitHub as their first sign-in, Zaideih sessions (v26.10.24.1); Google sign-in and Your account (this release). Next: passkeys; then likes and playlists synced across devices; then lyrics.

## Sign-ins

D1 `member_logins` holds one row per way a member signs in: the provider (`github`, `google`; later `passkey`), the provider's id for the person (GitHub's numeric user id, never the login, which can be renamed), the GitHub login, and the email the provider gives with whether the provider has verified it.

A sign-in finds its member (`worker/media/accounts.js`):

1. A sign-in seen before belongs to its member.
2. Adding a sign-in while signed in (`link`) joins the signed-in member, unless the sign-in already belongs to another account (409).
3. A sign-in whose provider vouches for an email that exactly one member already has verified joins that member. Every verified address counts (GitHub lists all of a person's addresses; `@users.noreply.github.com` ones are skipped). Two members with that email: neither is guessed; a new member is made.
4. Otherwise a new member is made.

Only verified emails join members: an unverified address could be anyone's. Signing in with GitHub and Google with the same verified address is one person; with different addresses, the second is added from the first while signed in.

GitHub gives the addresses only when the GitHub App has the Email addresses permission ([setup.md](setup.md#github-app-zaideih-sign-in-suggestions)); without it, or with a fine-grained token without that permission, a GitHub sign-in never joins by email.

## Your account

`#/account` (`src/ui/account-view.js`), linked from the sidebar and the logo menu as "Sign in", or the person's name once signed in:

- Signed out: Continue with Google first (most listeners have a Google account and have never heard of GitHub), then Continue with GitHub, for catalog editors. Inside another app's browser (Facebook, Messenger, Instagram, LINE, WeChat, Android web views) Google refuses to sign in, so the page says to open the site in Chrome or Safari first.
- Signed in: the name, every sign-in with its email, Add Google or Add GitHub for the one not there yet, Remove (never the last sign-in, nor the owner's GitHub), Your uploads, and Sign out on this device, which ends the Zaideih session and revokes the GitHub sign-in.

Both sign-ins return to this page, which finishes them and takes the code out of the address at once. A GitHub sign-in made here also signs in the admin page, so editors get the Admin link.

## Sign in with Google

OpenID Connect with PKCE, finished by the Worker (`worker/media/google.js`), which holds the client secret, like the GitHub sign-in:

1. `GET /auth/google/login?return&nonce&challenge` sends the browser to Google (scopes `openid email profile`, choosing the account every time).
2. Google returns to `/auth/google/callback`; the Worker returns to `<page>#/account?google=<code>&nonce=<n>` (or `google-error`).
3. The page posts the code and its verifier to `POST /auth/google/token` (with `{"link": "<session>"}` for Add Google) and gets a Zaideih session.

Google's tokens are read once and never kept or given to the page. The ID token comes straight from Google's token endpoint over TLS, which OpenID Connect Core 3.1.3.7 accepts in place of checking its signature; its issuer, audience and expiry are still checked. Only Google's id for the person (`sub`), the name, and the email with Google's word on whether it is verified are used. Setup: [setup.md](setup.md#google-sign-in).

## Sessions

After a sign-in the Worker gives a session token (`zs_` and 43 base64url characters), kept on the device (`localStorage`, `zaideih.account`, `src/core/account.js`). Only its SHA-256 hash is stored (`member_sessions`). It lasts 90 days after its last use (renewed at most daily); signing out deletes it, and a block applies to it at once. The personal library routes accept nothing else, and no longer ask GitHub on every request.

| Route | Does |
|---|---|
| `POST /auth/session` with `Authorization: Bearer <GitHub token>`, body `{}` or `{"link": "<session>"}` | Checks the token with GitHub (`GET /user`, `GET /user/emails`), finds or makes the member, answers `{token, expires_at, member: {id, name}, joined, email}`; `joined` is `known`, `link`, `email` or `new` |
| `POST /auth/session/end` with `Authorization: Bearer <session>` | Signs that session out |
| `POST /auth/google/token` `{code, verifier, link?}` | A Google sign-in for a session, answered like `/auth/session` |
| `POST /auth/me` with the session | `{member, logins: [{provider, subject, login, email, emailVerified, added, used}]}` |
| `POST /auth/logins/remove` `{provider, subject}` with the session | Removes one of the member's sign-ins; never the last one, nor the owner's GitHub (409) |

The app keeps the session with where it came from (`via`): `google`, or `github:<login>`. A GitHub-based one is got from the device's GitHub sign-in (or fine-grained token) the first time it is needed, and got again when another GitHub login signs in or the Worker refuses it; a Google one lasts until signing out or until the Worker refuses it.

## The owner

The owner is the member signed in with the GitHub account `OWNER_GITHUB_ID` (`wrangler.toml`; 1753766, the repository owner's id from `GET /repos/khensolomon/zaideih`). A login is not enough: it could be renamed and then taken by someone else.

## Members from before accounts

Until accounts, members were GitHub accounts keyed by GitHub's id. Migration `worker/media/migrations/0001-accounts.sql` turned each into a member with the same id (so R2 `users/<id>/…` did not move) and its GitHub sign-in, renaming `members.github_id` to `id`, `members.login` to `name`, and `github_id` to `member_id` in `member_rights` and `member_folders`. New members are numbered after the highest id.

Migrations are for changes `CREATE … IF NOT EXISTS` cannot make, such as renames. `tools/d1.mjs schema` runs the pending ones, each as one import recorded in `schema_migrations`, before the schema; a database made from the schema records them as run. The release (`audio`) runs it before deploying the Worker, so for the minute between the two the Worker still running reads the old column names and the library routes answer 500.

## Privacy

Emails are stored only as the provider gives them, to recognise the same person. They are shown to nobody in the app.
