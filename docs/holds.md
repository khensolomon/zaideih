# Album holds

Status: built in v26.10.25.13.

The catalog ships with each release. A hold takes an album out of listeners' reach at once, and gives it back, without a release. Nothing is deleted: the album, its songs, their files in R2 and their data in `assets/data` stay as they are. A change meant to last can later go into the catalog in a normal release.

## The two switches

Set per album in the Workspace (the album editor, Availability), with a reason. They apply to the live app, not to the draft.

| Switch | Off |
|---|---|
| Streaming | The album stays listed, greyed out ("Not available right now"); Play, Shuffle and Download are disabled, and its songs do not play, downloads on the device included. |
| Shown to the public | The album is left out of the app for listeners: its page, its songs, search, Most played, language, genre and artist pages; an artist left with no song is left out too. Its songs do not play. |

An album with both on has no hold. The Workspace reads the catalog's source from GitHub, so a hidden album is still found and edited there; its result rows say "streaming off" or "hidden from the public".

## Who

The owner and co-owners, and members given the **Albums** right (`albums`) by the owner or a co-owner in the Workspace, Members, like any right; it can go to anyone who signs in, for example someone who already reviews publishing. Every change keeps who made it, when and why (`album_hold_log`).

## How it reaches listeners

- The audio Worker refuses a held song itself (`403`, `X-Zaideih-Reason: held`), so a hold holds for shared links, older app versions and any other way of asking for the song. Each isolate reads the held songs again every minute (`heldTracks`, `HELD_TTL_MS`).
- The app reads `GET /holds` when it starts (its last copy at once, kept in `localStorage`, `zaideih.holds`, for offline use too) and every 5 minutes while it is shown, and applies it to its catalog (`src/core/holds.js`, `applyHolds` in `src/core/catalog.js`): a hidden album is left out by building the catalog again from the release's data, keeping uploads and counted plays; a streaming-off album is marked (`album.off`), which the lists and the player follow.
- So a change reaches listeners within a few minutes: `GET /holds` is cached at most a minute, and an open app reads it again every 5.

Limits: a song a device has downloaded cannot be taken back from a device that stays offline; once online, the app learns the hold and stops playing it. A browser that had already cached part of a song may replay that part.

## Worker

| Route | Who | |
|---|---|---|
| `GET /holds` | anyone (CORS `*`, cached 60 s) | `{ at, albums: { <album id>: { streaming, listed } } }`, no reasons or names |
| `GET /holds/detail` | Albums right | every hold with its reason, who and when, and the latest 100 changes |
| `POST /holds/:album {streaming, listed, reason, tracks}` | Albums right | sets the album's hold; `tracks` are the album's songs (each must be in D1 `tracks`); a reason is needed to hold back, not to give back |

Tables (`migrations/0006-album-holds.sql`): `album_holds` (one row per held album), `album_hold_tracks` (the songs the Worker refuses), `album_hold_log` (every change). They cannot be rebuilt from git, so `tools/d1.mjs reset` keeps them (`LIBRARY_TABLES`).

## Releasing

Holds need the Worker and the app: `release: web+audio` (the schema step adds the tables, and the site waits for the Worker).
