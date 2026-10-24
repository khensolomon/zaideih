# Lyrics

Lyrics of catalog songs, added and corrected by listeners who sign in, read by everyone.

Status: agreed 2026-10-22; built in v26.10.24.14.

## Rules

- Anyone signed in (and not blocked) adds or edits the lyrics of a catalog song. They appear for everyone at once.
- Every version is kept, with who saved it and when. A bad edit is undone by restoring an earlier version, which becomes the newest; nothing is lost.
- The Lyrics right (given on the admin page, Members; the owner and co-owners hold it too) sees every version, hides lyrics with a reason, shows them again, and restores an earlier version. Hidden lyrics are not shown to listeners; members cannot edit them, and are told the reason.
- Saving starts from the version the editor opened. When someone else saved first, the save is refused (409): the editor keeps their text and is shown the newer lyrics, and saving again replaces them knowingly.
- Uploads (members' own songs) have no lyrics for now.

Text is kept as typed, tidied: NFC, `\n` line ends, no spaces at line ends, no blank lines at either end, at most one blank line in a row. At most 20,000 characters.

## App

| Part | File |
|---|---|
| Page `#/lyrics/<song id>`: reading, editing, the Lyrics right's versions | `src/ui/lyrics-view.js` |
| Reading (kept on the device for offline), saving, the Lyrics right | `src/core/lyrics.js` |
| Entry points: the Lyrics button in Now playing, and Lyrics in a song's menu | `src/app.js` |

Lyrics once read are kept on the device (IndexedDB `kv`, `lyrics.<song id>`), so they show offline. Online, the Worker is asked each time; its edge cache answers without touching D1.

## Worker

`worker/media/lyrics.js`:

| Route | Who | Does |
|---|---|---|
| `GET /lyrics/:song` | anyone | `{track, version, text, updated}`, or 404 when there are none (or they are hidden). Kept in the edge cache (`caches.default`) until the next change; browsers keep it 5 minutes |
| `POST /lyrics/:song {text, base}` | signed in | Saves the next version when `base` is the latest (0 for new lyrics); otherwise 409 `{error, current}`. The same text again saves nothing |
| `GET /lyrics/:song/versions` | Lyrics right | `{version, hidden, versions: [{version, text, at, note, by: {id, name}}]}` |
| `POST /lyrics/:song/hide {reason}` | Lyrics right | Hides them; the reason (1 to 300 characters) is shown to whoever tries to edit them |
| `POST /lyrics/:song/show` | Lyrics right | Shows them again |
| `POST /lyrics/:song/restore {version, base}` | Lyrics right | That version's text becomes the newest version (note "restored version N") |

D1:

| Table | Holds |
|---|---|
| `lyrics` | per song: the shown `version` and `text`, `updated_at`, `updated_by` (member id), and `hidden_at`, `hidden_by`, `hidden_reason` |
| `lyrics_versions` | every version: `(track, version)`, `text`, `member_id`, `at`, `note` |

A save is one D1 batch (the version row and the shown lyrics), each written only when the latest version is still `base`. Every change removes the song from the edge cache. Joining two accounts moves their versions to the kept member.

## Backups

The lyrics cannot be rebuilt from git: `tools/d1.mjs reset` keeps them like the other personal tables, and

    node tools/d1.mjs lyrics            # counts, and where the file would go
    node tools/d1.mjs lyrics --apply    # writes build/d1/lyrics-<date>.json (or --out <file>)

writes what is shown and every version (format `zaideih-lyrics/1`), with member ids only, no names or emails.
