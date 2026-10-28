# Personal libraries

Anyone signed in can keep their own music on Zaideih: uploaded to the audio Worker, stored in R2, playable only by them. The public catalog is unchanged: it stays in git (`assets/data`), reviewed and released. Everything personal lives in the Worker's D1 database and R2 bucket and never enters the public repository.

Status: agreed 2026-10-22 and 2026-10-23. Built: roles, uploads, Uploads in Library, signed streaming, moderation (v26.10.22.8); rights per member and adding files from storage (v26.10.23.4); asking to publish (v26.10.23.5); publishing in place (v26.10.27.2); sharing with members (v26.10.27.3). Still to come: asking to remove a published song, and share links for people who are not members.

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
| Songbooks (`songbooks`) | Makes songbooks, their hymn numbers and texts, people and works, and looks after their texts' versions; texts of private books are seen only with it ([songbooks.md](songbooks.md)) |
| Albums (`albums`) | Holds albums back from listeners without a release, and gives them back: streaming off, or hidden from the public ([holds.md](holds.md)) |
| Catalog (`catalog`) | Applies catalog edits live, without a release, and releases them later ([live-catalog.md](live-catalog.md)) |
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
- `library_shares` (migration 0010): one row per share: whose music, one album of it (by its name) or all of it, the member it is shared with (none while its invite is unused), listen only, the invite code's SHA-256 while unused, when it was made and taken.

R2:

- `music/…`: the catalog, except albums published in place (below), whose files stay where they were in storage.
- `users/<member id>/<upload id>.<ext>`: uploads.
- Anything else: files put in R2 some other way (rclone, wrangler, the dashboard), wherever their owner keeps them, which can be added from storage. They are never moved, renamed or deleted by Zaideih. Once such a file is published in place it is a catalog song's own file, and must not be moved or renamed with rclone either: the storage browser marks it "in the catalog".

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
3. **Approved**: everything is checked first (a free folder `music/<language>/<album>/`, new track ids, no file overwritten), then the Worker copies each song there (`POST /library/requests/<id>/approve`), all or nothing. Songs added from storage, all in one folder, are not copied: they are published in place (below). The Workspace then opens the pull request with `albums.json`, `media.json`, `artist.name.json` when artists were added, and the next version, titled `release: web+d1 <version> Published <album>`: merging it, in the Workspace (Merge and release) or on GitHub, releases the site and loads the track paths. A reviewer without write access sends it as a suggestion instead, which an editor merges and releases. If the pull request could not be opened, Open the pull request tries again with the same album id, track ids and files.
4. **Released**: once D1 `tracks` holds every song of the request, the next library read settles it: the member's uploaded copies (`users/…`) are deleted and their library entries point at the catalog's files, so they play as before and no longer use the member's space. A song added from storage keeps its file. The album page says "In the catalog, published by you" with a link to the catalog album.

The member stays credited: published songs stay in their library and cannot be deleted from it by them (the owner and co-owners can); corrections go through Suggest in the Workspace like any catalog edit.

The owner, co-owners and reviewers do not ask anyone: on their own album the page has a **Public in the catalog** switch. Turning it on asks and opens the approval form at once (`#/workspace?review=<id>`); turning it off while still waiting withdraws.

## Publishing in place

An album whose songs were all added from storage, in one folder, is published where its files are: nothing is copied, and the catalog names that folder. Uploads (`users/…`) are always copied under `music/`, and the uploaded copy is deleted once released, as above. So are albums whose songs are in several folders, or in a folder that cannot be named (the top of the bucket, `music/`, `users/`, `edits/`) or that a catalog album already uses; the approval form says which, and why.

- **media.json**: an album's folder starting with `/` is in place, from the bucket's top: `["…", "/Google Music/Album A", [[31001, "01 One.mp3"]]]` is `Google Music/Album A/01 One.mp3`. Any other folder is under `music/` as before. `src/core/media-keys.js` (`trackKey`, `folderProblem`) is the one rule the Worker, the tools and the Workspace share; D1 `tracks.folder_path` holds the folder as written.
- **The approval form** (Workspace, Requests) says "The songs stay where they are in storage, <folder>/" or why they are copied. The request's songs carry `storageKey`, their place in storage; approving in place sends each song's own key and the Worker checks it is that song's file, present, not an upload, and not already another catalog song's.
- **Afterwards** the file is a catalog song's: removing the song from a library, or the album from the catalog, never deletes it, and it must stay where it is. The storage browser lists it as "in the catalog".
- **The folder names are public**: media.json is in the public repository, so a folder published in place (`private/42/…` included) can be read there. Listeners never see it: the app plays `/audio/<id>`.

Albums published as copies before this existed keep both files: the release step pointed their library entries at the `music/` copy, so where the originals were is not recorded. `tools/inplace.mjs` points such an album back at its originals, named by hand, and then deletes the copies:

1. `node tools/inplace.mjs point --album <id> --folder "<folder in R2>"` lists each song's key before and after (the same file names); `--apply` writes media.json and keeps the plan in `build/inplace/<id>.json`.
2. Release the change (`web+d1`), which loads the new places into D1.
3. A day later, `node tools/inplace.mjs prune --album <id>` checks that D1 holds every new place, that it was loaded 25 hours ago or more (the audio Worker keeps a song's place for up to a day), and that every song plays; `--apply` deletes the `music/` copies.

## Listening

`GET /library` answers the member's uploads with a signed address for each: `/u/<id>?e=<expiry>&s=<signature>`, an HMAC-SHA256 of the id and expiry with the Worker secret `AUDIO_SIGNING_KEY`, valid for six hours. Audio elements cannot send a sign-in, so the address itself is the permission. `/u/<id>` streams from R2 with ranges like `/audio/<id>`, never cached publicly, and refuses an expired or wrong signature, an unknown upload and an upload whose owner is blocked. Uploads are never counted as plays.

The app lists them in Library as Uploads, grouped by album, and plays them in the normal player; their addresses are renewed whenever the list is read.

## Sharing

A member shares music of their own library with another member: one album (its page, **Share**), or all of it, songs added later too (Uploads, **Share all**). The member it is shared with finds it in Library, Uploads, under **Shared with you** (by who shared it), on its album page ("Shared with you by …") and in search with **Private** on (the lock: one's own music and music shared with one). They listen to it like their own, but cannot change it, share it on or ask to publish it; **Leave** gives it back (an album that came with all of someone's music leaves all of it, after asking).

**Who it is shared with.** Members are not listed for one another, so anyone shares by an **invite link** (`#/join/<code>`, `worker/media/shares.js`): made on the share page and shown only then, kept by the Worker only as its SHA-256, used once (by the first member who opens it signed in; whoever is not signed in signs in first, and the invite opens again by itself), and removed after 14 days unused. A member has at most 20 unused invites and 200 shares. The owner and co-owners can also find a member by name and share at once.

**Taking it back works at once.** A shared song plays through an address that names its listener (`/u/<id>?e&m=<member>&s`, signed with the member); every request checks that the share still exists, that neither member is blocked, and the address cannot be used by another member or turned into the owner's. Such answers are never kept by the browser (`no-store`), so a song taken back stops at its next request rather than playing from a copy. An invite taken by two people at once goes to the first; the second is told it is used. The share page lists who has it and the unused invites, each with **Listen only** and **Take back** (or **Cancel the invite**). An album renamed in the owner's library (its last song with the old name) keeps its shares.

**Listen only** hides downloading in the app for that share (the album's Download, a song's menu and the player's button) and removes copies already downloaded; it is the app's rule, not a lock: the stream is the same, since the player reads it with CORS. Downloads of songs no longer shared, or made listen only, are removed when the library is read again.

| Route (under `/library`) | Who | What |
|---|---|---|
| `POST /shares {album \| null, listenOnly?, member?}` | any member; `member` for the owner and co-owners | an invite (`{share, code}`, the code shown once), or shared with that member at once |
| `PATCH /shares/<id> {listenOnly}` | who shared it | |
| `DELETE /shares/<id>` | who shared it (take back), or who it is shared with (leave) | |
| `GET /shares/invite/<code>` | signed in | who shares what, how many songs, listen only, and whether it is one's own invite |
| `POST /shares/invite/<code>` | signed in | take it (already shared with them: the invite is spent, nothing else changes) |
| `GET /shares/members?q=` | the owner and co-owners | members by name, to share with |

`GET /library` also answers `shared` (the songs shared with the member, each once, with its owner and listen only when every share covering it is), `shares` (what the member shares) and `received` (the shares made with them).

## Moderation

Spam is expected. The Workspace's Members is where members are looked after (`src/workspace/workspace.js`, `worker/media/members-admin.js`).

**The list.** Anyone holding a right sees members a page of 50 at a time, from the audio Worker: found by name, @login or #id (and, for the owner and co-owners only, by a sign-in's email), filtered (All, With rights, Uploading, New in the last 30 days, Blocked, each with its count) and sorted (last seen, joined, space used, name). Each row shows the photo the sign-in gives, the name, the @login, the uploads, when they were last seen and a tag (Owner, Co-owner, a right, Blocked).

**A member's page** (also `#/workspace?member=<id>`): how they sign in, when they joined and were last seen, and tiles for uploads (published among them), space against the quota, their library (liked songs, playlists, shares), contributions (lyrics versions, requests to publish, songbooks) and the devices they are signed in on. Its tabs:

- Overview: the rights, each with who gave it and when (the owner and co-owners change them; others see them), the storage folder for a member with Storage, the latest history, and Sign out everywhere.
- Library (Moderate members; never the owner's): the uploads, newest first, found by title, artist, album or file name, a page of 50 at a time, chosen one by one or all shown, and deleted together after a confirmation. A song waiting for review is never deleted; a published one only by the owner and co-owners, and its catalog entry stays. Uploads have no address here and cannot be played.
- Sign-ins: each way to sign in (GitHub, Google), with its name, the email for the owner and co-owners, when it was added and last used; passkeys; the devices signed in. No session token, device name or address is kept or shown.
- History: what was done to the member (rights given and taken, the storage folder set, blocks, sign-outs, deleted uploads: `member_log`, with who and when) and what they did (joining, sign-ins and passkeys added, requests to publish and their decisions, lyrics versions), newest first.

With Moderate members:

- block a member, with a reason they see: their uploads stop playing at once, and every library request answers 403 with the reason; unblocking restores everything;
- sign a member out everywhere: every session of theirs ends at once and each device signs in again;
- delete uploads (the R2 object and the row; a file added from storage stays in R2), one at a time or several together.

A member who holds a right is blocked and signed out only by the owner or a co-owner; nobody blocks, signs out or changes the owner, or sees the owner's library.

Deleting is permanent. Blocking is the reversible step.

| Route | Who | What |
|---|---|---|
| `GET /library/members?q&filter&sort&offset&limit` | any right | a page of members (50, at most 100): `{ members, total, counts, offset, limit }` |
| `GET /library/members/<id>` | any right | a member's page: `{ member, rights, logins, passkeys, sessions, library, uploads, contributions, history }` (emails for the owner and co-owners; no library for the owner) |
| `GET /library/members/<id>/uploads?q&offset&limit` | Moderate members | their uploads, a page at a time, without addresses |
| `POST /library/members/<id>` | Moderate members: `{blocked, reason}`, `{signOut: true}`; the owner and co-owners: `{rights}`, `{folder}` | the change, logged; answers the member as the list shows them |
| `POST /library/members/<id>/uploads/delete {ids}` | Moderate members | up to 100 at once: `{ deleted, refused: [{ id, error }] }`, logged as one entry |

`member_log` (`migrations/0012-member-log.sql`) cannot be rebuilt from git, so `tools/d1.mjs reset` keeps it (`LIBRARY_TABLES`). A list is four D1 queries and a member's page about twenty, within the Free plan's queries per request.

## Limits and cost

- File size: 95 MB (`UPLOAD_MAX_BYTES`), below the 100 MB request body limit of Workers on the Free and Pro plans.
- Space: 2 GB per member (`UPLOAD_QUOTA_BYTES`); the owner has no limit.
- Rate: `UPLOAD_LIMIT`, 30 uploads a minute per member.
- R2 storage costs about $0.015 per GB a month after 10 GB free; streaming (egress) is free. At 2 GB each, 50 members store 100 GB, about $1.35 a month.
- CPU: the Worker streams uploads to R2 without reading them and checks only their first bytes, which stays within the Free plan's 10 ms per request.

## To come

- Ask to remove: a member asks for a song they published to leave the catalog, reviewed like asking to publish. Until then the owner removes it with a catalog edit.
- M4A (AAC) for publishing: needs the catalog's player and `media.json` to accept it; MP3 only for now.
- Share links for people who are not members: chosen songs, a note and an expiry ("never" allowed), revocable, with a record of when they were opened; for showing pending recordings to rights holders without making them public. Sharing with members is built (above).
