# Version

## v26.10.27.8

- Published Chin Famine Concert (29 songs, from @khensolomon's library)

## v26.10.27.7

- Smoother song rows: the playing bars pause in place, starting a song no longer holds the page up, and a page loads with one redraw
- The playing row's bars freeze where they are on pause and move on from there on resume (the animation is paused, not removed); they move by transform, so a long list is not laid out again on every frame
- Starting a song: the lock-screen cover of a song tapped in the app is drawn just after it starts (in the background, from a car's or the lock screen's buttons, still at once); the covers ahead are drawn one per idle moment instead of four in a row. Measured on an album page: no long task while a song starts (were 314 and 329 ms)
- The visualizer reads the page's layout twice a second instead of on every frame, and draws its bars with one fill per colour
- Loading a page: counted plays, holds, live changes, trimmed songs and the lyrics marks arriving together draw it again once, not once each (6 draws to 2 on an album page; the longest task from 495 to 175 ms)

## v26.10.27.6

- t2 (catalog, 1 change)

## v26.10.27.5

- Buttons answer at once: a slow action shows a spinner and its step, and a second click starts nothing
- Workspace: Publish as a pull request, Apply now, Merge and release, Approve and publish, Check again, the token sign-in and every other slow action turn their button into a spinner with the step under way (Reading the newest files from GitHub…, Opening the pull request…, Merging…), disabled until done; the page's other actions wait meanwhile, moving around does not
- App: a button whose action is still running after a moment (Leave, Ask to publish, and others) shows a spinner and ignores more clicks; the Public in the catalog switch waits for its answer

## v26.10.27.4

- Live catalog changes: corrections applied at once, without a release, and released later in one pull request
- Workspace, with the new Catalog right (and for the owner and co-owners): Apply now, without a release, for an album's title, year, language and genres, a song's title, artists and hiding, an artist's name, other name, type and spellings; listeners see it within about five minutes
- The Draft lists the live changes with Undo, and Release the live changes puts them into one pull request; once a release carries them (or overtakes them) they go by themselves
- The app reads `GET /live` at start and every five minutes and applies each change only while the released catalog still has the value it was made against, so a live change never undoes a release
- Audio Worker: `/live`, `/live/detail`, `/live/remove`; D1 `catalog_live` and `catalog_live_log` (migration 0011)

## v26.10.27.3

- Sharing: an album, or all of one's music, shared with members by an invite link; taken back at once
- Share an album (its page, Share) or all of your music, songs added later too (Uploads, Share all): an invite link, shown once, used once, gone after 14 days unused; the owner and co-owners can also find a member by name and share at once
- The member it is shared with finds it in Library, Uploads, under Shared with you, on the album page ("Shared with you by …") and in search; they can listen but not change, share on or publish it, and can Leave
- Every play of a shared song checks the share (an address that names its listener), so Take back stops it at once; Listen only hides downloading in the app and removes downloaded copies
- Search: "My music" is now "Private": one's own music, and music shared with one
- Audio Worker: `/library/shares…`, D1 `library_shares` (migration 0010); joining two accounts moves their shares

## v26.10.27.2

- Publishing in place: albums added from storage are published where their files are, nothing copied
- An album whose songs were all added from storage, in one folder, keeps its files where they are: media.json names that folder (a folder starting with "/", src/core/media-keys.js), the Worker plays and trims from it, and the approval form says so (or why the songs are copied: uploads, several folders, a folder that cannot be named)
- The storage browser marks files that are catalog songs' own ("in the catalog: keep it where it is"); removing a song never deletes such a file
- `tools/inplace.mjs` points an album published as copies back at its originals in storage and, a day after the release, deletes the copies (dry run unless --apply)
- Fixed: listing a storage folder of more than 100 audio files failed, since D1 binds at most 100 values a query

## v26.10.27.1

- Search: My music offered as soon as the person's own music is known, and only then
- Fixed: opened from a link or a reload, search was drawn before the person's uploads were read and showed no My music switch until it was opened again; the switch now appears when they are read (and goes when there are none, signed out), and the results are searched again with them

## v26.10.26.12

- Audio studio, guided: a cautious suggestion, one picture with the ends close up, checks of the joins, Undo
- The suggestion cuts only steady tape noise, keeping 1 s before the first sound and 2 s after the last, and says what it found: Safe to cut, Check this one (a quiet sound apart from the music, or noise that is not steady, kept and marked), or Nothing to cut
- The tape's noise floor is measured at the recording's ends (and its quietest 2 %), not from its quieter tenth, which on most songs fell inside the music
- One picture: the first and last seconds close up, the middle folded; what is cut striped and labelled, the tape kept for safety and a quiet sound kept shown apart; a cut reaching sound louder than the tape outlined and said in words
- Check the start / Check the end play the join: what is cut, a tone, what stays
- Save without a further question, then Listen to the saved file, Undo and Next song in the album; Fine-tune (times, steps, snapping, a note, keys) and the History folded away
- Fixed: the studio opened from a link or a reload said the Audio studio right was missing before the member's rights were read; the studio was drawn again from the start (its cuts lost, the recording read again) when the list of trimmed songs was read again, after a save and every five minutes

## v26.10.26.11

- Audio studio: trim a song's start and end without loss, as versions, the original kept
- `#/audio/<track>` (song menu, Trim in the audio studio) for the owner, co-owners and the new Audio studio right: the original drawn whole and close up at each end, on a level scale so the tape's hiss shows; where the music starts and ends suggested from the tape's own noise floor; handles, typed times and 0.1 s steps; each cut moved to the quietest moment nearby; the edges played before saving; a confirmation with the times and the new length
- Audio Worker: `GET/POST /edits…`; a cut keeps the original's MP3 frames byte for byte (no decoding, no loss), with its ID3 tags and a new Xing/Info frame; versions in `edits/<track>/<n>.mp3`, the original never changed; D1 `audio_versions`, `audio_current`, `audio_log` (migration 0009); `/audio/:id?v=<n>`
- Versions: listen to the saved file itself; make any version, or the original, the one played again
- App: trimmed songs play by version (no stale copy), show their new length, and downloads of another version are fetched again; no release needed for an edit
- Skip silence and Even volume remember each version on its own

## v26.10.26.10

- Wide screens: album and artist pages in two columns, library and workspace wider, quick actions in the player
- Album and artist pages from 1400px: cover or picture, title, facts and buttons on the left, kept in view while the songs scroll on the right
- An album's page ends with More by its first artist
- Library: the whole width, its rows side by side, song lists in columns from 1900px
- Workspace: pages up to 1680px (2100px from 2200px), tiles and the list beside the editor wider
- Player bar: Go to album and Add to playlist beside the song from 1440px, Share and Download from 1760px; the More menu keeps them all

## v26.10.26.9

- Player bar on wide windows: lyrics, sound and sleep, up next, and the line being sung
- From 1280px: Lyrics (the playing song's page), Sound and the Sleep timer beside the volume
- From 1600px: Up next, the next song in the queue, a tap playing it now; from 2300px, the next three
- From 1900px: the line being sung beside the song, for songs with timed lyrics (read only while the window is that wide)

## v26.10.26.8

- Wide screens: covers grow with the screen, browse pages use the whole width, song lists in columns
- Home, languages, genres, search and the songbooks take the whole width beside the sidebar instead of 1120px
- Album covers, artist pictures and songbook covers grow with the room (148 to 236px for albums), with larger gaps and margins: at 3440px wide, 11 albums a row at 253px, instead of 6 at 174px in the middle
- Song lists on home and search fall into two or three columns from 1900px wide
- Album, artist, lyrics and text pages keep a reading width, 1280px from 1700px wide

## v26.10.26.7

- Lyrics page: tools as icons, chords smaller and softer with a choice per device, Play only for another song
- Play under the title only while another song (or none) is in the player; for this song the page says Playing or Paused
- Chords (show, hide), text size and chords, share and edit as icons; A− and A+ move into the Text size and chords panel (Small, Medium, Large, Larger)
- Chords smaller than the words and softer by default; their size and brightness chosen per device, kept only there (`zaideih.lyrics.chordStyle`), followed wherever chords show
- Fixed: the text size started at Small instead of Medium on a device that had not chosen one

## v26.10.26.6

- Lock screen and car stereos: the song as a picture, its title, artists and album readable on any screen
- For car stereos and accessories that show Myanmar (or any non-Latin) text unreadably: the picture carries the song's title (as large as fits in two lines), up to four artists and how many more, and the album with its year, drawn with the app's fonts; the album's motif and strip above and below
- Drawn at once, never waiting on image decoding: a song changed from the car in the background gets its picture in the same moment (the old cover waited on decoding the motif, which iOS can hold back in the background)
- Fonts loaded once in front; a picture drawn before they arrive is drawn again

## v26.10.26.5

- Artist page: a clearer header; sings with, with others, appears on, similar artists and a radio
- Sings with: the artists they share songs with, most songs together first, with how many
- With others: their duets and featured songs, in a section of their own
- Albums apart from Appears on (compilations and others' albums with a song or two of theirs)
- Similar artists: same language; albums shared, genres in common and years active; each says what they share
- Radio: their most played songs shuffled with those of the artists around them; held albums left out
- Phones: Shuffle and Radio as icons beside Play popular; the artist rows swipe sideways
- A clearer header: years, songs, albums (+ those on others), plays and how many they sing with, as labelled numbers; under the buttons, their years as a strip, a bar a year as tall as its songs, the most played year lit and named under it, a dot under the years of their own albums, each bar naming its year, songs and plays
- All worked out on the device from the catalog (`src/core/artist-links.js`), no server change

## v26.10.26.4

- Phones: search chips as icons in the suggestions, so all fit a small screen
- The chosen chip is filled rather than named; My music is its lock everywhere on phones, named in its label and tooltip (it had no accessible name when its label was hidden)

## v26.10.26.3

- Phones: the player steps aside while typing; dragging the page closes the search keyboard
- `body[data-typing]` while a text field has the focus on a touch screen; the player and its fade slide away, back when typing ends (the lyrics studio keeps the player above the keyboard)
- Search: a drag on the page (not the field or the suggestions list) closes the keyboard, so the fixed search bar no longer pans with the page

## v26.10.26.2

- Songbooks: a studio header for editors; undici patched in the Worker's tools
- Book and song pages for their editors: the studio's sticky header with back, title, a line under it and the tools as icons (Add pages, Details, Collaborators; Edit the words, Details, previous and next number); no floating bar on phones; the title bar in the installed desktop app
- `worker/media`: undici overridden to 7.30.1 (wrangler 4.150 and 4.152 both pin 7.29.1: GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c); `npm audit` clean in every package

## v26.10.26.1

- Lock screen and car stereos: the cover comes with the song on next and previous
- The covers of the songs around the playing one (one back, three ahead) are drawn ahead, while the app is in front; a change from the car, CarPlay, headphones or the lock screen sets title, artist, album and cover at once instead of the app icon followed by the cover
- The metadata is set again when the new song starts sounding
- Lock-screen covers are JPEG, a fraction of the PNG's size, for accessories on slow links

## v26.10.25.23

- add album & spelling (catalog, 1 change)

## v26.10.25.22

- Songbooks: a shelf of covers, find and sort, New songbook as a dialog
- Each book a cover: short name, spine, language imprint; title, edition and songs under it; Private and Editor/Reader quiet
- Find a book, show All/Public/Private/Appointed, sort by title, most songs or language
- Add pages: a small round button on the cover's corner, shown on hover
- New songbook: a dialog with a live cover; short name from the title's initials; taken short names said as typed; edition, year and publisher folded away
- A book's page: its cover beside the title; Add pages, Details and Collaborators as quiet tools

## v26.10.25.21

- Songbooks: collaborators appointed to one book, as editor or reader
- A book's page, Collaborators (owner, co-owners and the Songbooks right): find a member by name, GitHub login or email, appoint as Editor or Reader, change the role, take off
- An editor changes that book only: details, Add pages, numbers, each song's words, details, credits, work and joined recordings; a reader sees it while private
- Public or private, and deleting from a public book, stay with the owner and co-owners
- Audio Worker: `songbook_members` (migration 0008); books and texts carry `may`; `GET/POST /songbooks/:book/collaborators`, `GET /songbooks/members?q=`; lyrics of a private text are edited by its book's editors

## v26.10.25.20

- Build: the duplicate info icon removed; esbuild warnings fail the build
- `tools/build.mjs`: every bundle (sound worklet, Workspace, app, service worker) stops the build on an esbuild warning, naming the bundle

## v26.10.25.19

- Songbooks: change a number, delete a song, find recordings to join
- Song details: Number in the book, with Change the number (a number already used is refused)
- Delete: only this number when another book prints the words; otherwise the song, its words and their history; refused while recordings are joined
- Recordings: Join a recording lists Zaideih songs with a close title, each with Join, above a search by title
- Audio Worker: `POST /songbooks/:book/entries/:number` takes `number` and `delete`

## v26.10.25.18

- Songbooks: a book opens from its row; editing shows on a first visit; songs, not only hymns

## v26.10.25.17

- Songbooks: book and hymn pages, search by hymn number, recordings joined to hymns, editing details and credits
- A book's index filtered by number or words; a hymn with its work, writers, translators, other versions and recordings; person and work pages
- Search: "TL 145" opens that hymn; a line of a public hymn's words finds it
- Songbooks right: edit words in the studio, details, credits and work, join or unjoin recordings, take a number out; owner and co-owners make a book public
- Songbook pages no longer pile up their listeners when moved between (the import page added hymns twice after a second visit)

## v26.10.25.16

- Songbooks, step 2: add a book and import its pages, split into hymns

## v26.10.25.15

- Songbooks, step 1: books, hymn numbers, texts, works and people on the Worker, private by default

## v26.10.25.14

- My music: your songs and albums found by artist name too

## v26.10.25.13

- Album holds: streaming off or hidden from the public, without a release; search: My music
- Set per album in the Workspace (Availability) by the owner, co-owners and the new Albums right; the audio Worker refuses held songs
- Search: My music adds your own uploads to the results, marked with a lock (on by default)

## v26.10.25.12

- Installed on a desktop: the sidebar's head fades into the title bar

## v26.10.25.11

- Title bar at the system's own height; the Workspace and studio headers sized to it

## v26.10.25.10

- Title bar search: scope icons only; the bar stays sharp under open suggestions

## v26.10.25.9

- Title bar: a shadow over scrolled content; the studio and Workspace headers at its height; Library: Uploads

## v26.10.25.8

- Installed on a desktop: the app's own title bar
- Back, Forward and Search in the bar; the lyrics studio and the Workspace put their header there
- The window's buttons keep their corner on Windows and macOS; the arrow in the bar brings the system title bar back

## v26.10.25.7

- Workspace: its styles back after the rename

## v26.10.25.6

- Admin is now the Workspace
- The address is `#/workspace`; `#/admin` links (older pull requests, bookmarks) forward to it
- Sign-in, token and unsent draft move to the new keys once, on first load
- Pull requests opened from it say "from the Workspace"

## v26.10.25.5

- add genre and make correction to artist name (catalog, 7 changes)

## v26.10.25.4

- Audit fixes: releases from pull request titles, lyrics sharing edge cases, studio typing, updates
- Releases: a pull request titled "release: …" releases however it is merged; the site waits for the audio Worker
- Lyrics: edge answers kept 10 minutes; timing returns to a song when sharing ends; hidden texts are not copied; older apps' "Use these lyrics" becomes a proposal
- Studio: typing no longer drops the notices or repeats panels; late answers stay on their own page
- An update stays offered until taken; "Try again" after a start error takes the new version
- Focus stays on the button pressed when a page is drawn again
- First release of 26.10.24.31 to 26.10.25.3 (they were merged without releasing)

## v26.10.25.3

- Admin header: back inside the admin, no Catalog icon

## v26.10.25.2

- Admin: one search field; Admin on the sign-in card

## v26.10.25.1

- Search on phones: one bar, chips with icons, Lyrics; About folded in the sidebar

## v26.10.24.32

- Lyrics: same-song proposals, compare and merge

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
