# Version

## v26.10.20.7

- Usage statistics with Google Analytics 4 (G-65TTKMZEGC), only after the listener allows it on a first-visit card; changeable on the About page; described in Terms
- Page views on every route change without the query (no search text), and a play_track event per song started (track, album, language)
- Production web builds only: dev and desktop builds carry no analytics; ZAIDEIH_GA_ID overrides or disables it; the CSP adds Google's hosts only when it is built in

## v26.10.20.6

- GitHub workflows: check on every push; release pushes test, build and deploy the site, the audio Worker or D1 paths to Cloudflare, then tag and publish a GitHub release (docs/releasing.md)
- The site deploys as Workers static assets (wrangler.jsonc), at workers.dev until the zaideih.com routes are enabled
- tools/release-plan.mjs checks a release line before anything runs; tools/version.mjs --note writes the CHANGELOG.md section
- index.html carries the release in its application-name meta, read back after a deploy

## v26.10.20.5

- A stream that fails is retried once with a one-off query that bypasses the browser's saved copy. A copy saved from an older server answer (without the CORS header the player needs) is refused by the browser; the retry plays the song without an error. Chrome kept such copies of songs played before the Worker change; Firefox did not
- Help page (`#/help`): why a song may not play, how to check (private window or another browser), clearing only cached files per browser so likes and downloads stay, and reporting a code. Linked from errors, the sidebar and Library
- Error for media code 4 now reads "This song could not be played. If other songs play, see Help."; diagnostic codes record whether the cache-bypassing retry ran, and the explanation tells a refused saved copy from a damaged file

## v26.10.20.4

- Playback failures carry a diagnostic code ("Code ZE-…", with Copy) under the error. The app probes the failure first: the HTTP status, the Worker's lookup source and 404 reason, and the file's first bytes (MP3, MP4/M4A, WMA, HTML and others), from the stream or the downloaded copy
- `tools/diagnose.mjs`: decodes a code into the likely cause, the track, its R2 key with code points and a look-alike Myanmar mark order, and the D1 (`hex(folder_path)`) and R2 commands to check it; `track <id> --probe` works without a code. Unlinked page `#/code/<code>` decodes in the app
- Audio Worker: `X-Zaideih-Meta` (lookup from memory, edge cache or D1) and `X-Zaideih-Reason` (`no-track` or `no-object` on 404), exposed to allowed origins; `META_CACHE_VERSION` drops every cached lookup when changed. Needs a redeploy
- A failed play no longer reports twice (the play() rejection and the media error)

## v26.10.20.3

- Search answers questions: "most played Mizo artists", "gospel albums from the 90s", "newest albums by Lianbawi", "top songs 1987", "who is the most played artist". The answer leads the suggestions with its top results, and the results page lists it in full (songs with Play all)
- Scope buttons (All, Artists, Albums, Songs) in the suggestions panel and on the results page; the scope is kept in the address (`in=`). In the Albums and Songs scopes, records by a matching artist follow the title matches
- Typing an artist's name offers "Albums by …" and "Most played songs by …"
- Search panel: one edge colour for box and list, a softer edge, no border animation (the box and the list now change in the same frame), and a lighter blur behind

## v26.10.20.2

- Player: a vertical gradient, a brighter edge, a shadow on all sides and a blurred, faded view of the page behind it, so it reads as a separate layer
- About page: "Zaideih Music Station", free listening, nothing sold and no financial benefit, catalog figures, version and catalog id; a Terms page covers listening, ownership, downloads, data, availability and rights holders. The version is shown there only; the sidebar and Library link to both pages
- Search suggestions: up to 3 artists, 3 albums and 5 songs. When little matches exactly, close spellings follow under "Close matches" (whole names, names typed part way, and word by word)
- "Did you mean" falls back to the closest artist, album or song, and also appears when a search finds only a few results; a search with no exact matches lists the close matches
- The search box and its suggestions form one panel with no outline ring on focus, and the page behind is dimmed and blurred while the suggestions are open

## v26.10.20.1

- Graphite theme: the page stays logo grey `#5a5a5a`; sidebar, cards, player and covers are steps of the same grey. Madder red is replaced by the logo's silver `#ececec` as the accent (play button, progress, liked heart, playing song), with dark text on it
- Font: Outfit replaces Bricolage Grotesque; Padauk stays for Myanmar
- Album covers are generated from catalog data: grey shade from the album id, a pattern from the genre (rings for gospel and worship, weave for tribal and folk, grooves otherwise), language code, year, title, and a strip with one bar per song sized by its length; the playing song is lit
- Artist pictures are generated from the artist's career: one ray per year (length = songs, brightness = plays), a centre sized by total plays, rings for the album count, and ray ends by artist type. Latin names show initials; Myanmar names leave the centre clear
- Artist page: the picture, languages, active years, songs, albums, plays and the most played year
- Player: a floating card on every screen size; 8px seek bars with a larger thumb and the loaded part shown; a thicker progress line on phones
- Now playing: larger cover and controls; the live bars sit on the progress bar, lit over the played part
- Lock screen and media keys show the generated cover instead of the app icon
- Home: most played artists first; languages move to "Browse by language"
- Search: the top artist matches show as pictures, the rest as name chips
- Keyboard: Left and Right seek 5 seconds; Shift+Left and Shift+Right go to the previous and next song

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
