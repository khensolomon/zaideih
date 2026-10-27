# Live catalog changes

Status: built in v26.10.27.4.

The catalog ships with each release, from git (`assets/data`), through a pull request and its checks. A correction to the catalog's own data (a title, a year, an artist's name) can also go live at once, without a release, and into git later with the next one. The ordinary way (draft, pull request, release) stays as it is; this is a step before it.

## What can go live

The Workspace's own fields:

| Record | Fields |
|---|---|
| Album | title, year, language, genres |
| Song | title, artists, hidden (hiding only) |
| Artist | name, other name, type, spellings |

Anything else needs a release, as before: a new album or song, showing a hidden song again (it is not shipped), merging artists, changing files or paths, and a record the released catalog does not have yet. The Workspace keeps such changes in the draft and says why.

## Who

The owner and co-owners, and members given the **Catalog** right (`catalog`) by the owner or a co-owner in the Workspace, Members, like any right. Editors who reach the Workspace through GitHub alone publish pull requests, as before.

## In the Workspace

- **Apply now, without a release** (the Draft, beside Publish): the draft's changes that can go live are sent to the audio Worker and leave the draft; the others stay, each said why. Listeners see them within about five minutes.
- **Live, not yet in a release** (the Draft): every live change, who made it and when, with **Undo** (the field is as released again). The editors show the live value.
- **Release the live changes**: puts them into the draft, against the newest source on GitHub, to publish as one pull request in the ordinary way. They stay live until that release is out.
- When the Workspace opens, a live change the released catalog now carries is taken away by itself ("released"), and so is one a release has overtaken by setting the field otherwise ("overtaken", said in a notice). The Workspace runs in the app, whose catalog is the released one, so this happens only once the release is out.

## How it reaches listeners

A live change is the draft's change (`{ kind, id, field, value }`, `src/workspace/draft.js`) with two more parts: `base`, the value in the released catalog it was made against, and `refs`, what that catalog may lack to show it (an artist with no song yet, a language or genre no album used: the compiled catalog ships only what is used).

The app reads `GET /live` when it starts (its last copy at once, kept in `localStorage`, `zaideih.live`, for offline use too) and every 5 minutes while it is shown, and builds its catalog again from the release's data with the changes on it (`patchRaw` in `src/core/live-catalog.js`, `applyLive` in `src/core/catalog.js`), keeping uploads, holds, counted plays and trimmed lengths.

A change applies only while the released catalog still has its `base`:

- **applied**: the catalog has `base`; the change shows;
- **done**: the catalog has the value already (a release carried it): nothing to do;
- **stale**: the catalog has something else (a later release set the field otherwise) or the record is gone: the release wins.

So a live change never undoes a release, an app of any version shows the same, and a release that carries the change makes no difference to listeners.

Limits: an app that has never been online since a change shows the released value until it is; a device that stays offline keeps the last changes it read.

## Worker (`worker/media/live.js`)

| Route | Who | |
|---|---|---|
| `GET /live` | anyone (CORS `*`, cached 60 s at the edge) | `{ at, changes: [{ kind, id, field, value, base, refs }] }`, no names |
| `GET /live/detail` | Catalog right | the changes with who and when, and the latest 100 log entries |
| `POST /live {changes}` | Catalog right | made live; each replaces the one for its field. Checked as the draft checks it (`cleanValue`), its base another value of the same field; hidden only as true; up to 500 a call, 5,000 in all |
| `POST /live/remove {changes: [{kind, id, field}], why}` | Catalog right | taken away; `why` is `undo`, `released` or `overtaken`, kept in the log |

Tables (`migrations/0011-catalog-live.sql`): `catalog_live` (one row per kind, record and field) and `catalog_live_log` (every change). They cannot be rebuilt from git, so `tools/d1.mjs reset` keeps them (`LIBRARY_TABLES`).

## Releasing

Live changes need the Worker and the app: `release: web+audio` (the schema step adds the tables, and the site waits for the Worker).
