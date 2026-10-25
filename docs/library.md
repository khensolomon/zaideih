# Personal libraries

Anyone signed in can keep their own music on Zaideih: uploaded to the audio Worker, stored in R2, playable only by them. The public catalog is unchanged: it stays in git (`assets/data`), reviewed and released. Everything personal lives in the Worker's D1 database and R2 bucket and never enters the public repository.

Status: agreed 2026-10-22 and 2026-10-23. Built: roles, uploads, Uploads in Library, signed streaming, moderation (v26.10.22.8); rights per member and adding files from storage (v26.10.23.4); asking to publish (v26.10.23.5). Still to come: asking to remove a published song, and share links.

## Roles and rights

| Role | Who | May |
|------|-----|-----|
| Owner | The member signed in with the repository owner's GitHub account (`OWNER_GITHUB_ID`, [accounts.md](accounts.md#the-owner)) | Everything, always: every right below, giving and taking any right from anyone, overriding any decision. The owner's library is the owner's alone; nobody else can list or play it, block the owner or change the owner's rights |
| Member | Anyone signed in ([accounts.md](accounts.md)) | Their own library: upload, add from storage (with the right), play, edit, delete; suggest catalog edits |
| Listener | Not signed in | The public app |

The owner trusts members with rights, one by one, in the Workspace (Members); each is a row in D1 `member_rights` with who gave it and when:

| Right | Allows |
|---|---|
| Co-owner (`manage`) | Everything below, and gives or takes any right from any member but the owner |
| Review publishing (`review`) | Listens to albums asked to be published, approves (copying them into the catalog) or rejects them with a reason |
| Moderate members (`moderate`) | Blocks and unblocks members, deletes uploads (never the owner's) |
| Storage (`storage`) | Adds files already in R2, from one folder the owner or a co-owner sets for them (`private/<their member id>/` until one is set) |
| Albums (`albums`) | Holds albums back from listeners without a release, and gives them back: streaming off, or hidden from the public ([holds.md](holds.md)) |
| Lyrics (`lyrics`) | Sees every version of a song's lyrics, hides and shows them, restores an earlier version; links songs that are the same, merges and unlinks them, compares copies and declines proposals ([lyrics.md](lyrics.md)) |

A member who holds any right can be blocked only by the owner or a co-owner. `members.moderator = 1`, from before rights existed, counts as Moderate members until that right is taken. Catalog editing in the Workspace is separate: it follows the repository permission (admin, editor), see [architecture.md](architecture.md#workspace).

Library requests carry a Zaideih session ([accounts.md](accounts.md#sessions)), checked in D1 on every request (`worker/media/members.js`). Rights and blocks are Zaideih's own and live in D1.

## Data

D1 (`worker/media/schema.sql`):

- `members`: one row per person ([accounts.md](accounts.md)): id, name (the GitHub login, or the name another sign-in gives), block (time, by whom, reason), first and last seen. `member_logins` and `member_sessions` hold their sign-ins and sessions.
- `member_rights`: the rights the owner has given, one row per member and right.
- `member_folders`: the storage folder set for a member with the Storage right.
- `uploads`: one row per uploaded file: id, owner's member id, R2 key, size, format, length, title, artist, album, year, track number, status (`uploading`, `private`, `requested` while asked to be published, `published` once approved, `released` once in the catalog) and when it was added.
- `publish_requests`: one row per album asked to be published: the member, the album name, language, note, status (`open`, `withdrawn`, `rejected`, `approved`, `released`), who decided, the reason, the catalog album id and the pull request.
- `published_tracks`: for each approved song, its upload, request, catalog track id and catalog file (`music/…`).

R2:

- `music/…`: the catalog.
- `users/<member id>/<upload id>.<ext>`: uploads.
- Anything else: files put in R2 some other way (rclone, wrangler, the dashboard), wherever their owner keeps them, which can be added from storage. They are never moved, renamed or deleted by Zaideih.

Upload ids are their own sequence, not catalog track ids; a published upload gets a catalog track id then (`published_tracks`).

`tools/d1.mjs reset` refuses while any table that cannot be rebuilt from git holds rows (`LIBRARY_TABLES` in `tools/lib/d1.mjs`: accounts, libraries, synced likes and playlists, lyrics); uploaded files would also be left in R2 without an owner. `--drop-library` overrides it.

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

Music already in R2 (bought elsewhere, too large to upload, kept the way its owner organised it) is added where it is, without being moved or copied:

- The owner and co-owners browse the whole bucket, except `users/` (members' uploads, theirs alone).
- A member with the Storage right browses one folder: the one the owner or a co-owner set for them in the Workspace (Members, Storage folder), or `private/<member id>/` until one is set. A member's folder can be anywhere except `users/`, but never the whole bucket.

Uploads, Add from storage (`GET /library/storage?prefix=…`) opens where the last visit on that device left off, or any folder typed in. It lists a folder's folders and audio files, each file with a signed address (`/k/<key>?e&s`, six hours) through which the app reads its length and tags, as for an upload. "Add" (`POST /library/storage/add`) checks every file first (inside the person's storage, present, a supported format, a length, not already in a library) and then adds all of them or none. The library row names the file where it is, so it uses no space allowance and has no size limit, and taking it out of the library leaves the file in R2.

Uploads are the only files a library owns (`users/…`): only they count towards space and are deleted with their entry. Files go into R2 with rclone, `npx wrangler r2 object put "media/<folder>/<file>" --file <file> --remote` or the Cloudflare dashboard.

## Asking to publish

A member can ask for an album of their uploads to join the public catalog. The catalog stays in git and is changed only by a reviewed, released pull request; publishing is that, prepared from the member's files.

1. **Ask** (the album's page in the app, Ask to publish): the whole album, with its language, a note for the reviewer (who made it, why it may be shared) and a statement that they may share it. Only MP3 can be published, since the catalog streams MP3 (`media.json`, `/audio`); an album with other formats is refused naming the files, to be uploaded again as MP3. While asked, its songs cannot be edited or deleted; the member can withdraw the request.
2. **Review** (Workspace, Requests, with Review publishing): every song can be listened to. **Reject** needs a reason, which the member sees on the album; the songs are theirs alone again. **Approve** opens a form filled from the uploads: title, year, language, genres, each song's title and artists (names matched to the catalog's artists; a new name is added as a new artist).
3. **Approved**: everything is checked first (a free folder `music/<language>/<album>/`, new track ids, no file overwritten), then the Worker copies each song there (`POST /library/requests/<id>/approve`), all or nothing. The Workspace then opens the pull request with `albums.json`, `media.json`, `artist.name.json` when artists were added, and the next version, titled `release: web+d1 <version> Published <album>`: merging it, in the Workspace (Merge and release) or on GitHub, releases the site and loads the track paths. A reviewer without write access sends it as a suggestion instead, which an editor merges and releases. If the pull request could not be opened, Open the pull request tries again with the same album id, track ids and files.
4. **Released**: once D1 `tracks` holds every song of the request, the next library read settles it: the member's uploaded copies (`users/…`) are deleted and their library entries point at the catalog's files, so they play as before and no longer use the member's space. A song added from storage keeps its file. The album page says "In the catalog, published by you" with a link to the catalog album.

The member stays credited: published songs stay in their library and cannot be deleted from it by them (the owner and co-owners can); corrections go through Suggest in the Workspace like any catalog edit.

The owner, co-owners and reviewers do not ask anyone: on their own album the page has a **Public in the catalog** switch. Turning it on asks and opens the approval form at once (`#/workspace?review=<id>`); turning it off while still waiting withdraws.

## Listening

`GET /library` answers the member's uploads with a signed address for each: `/u/<id>?e=<expiry>&s=<signature>`, an HMAC-SHA256 of the id and expiry with the Worker secret `AUDIO_SIGNING_KEY`, valid for six hours. Audio elements cannot send a sign-in, so the address itself is the permission. `/u/<id>` streams from R2 with ranges like `/audio/<id>`, never cached publicly, and refuses an expired or wrong signature, an unknown upload and an upload whose owner is blocked. Uploads are never counted as plays.

The app lists them in Library as Uploads, grouped by album, and plays them in the normal player; their addresses are renewed whenever the list is read.

## Moderation

Spam is expected. Anyone holding a right sees every member (login, rights, space used, uploads, last seen) in the Workspace, Members. With Moderate members:

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

- Ask to remove: a member asks for a song they published to leave the catalog, reviewed like asking to publish. Until then the owner removes it with a catalog edit.
- M4A (AAC) for publishing: needs the catalog's player and `media.json` to accept it; MP3 only for now.
- Share links: chosen songs, a note and an expiry ("never" allowed), revocable, with a record of when they were opened; for showing pending recordings to rights holders without making them public.
