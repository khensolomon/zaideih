# Version

## v26.10.24.31

- Lyrics: part names clearly smaller and dimmer

## v26.10.24.30

- Getting around while listening: player More, sleep timer, share
- Lyrics: Play as an icon that shows whether the song is playing
- Shared lyrics: similar titles offered, and finding the song by title, artist or a line of the words

## v26.10.24.28

- Lyrics: play this song

## v26.10.24.27

- Shared lyrics across recordings

## v26.10.24.26

- Playing bars, player More, quieter part names

## v26.10.24.25

- merging artists name (catalog, 6 changes)

## v26.10.24.24

- the "+" (catalog, 1 change)

## v26.10.24.23

- Published Myanmar Zomi Artists (15 songs, from @khensolomon's library)

## v26.10.24.22

- "အလင်းသက်သေ": year (catalog, 1 change)

## v26.10.24.21

- Admin: a studio page

## v26.10.24.20

- Account: your name and photo from your sign-ins

## v26.10.24.19

- Lyrics: translations, search by lyrics, lyrics in Now playing

## v26.10.24.18

- Lyrics studio: write, preview, time and review lyrics

## v26.10.24.17

- Lyrics: Zolai hymnbook (Tang, Sakkik), the chorus after every verse

## v26.10.24.16

- Lyrics: sections, chords with transpose, timed lyrics

## v26.10.24.15

- Search on phones: the field stays sharp and in place with the keyboard up

## v26.10.24.14

- Lyrics: add, edit and read song lyrics; every version kept; the Lyrics right hides, shows and restores

## v26.10.24.13

- Sync liked songs and playlists

## v26.10.24.12

- Passkeys: add one on Your account, then sign in with the device's face, fingerprint or code

## v26.10.24.11

- Home on phones scrolls freely again, and settles on a section's title only after a scroll has come to rest near it

## v26.10.24.10

- Installed app: leaving for the privacy page and coming back starts again (the database connection is closed on leaving, and no storage request can wait for ever); Sign in's title moves into the bar like Library's; Home settles on a section's title when a scroll ends near it

## v26.10.24.9

- Home screen app on iOS 26: the player sits on the bottom edge again on short pages and with the menu open; a stuck start can update itself and offers a reload

## v26.10.24.8

- Installed app: no endless loading screen (Safari's storage nudged and given a time limit, a slow network no longer holds up the start), menu links close onto the new page, and a hidden viewport readout (#/viewport) for device-only layout faults

## v26.10.24.7

- Installed app: the privacy page opens (no stored redirect), the sign-in page appears at its full size at once, and the menus have no scroll bar

## v26.10.24.6

- Signing in from the app on the home screen: the sign-in opens in its own sheet and the app finishes it, instead of a second copy of the app hanging on the loading screen; Add Google and Add GitHub add to the account again

## v26.10.24.5

- Adding a sign-in that already has its own account joins the two accounts into one

## v26.10.24.4

- Privacy policy: a Google user data section (access, use, sharing, protection, retention and deletion); the home page says what Google sign-in uses

## v26.10.24.3

- Google sign-in review: a privacy policy page of its own (/privacy), and the home page describing Zaideih before the app starts; the Google client id

## v26.10.24.2

- Sign in with Google, and Your account: see and add your sign-ins, sign out; Google and GitHub with the same verified email are one account

## v26.10.24.1

- Accounts: members become Zaideih accounts with GitHub as their first sign-in, joined by verified email; Zaideih's own sign-in sessions for personal libraries; database migrations

## v26.10.23.6

- Published Miaow (10 songs, from @khensolomon's library)

## v26.10.23.5

- Ask to publish: members ask for an album of their uploads to join the catalog; reviewers listen, approve (songs copied into the catalog, a release pull request opened) or reject with a reason; the owner publishes their own with one switch

## v26.10.23.4

- Add from storage works wherever music is kept in R2: the whole bucket (but members' uploads) for the owner and co-owners, a folder the owner sets for members with the Storage right; any folder can be typed, and the last one is remembered

## v26.10.23.3

- Rights per member, given and taken by the owner and co-owners: co-owner, review publishing, moderate members, storage
- Your uploads: add music already in storage (R2, private/) without uploading it, and add a whole folder from a computer

## v26.10.23.2

- Phones: the top controls no longer slide down when a page is pulled past its bottom

## v26.10.23.1

- Phones: the top controls stay put when the page is pulled past its ends and while the keyboard is open; round buttons stay round beside long titles; lighter shadows and a frosted band under the status bar
- Phones: the menu closes on any of its links and holds the page still and blurred behind it; no scroll bar on touch screens and installed apps; 17 px text; no selecting or long-pressing controls and list items; no double-tap zoom
- A loading screen instead of a blank page while the app starts
- Library: Liked songs first, then playlists, then Downloads, Recently played and Your uploads, then the backup; each section has its own page
- Docs: docs/setup.md (accounts, credentials and settings); the audio Worker, releasing and architecture docs brought up to date

## v26.10.22.8

- Rounder covers, centred album and artist headers on phones, select arrows, current language in the sidebar
- Admin: a header with the person's photo, name, level and what they have had released, plain text tabs; Edit or Suggest an edit on album, artist and song menus for people signed in
- Personal libraries: anyone signed in with GitHub uploads music of their own (Library, Uploads), played only by them through signed addresses; oversized or unsupported files are refused before sending, with the reason; moderators block accounts and delete uploads (admin page, Members)

## v26.10.22.7

- Sign in with GitHub on the admin page
- Levels (admin, editor, contributor, guest, viewer): editors publish and release, everyone else signed in sends suggestions that editors review; every page links to the admin page by level
- Admin header: the search sits in it, with smaller corners

## v26.10.22.6

- Admin: floating header, centred sign-in and catalog checks; collapsible sidebar

## v26.10.22.5

- artist "Sangpur": type Unknown → Female (catalog, 1 change)

## v26.10.22.4

- Admin page: publishing failed with "Reference update failed" because a branch named admin exists; edits now go on catalog-edit-… branches, and the error explains a name clash.

## v26.10.22.3

- Admin page (hidden, #/admin): edit album, song and artist details and hide songs through GitHub, as a pull request that releases on "Merge and release"; counted plays at a glance. The catalog build leaves hidden songs out.

## v26.10.22.2

- Play counts come back into the app: the audio Worker serves the totals (GET /plays, cached 5 minutes), which are added to the catalog's counts, so Most played, top artists and popularity in the artwork follow real listening; the last totals are kept for offline use. D1: the schema is one file (worker/media/schema.sql, no migrations), and tools/d1.mjs shows, applies, loads or fully resets the database with one command.

## v26.10.22.1

- Phones: installed on iOS the app runs under a transparent status bar with a soft fade and blur, Now playing included; the browser's top colour follows Now playing. Search suggestions are as wide as the whole search bar, the scope buttons fit, and the list ends above the keyboard.

## v26.10.21.10

- Skip silence: no more kick at the start of songs. The sound stays muted until the step back to the music has happened, then fades in; between songs it is silent until the next song starts at its own volume.

## v26.10.21.9

- Equaliser: ten bands from 31 Hz to 16 kHz, 12 dB up or down, with presets (Bass boost, Clear voice, Old tape, Warm, Bright, Loudness, Small speakers, Choir and hall) and automatic headroom so boosts never distort. The Sound panel has two tabs, Clean up and Equaliser.

## v26.10.21.8

- Sound for old recordings, live while listening (computers and Android): skip silent tape at the start and end (passed at 8x, remembered per song), clean up (Light: air blowing, rumble and hiss; Strong: deeper hiss reduction), even out volume between recordings, play one-sided recordings in both ears, and bass, voice and treble. A Sound panel in Now playing shows the settings and what they did.

## v26.10.21.7

- Album covers show who sings and how loved an album is: a record for solo albums (a band per song), two overlapping rings for duets, a ring of artists for compilations, a large label for singles, with echo rings for popularity and the accent for the most played; song bars brighten with plays. Over a background, the Now playing cover and queue are see-through. Watch mode gets its own controls: the song, progress, previous, play, next, the next background and an option to keep the song info on screen; they fade while playing. The WebGL explanation lists the steps to turn graphics acceleration on.

## v26.10.21.6

- Backgrounds: no red notice when WebGL is unavailable or a scene cannot run; the background button explains it.

## v26.10.21.5

- Now playing backgrounds: when WebGL is unavailable (graphics acceleration off in Chrome, for example) the background button stays and explains why and how to turn it on, instead of disappearing; Watch appears only while a background shows; a scene that does not build on a device is skipped; a lost graphics context recovers. Escape in a menu no longer also closes Now playing.

## v26.10.21.4

- Song plays are counted: after 10 seconds of listening the app sends the track id and time to the audio Worker (POST /plays), which keeps one count per track and day in D1. Offline plays are sent when back online. Nothing identifying is sent or stored; the Terms page explains it. The audio release now applies the D1 schema before deploying.

## v26.10.21.3

- Now playing backgrounds: five song-driven WebGL scenes (Halo, Aurora, Horizon, Warp, Weave) that follow the bass, mids, highs and beats, varied per song, with a picker (Auto, a scene, Off) and a Watch mode. Desktop Now playing scrolls as one page with the cover and controls floating. Hints on every icon button (hover, keyboard focus, long press). A 'Share listening statistics' button while statistics are off.

## v26.10.21.2

- Phones: separate floating glass controls in place of the long bar: round Back and logo buttons, one pill for Search and Library, and the title as plain text
- Back and Cancel are icons (with labels for screen readers); on search, one round button clears the field, then leaves search

## v26.10.21.1

- Phones: a floating liquid-glass top bar (blurred, light edge, rounded) with the page fading out above it
- The logo opens a menu on every page with the sidebar's places, languages, browse, About, Terms and Help
- Large page titles: the bar shows the title only after the page's own heading scrolls under it
- Search on phones: the field is the top bar, sticky, with Cancel
- Library tabs share the width with no sideways scroll; Back up and Restore move to their own row
- Rounder search field and player on phones

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
