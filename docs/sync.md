# Liked songs and playlists on every device

Signed in, a person's liked songs and playlists are the same on every device where they sign in. Play history and downloads stay on the device. Listening without an account is unchanged: the library lives only on the device.

Status: agreed 2026-10-22; built in v26.10.24.13.

## How it works

The device stays the first copy. Every change is made in IndexedDB as before, and also put in an outbox (`kv` `sync.state`), which is sent to the audio Worker while signed in and online:

- soon after a change (1.5 s, so several taps go together);
- when the app starts, and on signing in;
- when the connection returns, and when the app comes back into view;
- every 5 minutes while the app is open and in view.

Each request sends up to 25 changes and brings back everything changed on other devices since its last request. More than 25 waiting are sent in turn.

| Part | File |
|---|---|
| Outbox, sending, first sync | `src/core/sync.js` |
| Changes from the library, writing what came back | `src/core/library.js` (`onChange`, `snapshot`, `applyRemote`) |
| Wiring (when to sync) | `src/app.js` (`startSync`) |
| Server | `worker/media/sync.js` |

## Who wins

| Change | Rule |
|---|---|
| Like or unlike | The most recent wins, by the device's clock (`at`). |
| Playlist, made online | Applies when the device had seen the server's latest version (`base`). If another device changed the playlist since, the server's copy wins and comes back to the device. |
| Playlist, made offline (or not sent the first time) | The most recent wins. |
| Playlist deleted | Kept on the server as a mark (no songs), so every device removes it. |

A song or playlist with a change still waiting on the device keeps the device's change when other devices' changes come back; the waiting change is sent next.

The first time an account syncs on a device, everything the device has is sent, marked offline, so what was on the device joins the account (the most recent wins where both have the same playlist). Signing out keeps the device's library and stops syncing; the next account to sign in starts afresh.

Playlists carry `uid` (16 hex characters, the same on every device) and `version` (the server's; 0 before the first sync). Playlists made before this release are given a `uid` when the app starts.

## Server

`POST /library/sync {since, changes}` with the session, answers `{since, likes, playlists}`: the changes applied, then every row changed since `since`, and the server's copy of every song and playlist the request named (a change that lost left its row as it was, and the device needs that copy).

| Change | Fields |
|---|---|
| `like` | `track` (catalog id, or `u<id>` for an upload), `liked`, `at` |
| `playlist` | `uid`, `name` (1 to 200 characters), `tracks` (up to 5000), `deleted`, `at`, `base`, `offline` |

D1 tables:

| Table | Holds |
|---|---|
| `library_likes` | `(member_id, track)`: `liked`, `at`, `seq` |
| `library_playlists` | `(member_id, uid)`: `name`, `tracks` (JSON), `deleted`, `at`, `version`, `seq` |
| `library_sync` | each member's counter, `seq` |

Each request's writes are one D1 batch, a transaction: the member's counter goes up by one and every row written takes the new value, so "changed since" never misses a row another device wrote at the same moment. 25 changes per request keeps the batch small (a batch counts as one of the Free plan's 50 queries a request, whatever its size); the app sends more in turn. Joining two accounts ([accounts.md](accounts.md#sign-ins)) moves the library too: likes the kept member has stay; the counter goes up so every device fetches the joined library.

`/library/sync` is answered right after the session is checked (and the member is not blocked), before the rest of `/library/*`, to spend no more queries than it needs.
