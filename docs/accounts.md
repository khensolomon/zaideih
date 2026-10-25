# Accounts

A Zaideih account is one person, however they sign in. Personal libraries, rights, blocks, synced likes and playlists, and lyrics belong to the account, not to a GitHub account. GitHub stays what catalog editing runs on: the Workspace edits the catalog with the person's GitHub sign-in, and GitHub decides what it may do.

Status: agreed 2026-10-24. Built: accounts, GitHub as their first sign-in, Zaideih sessions (v26.10.24.1); Google sign-in and Your account (v26.10.24.2); passkeys (v26.10.24.12); likes and playlists synced across devices (v26.10.24.13); lyrics (v26.10.24.14).

## Sign-ins

D1 `member_logins` holds one row per way a member signs in: the provider (`github`, `google`, `passkey`), the provider's id for the person (GitHub's numeric user id, never the login, which can be renamed), the GitHub login, the email the provider gives with whether the provider has verified it, and the person's name and photo (`full_name`, `picture`) when the provider gives them.

A sign-in finds its member (`worker/media/accounts.js`):

1. A sign-in seen before belongs to its member.
2. Adding a sign-in while signed in (`link`) joins the signed-in member. When that sign-in already belongs to another member, the two members become one: completing both sign-ins shows one person holds both. The older member stays (its id, so its R2 files keep their place) and takes the other's sign-ins, sessions, passkeys, uploads, publish requests, rights, storage folder, liked songs and playlists ([sync.md](sync.md)), lyrics versions, reports, proposals, links and timing ([lyrics.md](lyrics.md)), in one D1 batch; refused while either is blocked.
3. A sign-in whose provider vouches for an email that exactly one member already has verified joins that member. Every verified address counts (GitHub lists all of a person's addresses; `@users.noreply.github.com` ones are skipped). Two members with that email: neither is guessed; a new member is made.
4. Otherwise a new member is made.

Only verified emails join members: an unverified address could be anyone's. Signing in with GitHub and Google with the same verified address is one person; with different addresses, the second is added from the first while signed in. A GitHub sign-in's emails are read only when it is exchanged for a session, so a device still holding a session from before the Email addresses permission has none recorded; a Google sign-in then makes a second account, which Add GitHub (or Add Google) joins to the first.

GitHub gives the addresses only when the GitHub App has the Email addresses permission ([setup.md](setup.md#github-app-zaideih-sign-in-suggestions)); without it, or with a fine-grained token without that permission, a GitHub sign-in never joins by email.

## Account

The page (`#/account`) shows the person's own name and photo as their sign-ins give them: GitHub's profile name and avatar, Google's name and picture (`member_logins.full_name`, `member_logins.picture`, migration 0003), from the sign-in used last that has them; passkeys give neither. Only the photo's address at Google or GitHub is kept (https, those hosts only: `safePicture`), never a copy. Moderators keep seeing the member's name (a GitHub username, or the name given at the first sign-in).

`#/account` (`src/ui/account-view.js`), linked from the sidebar and the logo menu as "Sign in", or the person's name once signed in:

- Signed out: Continue with Google first (most listeners have a Google account and have never heard of GitHub), then Continue with GitHub, for catalog editors. Inside another app's browser (Facebook, Messenger, Instagram, LINE, WeChat, Android web views) Google refuses to sign in, so the page says to open the site in Chrome or Safari first.
- Signed in: the name, every sign-in with its email, Add Google or Add GitHub for the one not there yet, Remove (never the last sign-in, nor the owner's GitHub), Uploads, and Sign out on this device, which ends the Zaideih session and revokes the GitHub sign-in.

Both sign-ins return to this page, which finishes them and takes the code out of the address at once. A GitHub sign-in made here also signs in the Workspace, so editors get the Admin link.

## From an app on the home screen

An app added to the home screen cannot leave its own site: Google's and GitHub's sign-in open in a browser sheet over it, and when the sign-in returns to zaideih.com it does so inside that sheet, which starts a second copy of the app without the first one's verifier. The app itself never hears of it.

So in such an app (`display-mode: standalone`, or `navigator.standalone` on iOS):

1. The sign-in buttons are links prepared when the page opens (the verifier and nonce are kept, the address built), so a tap opens the sheet at once, with no script in between for the browser to block.
2. The sign-in starts with `wait=1`. Its callback does not return to the app: it keeps the code (or the error) in D1 `signin_waiting` under a SHA-256 hash of the nonce, for 10 minutes, and shows "Signed in. Close this window and go back to Zaideih".
3. The app asks `POST /auth/wait {nonce}` every 2 seconds, and at once when it is shown again; the Worker answers the code once (`{code}`, `{error}`, or 204 while waiting). The app then finishes as usual, with its verifier.

The code alone signs nobody in: it needs the PKCE verifier, which never leaves the app. The Workspace's GitHub sign-in works the same way from the home screen.

## Sign in with Google

OpenID Connect with PKCE, finished by the Worker (`worker/media/google.js`), which holds the client secret, like the GitHub sign-in:

1. `GET /auth/google/login?return&nonce&challenge` sends the browser to Google (scopes `openid email profile`, choosing the account every time).
2. Google returns to `/auth/google/callback`; the Worker returns to `<page>#/account?google=<code>&nonce=<n>` (or `google-error`).
3. The page posts the code and its verifier to `POST /auth/google/token` (with `{"link": "<session>"}` for Add Google) and gets a Zaideih session.

Google's tokens are read once and never kept or given to the page. The ID token comes straight from Google's token endpoint over TLS, which OpenID Connect Core 3.1.3.7 accepts in place of checking its signature; its issuer, audience and expiry are still checked. Only Google's id for the person (`sub`), the name, and the email with Google's word on whether it is verified are used. Setup: [setup.md](setup.md#google-sign-in).

## Passkeys

A passkey signs in with the device's own lock: face, fingerprint or the device's code. It is added on Account while signed in ("Add a passkey on this device") and then signs in to that account alone ("Sign in with a passkey"), with no name or email typed; the device's password manager (iCloud Keychain, Google Password Manager) can carry it to the person's other devices.

WebAuthn, checked by the Worker (`worker/media/passkeys.js`), with no library: a small CBOR decoder reads the authenticator's data and its COSE key, and WebCrypto checks ES256 (P-256) or RS256 signatures.

| Route (POST, under `/auth`) | Does |
|---|---|
| `passkey/options` `{kind: "create"}` with the session, or `{kind: "get"}` | A one-time challenge (5 minutes, D1 `passkey_challenges`) and what the browser needs |
| `passkey/register` `{id, clientDataJSON, attestationObject}` with the session | Checks and keeps the new passkey (D1 `passkeys`, and a `member_logins` row, provider `passkey`); answers the sign-ins |
| `passkey/signin` `{id, clientDataJSON, authenticatorData, signature}` | Checks the signature with the kept public key; answers a session |

Checked every time: the challenge is this Worker's, of that kind, unused and recent; the browser reports the page's own origin, which is in `AUTH_ORIGINS`; the relying party is the page's site (`zaideih.com` for it and its subdomains, the host itself otherwise, so `localhost` in development), and the authenticator data is for it; the person was present and verified with the device's lock; signing in, the signature is the kept key's, and the signature counter went up (devices that keep none send 0). Attestation is not asked for: which device made a passkey is not Zaideih's concern. The user handle given to the device is the member's id, not their name or email.

Safari lets a page ask for a passkey only in direct answer to a tap, so the page fetches the challenge when it opens (and again after each use), and the tap goes straight to the device's prompt (`src/core/passkey.js`).

Removing a passkey on Your account deletes its key; joining two accounts moves their passkeys with them. Nothing of the person's face, fingerprint or code ever reaches Zaideih: the device keeps the private key and only answers with signatures.

## Sessions

After a sign-in the Worker gives a session token (`zs_` and 43 base64url characters), kept on the device (`localStorage`, `zaideih.account`, `src/core/account.js`). Only its SHA-256 hash is stored (`member_sessions`). It lasts 90 days after its last use (renewed at most daily); signing out deletes it, and a block applies to it at once. The personal library routes accept nothing else, and no longer ask GitHub on every request.

| Route | Does |
|---|---|
| `POST /auth/session` with `Authorization: Bearer <GitHub token>`, body `{}` or `{"link": "<session>"}` | Checks the token with GitHub (`GET /user`, `GET /user/emails`), finds or makes the member, answers `{token, expires_at, member: {id, name}, joined, email}`; `joined` is `known`, `link`, `email` or `new` |
| `POST /auth/session/end` with `Authorization: Bearer <session>` | Signs that session out |
| `POST /auth/wait` `{nonce}` | The code of a sign-in started with `wait=1`, once; 204 while it has not come back |
| `POST /auth/google/token` `{code, verifier, link?}` | A Google sign-in for a session, answered like `/auth/session` |
| `POST /auth/me` with the session | `{member: {id, name, fullName, picture}, logins: [{provider, subject, login, email, emailVerified, added, used, fullName, picture}]}`; the member's name and photo are from the most recently used sign-in that gives them (passkeys give neither) |
| `POST /auth/logins/remove` `{provider, subject}` with the session | Removes one of the member's sign-ins; never the last one, nor the owner's GitHub (409) |

The app keeps the session with where it came from (`via`): `google`, or `github:<login>`. A GitHub-based one is got from the device's GitHub sign-in (or fine-grained token) the first time it is needed, and got again when another GitHub login signs in or the Worker refuses it; a Google one lasts until signing out or until the Worker refuses it.

## The owner

The owner is the member signed in with the GitHub account `OWNER_GITHUB_ID` (`wrangler.toml`; 1753766, the repository owner's id from `GET /repos/khensolomon/zaideih`). A login is not enough: it could be renamed and then taken by someone else.

## Members from before accounts

Until accounts, members were GitHub accounts keyed by GitHub's id. Migration `worker/media/migrations/0001-accounts.sql` turned each into a member with the same id (so R2 `users/<id>/…` did not move) and its GitHub sign-in, renaming `members.github_id` to `id`, `members.login` to `name`, and `github_id` to `member_id` in `member_rights` and `member_folders`. New members are numbered after the highest id.

Migrations are for changes `CREATE … IF NOT EXISTS` cannot make, such as renames. `tools/d1.mjs schema` runs the pending ones, each as one import recorded in `schema_migrations`, before the schema; a database made from the schema records them as run. The release (`audio`) runs it before deploying the Worker, so for the minute between the two the Worker still running reads the old column names and the library routes answer 500.

## Privacy

Emails are stored only as the provider gives them, to recognise the same person. They are shown to nobody in the app. The privacy policy for people using Zaideih is `src/privacy.html`, served at `/privacy` as a page of its own (readable without script, as Google's sign-in review requires); the service worker serves it offline too. Deleting an account on request (the policy promises 30 days) is a manual step for now: the member's rows in `members`, `member_logins`, `member_sessions`, `passkeys`, `member_rights`, `member_folders`, `uploads`, `publish_requests`, `published_tracks`, `library_likes` and `library_playlists` (and `library_sync`), their member id in the lyrics tables (`lyrics`, `lyrics_versions`, `lyrics_reports`, `lyrics_proposals`, `lyrics_links`, `lyrics_times`), and `users/<id>/` in R2: every table in `LIBRARY_TABLES` (`tools/lib/d1.mjs`), plus `library_sync`.
