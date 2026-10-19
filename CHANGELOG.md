# Version

## v26.10.19.5

- One theme: logo grey `#5a5a5a` with white text; the light/dark modes and the theme switch are gone
- Madder red stays the only colour, as a deep red fill under white text, pale rose for text and light red for icons
- Album tiles: clearer info (main artist, year, song count, downloaded mark) and a play button over the cover on hover
- Album page: artists on their own line (expandable), then year, genre, length, plays and download progress
- Search: squared box, suggestions while typing (artists, albums, songs), recent searches, and "Did you mean" for typos

## v26.10.19.4

- Logo: the Zaideih mark replaces the text name in the app, and the app icons and favicon are regenerated from it
- Light mode neutrals start at the logo grey `#5a5a5a`; dark mode uses the matching greys. Red stays the only colour
- Phones: iOS-style navigation bar, with the logo or "Back" on the left and Search and Library on the right; the theme moves to Library > Appearance
- Home: most played artists, one tab per language
- Player: pausing freezes the animation in place; hovering a progress bar shows the time under the pointer
- Player deck: inset highlight removed; one soft shadow when floating (phones), a hairline when docked (desktop)
- Desktop app uses the new icon

## v26.10.19.3

- One brand colour for the whole app: madder red (hue 352), after the red of Zo and Chin woven cloth. Surfaces, text, the accent, the player deck, covers and the visualizer all derive from `--brand-h`; light and dark differ only in lightness, and every text pairing meets WCAG AA
- Languages are distinguished by tone of the brand colour instead of separate hues
- Docs: `docs/worker-audio.md`, the audio Worker deployment guide

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
