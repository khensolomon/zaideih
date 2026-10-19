# Version

## v26.10.19.2

- One theme with light and dark surfaces, and a System / Light / Dark switch (top bar on phones, sidebar on wide screens)
- Player deck redesigned: dark-toned in both themes and tinted by the playing album's language, with live frequency bars that follow the actual audio and a play button that glows with its loudness
- Volume and mute controls, remembered per device
- Liked songs show a filled rose heart; unliked songs a grey outline
- Phones: navigation moved to a top bar so the player owns the bottom of the screen
- Audio is requested with CORS so it can be analysed; requires the audio Worker from v26.10.19.1 to be deployed
- Fix: unliked buttons reported an empty `aria-pressed` instead of `false`

## v26.10.19.1

Replace the Django application with a static HTML5 app. Versions now follow `vyy.mm.dd.changes`.

- Shared app (`src/`) for web (PWA) and desktop (Electron, `platforms/desktop`)
- Offline: catalog and app shell cached; songs downloadable for offline play
- Library: likes, playlists, history and queue stored on the device, with JSON backup and restore
- Search across scripts, including artist alternative spellings
- Catalog compiler with full validation (`tools/catalog.mjs`)
- Track audio paths in `assets/data/media.json`, loaded into the audio Worker's D1 table by `tools/media.mjs`
- Audio Worker: Django sync endpoints removed; CORS for allowed origins so songs can be downloaded
- Local development: `npm run dev` (live reload) and `npm run preview` (production build)
- Removed: Django, MySQL, Docker and nginx configuration, Vue/Vite frontend

## 1.3.[4,5]

- Update dependencies
  
## 1.3.3

- environment before `run` & `serve`

## 1.2.0

Package

- @google-cloud/storage: 5.8.1
- pug: 3.0.2

## 1.1.0

Improve

- track to file
- middleware

Add

- artist -> title

## 1.0.9

Improve

- visibility (track>meta>artist)

## 1.0.8

Improve

- Streaming
- GTA

Add

- PWA, m3s

Change

- Duration to numeric

Update

- framework, Package

## 1.0

Feature

- album
- artist
- queue
