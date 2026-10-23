# Personal libraries

Anyone signed in with GitHub can keep their own music on Zaideih: uploaded to the audio Worker, stored in R2, playable only by them. The public catalog is unchanged: it stays in git (`assets/data`), reviewed and released. Everything personal lives in the Worker's D1 database and R2 bucket and never enters the public repository.

Status: agreed 2026-10-22 and 2026-10-23. Built: roles, uploads, Your uploads in Library, signed streaming, moderation (v26.10.22.8); rights per member and adding files from storage (this release). Still to come: asking for an upload to be published, and share links.

## Roles and rights

| Role | Who | May |
|------|-----|-----|
| Owner | The owner of the GitHub repository (`GITHUB_REPO`, so `khensolomon`) | Everything, always: every right below, giving and taking any right from anyone, overriding any decision. The owner's library is the owner's alone; nobody else can list or play it, block the owner or change the owner's rights |
| Member | Anyone signed in with GitHub | Their own library: upload, add from storage (with the right), play, edit, delete; suggest catalog edits |
| Listener | Not signed in | The public app |

The owner trusts members with rights, one by one, on the admin page (Members); each is a row in D1 `member_rights` with who gave it and when:

| Right | Allows |
|---|---|
| Co-owner (`manage`) | Everything below, and gives or takes any right from any member but the owner |
| Review publishing (`review`) | Approves or rejects requests to publish (to come), and listens to the songs under review |
| Moderate members (`moderate`) | Blocks and unblocks members, deletes uploads (never the owner's) |
| Storage (`storage`) | Adds files already in R2, from `private/<their github id>/` only |

A member who holds any right can be blocked only by the owner or a co-owner. `members.moderator = 1`, from before rights existed, counts as Moderate members until that right is taken. Catalog editing on the admin page is separate: it follows the repository permission (admin, editor), see [architecture.md](architecture.md#admin-page).

Roles come from GitHub on every request the Worker serves (`worker/media/members.js`): the sign-in token is checked with GitHub (`GET /user`, `GET /repos/{repo}` for the permission), cached per isolate for five minutes by a hash of the token. Rights and blocks are Zaideih's own and live in D1.

## Data

D1 (`worker/media/schema.sql`):

- `members`: one row per GitHub account that has used the library: GitHub id (the key; logins can change), login, block (time, by whom, reason), first and last seen.
- `member_rights`: the rights the owner has given, one row per member and right.
- `uploads`: one row per uploaded file: id, owner's GitHub id, R2 key, size, format, length, title, artist, album, year, track number, status (`uploading`, `private`; later `requested`, `published`, `rejected`) and when it was added.

R2:

- `music/…`: the catalog.
- `users/<github id>/<upload id>.<ext>`: uploads.
- `private/…`: files put in R2 by hand (rclone, wrangler, the dashboard) to be added from storage; `private/<github id>/` for members with the Storage right.

Upload ids are their own sequence, not catalog track ids; a published upload gets a catalog track id then.

`tools/d1.mjs reset` refuses while `members`, `uploads` or `member_rights` hold rows: they cannot be rebuilt from git, and uploaded files would be left in R2 without an owner. `--drop-library` overrides it.

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

## Adding from storage

Music bought elsewhere, too large to upload or already on hand can be put in R2 directly and added without passing through the browser:

```bash
# one folder per album, under private/ (the owner and co-owners) or private/<github id>/ (Storage right)
npx wrangler r2 object put "media/private/google/Album/01 Song.mp3" --file "01 Song.mp3" --remote
# or a whole folder with rclone (an R2 remote configured with an R2 API token)
rclone copy ./Album "r2:media/private/google/Album"
```

Your uploads, Add from storage (`GET /library/storage?prefix=…`) lists the folders and audio files of a folder, each file with a signed address (`/k/<key>?e&s`, six hours) through which the app reads its length and tags, as for an upload. "Add" (`POST /library/storage/add`) checks every file first (inside the person's folder, present, a supported format, a length, not already in a library) and then adds all of them or none. Nothing is copied: the library row names the file where it is, so it uses no space allowance and has no size limit. Taking it out of the library leaves the file in R2. Nothing outside `private/` can be listed or read this way.

## Listening

`GET /library` answers the member's uploads with a signed address for each: `/u/<id>?e=<expiry>&s=<signature>`, an HMAC-SHA256 of the id and expiry with the Worker secret `AUDIO_SIGNING_KEY`, valid for six hours. Audio elements cannot send a sign-in, so the address itself is the permission. `/u/<id>` streams from R2 with ranges like `/audio/<id>`, never cached publicly, and refuses an expired or wrong signature, an unknown upload and an upload whose owner is blocked. Uploads are never counted as plays.

The app lists them in Library as Your uploads, grouped by album, and plays them in the normal player; their addresses are renewed whenever the list is read.

## Moderation

Spam is expected. Anyone holding a right sees every member (login, rights, space used, uploads, last seen) on the admin page, Members. With Moderate members:

- block a member, with a reason: their uploads stop playing at once, and every library request answers 403 with the reason; unblocking restores everything;
- delete any upload (the R2 object and the row; a file added from storage stays in R2).

The owner and co-owners also give and take rights there.

Deleting is permanent. Blocking is the reversible step.

## Limits and cost

- File size: 95 MB (`UPLOAD_MAX_BYTES`), below the 100 MB request body limit of Workers on the Free and Pro plans.
- Space: 2 GB per member (`UPLOAD_QUOTA_BYTES`); the owner has no limit.
- Rate: `UPLOAD_LIMIT`, 30 uploads a minute per member.
- R2 storage costs about $0.015 per GB a month after 10 GB free; streaming (egress) is free. At 2 GB each, 50 members store 100 GB, about $1.35 a month.
- CPU: the Worker streams uploads to R2 without reading them and checks only their first bytes, which stays within the Free plan's 10 ms per request.

## To come

- Ask to publish (agreed 2026-10-23): a member asks for a whole album, MP3 or M4A only, with its language and a note on the rights. Review publishing listens and approves or rejects with a reason; approving fills the album form from the upload, copies the files to `music/<language>/<album>/`, and opens the usual pull request (released as `web+d1`). After the release the member's private copies are removed; the member stays credited, with "Suggest a correction" and "Ask to remove" on their published songs, both reviewed. The owner can do or undo any of it.
- Share links: chosen songs, a note and an expiry ("never" allowed), revocable, with a record of when they were opened; for showing pending recordings to rights holders without making them public.
