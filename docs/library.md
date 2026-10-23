# Personal libraries

Anyone signed in with GitHub can keep their own music on Zaideih: uploaded to the audio Worker, stored in R2, playable only by them. The public catalog is unchanged: it stays in git (`assets/data`), reviewed and released. Everything personal lives in the Worker's D1 database and R2 bucket and never enters the public repository.

Status: the design below is agreed (2026-10-22). Built (v26.10.22.8): roles, uploads, Your uploads in Library, signed streaming and moderation (block, delete, moderator rights). Still to come: adding albums from R2 folders, asking for an upload to be published, and share links.

## Roles

| Role | Who | May |
|------|-----|-----|
| Owner | The owner of the GitHub repository (`GITHUB_REPO`, so `khensolomon`) | Everything. The owner's private music is the owner's alone; no other role can list or play it. Grants and removes moderator rights. Publishes uploads |
| Moderator | Members the owner has granted the right (`members.moderator`) | Block and unblock members, delete any upload |
| Admin, editor | Repository permission (admin or maintain, write) | Edit the catalog (see the admin page). Moderation only when granted |
| Member | Anyone signed in with GitHub | Upload to their own library, play, edit and delete it; suggest catalog edits |
| Listener | Not signed in | The public app |

Roles come from GitHub on every request the Worker serves (`worker/media/members.js`): the sign-in token is checked with GitHub (`GET /user`, `GET /repos/{repo}` for the permission), cached per isolate for five minutes by a hash of the token. Blocking and moderator rights are Zaideih's own and live in D1.

## Data

D1 (`worker/media/schema.sql`):

- `members`: one row per GitHub account that has used the library: GitHub id (the key; logins can change), login, moderator flag, block (time, by whom, reason), bytes stored, first and last seen.
- `uploads`: one row per uploaded file: id, owner's GitHub id, R2 key, size, format, length, title, artist, album, year, track number, status (`uploading`, `private`; later `requested`, `published`, `rejected`) and when it was added.

R2: `users/<github id>/<upload id>.<ext>`, beside the catalog's `music/…`. Upload ids are their own sequence, not catalog track ids; a published upload gets a catalog track id then.

`tools/d1.mjs reset` refuses while `members` or `uploads` hold rows: they cannot be rebuilt from git, and their files would be left in R2 without an owner. `--drop-library` overrides it.

## Uploading

1. The app reads each chosen file in the browser: format, length (from the audio element) and the tags (ID3 for MP3; title, artist, album, year, track) to fill the form. Nothing is sent yet.
2. Files are refused in the browser before any byte is sent, each with its reason:
   - format other than MP3, M4A (AAC), FLAC, WAV or Ogg;
   - larger than `UPLOAD_MAX_BYTES` (95 MB: a Worker request body may be at most 100 MB on the Free and Pro plans). A WAV of an old recording is usually far larger; the message says so and suggests MP3 or FLAC;
   - beyond the member's remaining space (`UPLOAD_QUOTA_BYTES`, 2 GB; the owner has no limit);
   - no readable length (not audio, or damaged).
3. `POST /library/uploads` with the metadata. The Worker checks the same limits again (the browser's checks are a courtesy, the Worker's are the rule), the block, and creates the row as `uploading`.
4. `PUT /library/uploads/<id>/file` with the file. The Worker requires the declared size, streams the body to R2, then reads the first bytes back and checks the file really is the format declared (MP3 frame or ID3, `ftyp`, `fLaC`, `RIFF…WAVE`, `OggS`). A mismatch deletes the object and the row and answers why. On success the row becomes `private` and the bytes count towards the member's space.

An upload left `uploading` for an hour (a closed tab) is removed the next time its owner lists the library.

## Listening

`GET /library` answers the member's uploads with a signed address for each: `/u/<id>?e=<expiry>&s=<signature>`, an HMAC-SHA256 of the id and expiry with the Worker secret `AUDIO_SIGNING_KEY`, valid for six hours. Audio elements cannot send a sign-in, so the address itself is the permission. `/u/<id>` streams from R2 with ranges like `/audio/<id>`, never cached publicly, and refuses an expired or wrong signature, an unknown upload and an upload whose owner is blocked. Uploads are never counted as plays.

The app lists them in Library as Your uploads, grouped by album, and plays them in the normal player; their addresses are renewed whenever the list is read.

## Moderation

Spam is expected. The owner and moderators see every member (login, space used, uploads, last seen) on the admin page and can:

- block a member, with a reason: their uploads stop playing at once, and every library request answers 403 with the reason; unblocking restores everything;
- delete any upload (the R2 object and the row);
- (owner only) grant or remove moderator rights.

Deleting is permanent. Blocking is the reversible step.

## Limits and cost

- File size: 95 MB (`UPLOAD_MAX_BYTES`), below the 100 MB request body limit of Workers on the Free and Pro plans.
- Space: 2 GB per member (`UPLOAD_QUOTA_BYTES`); the owner has no limit.
- Rate: `UPLOAD_LIMIT`, 30 uploads a minute per member.
- R2 storage costs about $0.015 per GB a month after 10 GB free; streaming (egress) is free. At 2 GB each, 50 members store 100 GB, about $1.35 a month.
- CPU: the Worker streams uploads to R2 without reading them and checks only their first bytes, which stays within the Free plan's 10 ms per request.

## To come

- Add from R2: an editor picks a folder already in R2 (`music/…`) that no catalog track uses, fills the album form from the files' tags, and publishes it to the catalog (a pull request adding `albums.json` and `media.json` entries) or keeps it private.
- Ask to publish: a member asks for an album to go public; the owner approves (the files move to `music/<language>/<album>/`, the songs get catalog ids, the usual pull request opens) or a moderator rejects it with a reason.
- Share links: chosen songs, a note and an expiry ("never" allowed), revocable, with a record of when they were opened; for showing pending recordings to rights holders without making them public.
