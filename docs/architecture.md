# Architecture

Zaideih is a static, offline-first HTML5 app. One shared codebase (`src/`) runs in two shells: the web (an installable PWA served by any static host) and the desktop (Electron). There is no application server: the catalog ships as JSON, the browser keeps the user's library, and a Cloudflare Worker streams audio from R2.

```
assets/data/*.json ──tools/catalog.mjs──▶ build/catalog/catalog.<hash>.json + meta.json
                                                   │
                          tools/build.mjs --platform web|desktop
                                                   ▼
                  dist/web (PWA)          platforms/desktop/app (Electron renderer)
                        │                               │
                        └──── GET /audio/:id ───────────┘
                                     ▼
                     worker/media (D1: id → path) ──▶ R2: music/{folder}/{file}
```

## Data

| File | Role |
|------|------|
| `albums.json` | Albums and tracks. Track `i` is the global track id used everywhere (likes, playlists, downloads, audio URLs). |
| `artist.name.json` | Artist names, `aka`, spelling variants (`thesaurus`) and type. |
| `category.json` | Language, genre, artist-type and album-type tables. |
| `media.json` | Audio object path for every track: `[albumUid, folderPath, [[trackId, fileName], ...]]`, one album per line. |
| `album.name.json`, `track.name.json` | Tag corrections used at ingest time. The app does not read them. |

`tools/catalog.mjs` validates every reference and fails, listing every problem, when anything is inconsistent: an unknown artist, genre or language id, a duplicate track id, or a track without an audio path in `media.json`. Text is normalized to NFC; the source tags contain Myanmar marks in non-canonical order (U+103A before U+1037), which breaks word segmentation and search. The output is one content-hashed catalog file (about 1.8 MiB, 0.5 MiB compressed) plus a small `meta.json` that names it.

`media.json` was generated from the last Django database dump with `node tools/media.mjs import <dump.sql.gz> --apply`. The importer reads only the `album` and `track` tables; dumps also contain user and session tables and are never committed (`*.sql.gz` is ignored).

## App

- Vanilla ES modules, bundled and minified by esbuild. Hash routing (`#/album/…`) works on any host without rewrite rules.
- `src/app.js` exports `boot(platform)`. Each platform entry (`platforms/web/main.js`, `platforms/desktop/renderer.js`) passes its name and catalog location; the web entry also registers the service worker.
- The whole catalog is held in memory. Search normalizes text (NFKC, zero-width characters removed, Latin diacritics folded, Myanmar marks kept) and also matches artist `aka` and spelling variants, with and without spaces.
- Myanmar text is split into words with `Intl.Segmenter` (syllables where unavailable) and wrapped in non-breaking spans, because Chromium otherwise breaks lines inside syllables.
- Artwork is generated from catalog data, since the data has no images (`src/ui/art.js`). Every choice is deterministic, so an album or artist looks the same everywhere.
  - Album cover: grey shade from the album id; a pattern from the genre (rings for gospel, hymn and worship; weave for tribal, folk, ethnic and classical; grooves otherwise); the language code, year and title; and a strip with one bar per song, sized by its length. The playing song's bar is lit.
  - Artist picture: one ray per year from the first to the last release, clockwise from the top, with length from that year's songs and brightness from its plays (the most played year uses the accent). The centre grows with total plays; faint rings count albums (one more ring each time the count doubles, up to six); ray ends show the artist type (plain for male, a dot for female, dotted for groups or various artists, outline when unknown). Latin names show up to two initials in the centre. Myanmar names show none, since a single letter of a Burmese name does not read as the name.
  - Lock screen and media keys: the cover is drawn on a canvas and handed to the Media Session API as a data URL (`player.setArtwork`).
- Logo: the mark from `assets/psd/icon.svg` (`src/ui/logo.js`), shown on a `#5a5a5a` tile. The app icons in `platforms/web/public/icons/` are generated from the same path.
- Navigation: wide screens use the sidebar. Small screens use an iOS-style bar: the logo on Home and "Back" elsewhere on the left, the page title in the centre, Search and Library on the right. Back follows in-app history (depth kept in `history.state`) and goes Home when there is none, e.g. after opening a shared link.
- Home starts with recently played songs and the most played artists per language (up to 12, from catalog play counts; the catch-all credits "Unknown" and "Various Artists" are excluded).
- Album tiles show the title, the main artist (with "+N" for the rest), year, song count and a mark when every song is downloaded. On pointer devices a play button appears over the cover on hover or focus and plays the album without opening it.
- Search suggestions (`src/ui/suggest.js`, an ARIA combobox): typing shows up to 3 artists, 3 albums and 5 songs; picking a song plays it. The empty box lists recent searches, kept per device in `localStorage`. While the list is open, the box and the list form one panel and the page behind is dimmed and blurred.
- Close matches (`closest()` in `src/core/search.js`): when fewer than 4 records match exactly, artists, albums and songs within a few typos (1 for up to 4 characters, 2 up to 8, 3 beyond) fill the list. A record is compared three ways and the best wins: its whole name or title without spaces, the start of it (for a query typed part way), and word by word. A character-set check skips records that cannot be close, which keeps a pass over the full catalog to tens of milliseconds.
- Scopes: All, Artists, Albums or Songs, as buttons in the suggestions panel and on the results page, kept in the address as `in=`. Within Albums or Songs, records by a matching artist follow the title matches, since people often type the artist when they want an album. Typing an artist's name in All offers "Albums by …" and "Most played songs by …".
- Questions (`src/core/intent.js`): `parseIntent()` reads a query as a question from a small vocabulary (order: most played, top, newest, oldest; kind: artists, albums, songs; years and decades such as "1987" or "90s"; "by <artist>" or "<artist> albums") plus the catalog's language and genre names. An order word alone with other words left over ("best friend", "new life") stays a title search. `answer()` lists the matching records and `describe()` titles them ("Most played Mizo gospel albums from the 1990s"). The answer leads the suggestions and the results page; a scope other than All decides what kind of record it lists.
- "Did you mean" (`didYouMean()`): the strict correction of an artist name or album title (`correction()`, up to 2 typos), otherwise the closest artist, album or song. It is offered when nothing matches and when only a few results do; a search with no exact matches lists the close matches.

## About and terms

`#/about` carries the slogan "Zaideih Music Station", the purpose (preserving the music, free to listen, nothing sold, no financial benefit), catalog figures, and the app version and catalog id; it is the only place the version is shown. `#/terms` covers listening, ownership, downloads, data, availability, rights holders and changes. Both link to the repository's issue tracker for rights holders. The sidebar foot and the Library page link to both.

## Theme and player

- One theme, "graphite", with no light or dark variant and no switch. The page is the logo grey `#5a5a5a` with white text; the sidebar (`#525252`), cards and inputs (`#4e4e4e`), hover and selection (`#646464`), the player (`#3e3e3e`) and the covers are steps of the same grey.
- The accent is the logo's silver `#ececec`: the play button, progress, the liked heart, the playing song and the selected navigation item. It carries dark text (`#3a3a3a`, 9.6:1) and reads 5.8:1 on the page. The only other colour is a muted red for errors.
- Fonts: Outfit (Latin) and Padauk (Myanmar), both bundled for offline use under the SIL Open Font License (`licenses/`).
- Player: a floating card on every screen size, translucent over a blurred view of the page, with a vertical gradient, a brighter top edge and a shadow on all sides; a fixed strip fades and blurs the page where it passes under it. Seek bars are 8px tall with a 16px thumb and show how much of the song has loaded. Left and Right seek 5 seconds; Shift+Left and Shift+Right change song.
- Live animation (`src/core/visualizer.js`, `src/ui/viz.js`): the `<audio>` element is routed through a Web Audio `AnalyserNode` on its first play. Frequency bars radiate from the play button and `--level` (loudness) drives its glow. In Now playing the bars sit on the progress bar and are lit over the played part. The draw loop runs only while playing and visible, and not at all with `prefers-reduced-motion`. Pausing freezes the bars and the glow in place (dimmed); they are redrawn on resize and copied into the Now playing view if it opens while paused.
- Progress bars show the time under the pointer on hover (pointer devices only).
- Analysis requires CORS: the element uses `crossOrigin = "anonymous"`, so streaming from an origin outside the Worker's `ALLOWED_ORIGINS` fails instead of playing silently through a muted graph. Blob playback of downloads is same-origin and unaffected.
- iOS and iPadOS: analysis is disabled, because Web Audio is suspended when the screen locks or the app is backgrounded, which would stop playback. The bars stay still; playback works normally.

## Audio

Every track streams from `https://media.zaideih.com/audio/{id}` (override with `ZAIDEIH_AUDIO_URL` at build time). The Worker looks the id up in D1 (`tracks`: `id`, `folder_path`, `mp3`) and serves `music/{folder_path}/{mp3}` from R2 with Range support.

The D1 table is loaded from `media.json`:

```bash
node tools/media.mjs d1 --apply            # writes build/d1/tracks.sql (idempotent upserts)
npx wrangler d1 execute audio --remote --file build/d1/tracks.sql --config worker/media/wrangler.toml
```

`--prune` additionally deletes D1 rows for tracks no longer in `media.json`.

Access rules in the Worker:

- `<audio>` requests (`Sec-Fetch-Dest: audio`) are served to any page, as before.
- `fetch()` requests (`Sec-Fetch-Dest: empty`), which the app uses to download songs for offline play, are served only to origins in `ALLOWED_ORIGINS`, with CORS headers. The desktop app's origin is `app://zaideih`.
- Fetch metadata headers deter casual hotlinking; they are not access control, since non-browser clients can send any headers.

## Playback diagnostics

A stream that fails with a network or "not supported" error is first retried once with a one-off `?fresh=` query, which skips the browser's saved copy: a copy saved from an older server answer (without the CORS header the CORS-mode player needs) is refused by the browser, and Chrome keeps range responses for a day. `#/help` explains the remaining cases to listeners.

When a song still fails, the player shows its message at once, then probes the failure (`src/core/probe.js`): for a downloaded song it reads the first 16 bytes of the saved file; for a stream it makes a ranged, uncached request for the first 16 bytes and reads the status and the Worker's `X-Zaideih-Meta` and `X-Zaideih-Reason` headers. The findings are packed into a diagnostic code (`src/core/diagnostic.js`): format version, what failed, flags (download, desktop, online, probed, unreachable, no D1 row, no R2 object), HTTP status, the file's leading-byte format, the Worker's lookup source, track id, size, app version and time, then a CRC-8, in Crockford base32 groups ("ZE-0420-R068-…"). The code holds no paths or personal data. It appears under the error notice and in Now playing, with a Copy button.

`tools/diagnose.mjs <code>` decodes it, names the likely cause and prints the track's R2 key with its code points and the D1 and R2 commands that check it; `track <id> --probe` does the same without a code. The app decodes codes on an unlinked page, `#/code/<code>`. A mistyped code fails the check digit and is refused with that reason.

## Usage statistics

Google Analytics 4 (`G-65TTKMZEGC`, set at build time as `ZAIDEIH_GA_ID`; empty disables) is built into production web builds only, never dev or desktop builds. `src/core/analytics.js` loads nothing until the listener chooses Allow on the first-visit card (basic consent mode); the choice is kept per device in `localStorage` (`zaideih.analytics`) and changed on the About page. Page views are sent by the app on each route change (`send_page_view: false`, since routing is by hash), with the address stripped of its query so search text is never sent, and a diagnostic code page reported as `#/code`. A `play_track` event (track, album and language ids) is sent once per song started. The CSP adds Google's documented hosts (`*.googletagmanager.com` for scripts; `*.google-analytics.com`, `*.analytics.google.com` and `*.googletagmanager.com` for images and connections) only when analytics is built in.

## Offline

| What | Web | Desktop |
|------|-----|---------|
| App shell | Precached by the service worker | Bundled in the app |
| Catalog | Precached at install; `meta.json` network-first, catalog file cache-first | Bundled in the app |
| Downloaded songs | IndexedDB Blobs, played through object URLs | Same |
| Likes, playlists, history, queue | IndexedDB | Same |

Downloads use IndexedDB Blobs rather than Cache Storage because `<audio>` sends Range requests, which a service worker would have to answer with hand-built partial responses; Blobs avoid that and behave the same in Safari, Chromium and Electron. The app asks for persistent storage on the first download. The library can be exported to and restored from a JSON file; there is no cross-device sync.

## Desktop

`platforms/desktop/main.js` serves the built renderer over a privileged `app://zaideih` scheme, which gives the page a real origin for IndexedDB, Media Session (hardware media keys) and CORS. The window runs sandboxed with context isolation and no Node integration, refuses every permission request, blocks navigation away from the app, and opens web links in the default browser. The Content-Security-Policy allows media and fetch only from the app and the audio origin recorded in `app/build.json`. Electron is a dependency of `platforms/desktop` only, so web builds never install it.

## Versions

Releases use `yy.mm.dd.changes` (`v26.10.19.1`), stored without the `v` in both `package.json` files and bumped by `tools/version.mjs` (dry run by default). The build refuses an invalid version. The app shows the release version; the service worker cache is named by release plus a content hash of the build, so every build installs a fresh cache. The scheme is not semver: `npm version` cannot bump it, and installer tooling that requires semver (desktop packaging) will need it mapped, e.g. to `26.10.19-1`.

## Local development

`tools/dev.mjs` builds with `--dev` (unminified, source maps, no service worker), serves `dist/web` through `tools/serve.mjs` on `localhost:8080` and reloads the page after rebuilding. `tools/serve.mjs` applies `dist/web/_headers` like Cloudflare and answers Range requests; `npm run preview` uses it for the production build.

## Deployment

- Web: Workers static assets (`wrangler.jsonc`, Worker `zaideih`, files from `dist/web`, no Worker code). `dist/web/_headers` sets the CSP and caching: hashed assets and catalog files are immutable; `index.html`, `sw.js` and `meta.json` always revalidate. `index.html` carries the release in `<meta name="application-name" data-version>`, which the release workflow reads back from the live site.
- Releases: a push to master whose first line is `release: web|audio|d1|…` tests, builds and deploys with wrangler, then tags the commit and publishes the CHANGELOG.md section as a GitHub release: [releasing.md](releasing.md).
- Audio Worker: `npx wrangler deploy --config worker/media/wrangler.toml`. Step-by-step guide, including what changed when Django was removed: [worker-audio.md](worker-audio.md).
- CI (`.github/workflows/ci.yml`) runs the tests, checks the versions and `media.json` coverage, and builds both platforms on every push and pull request; the release workflow calls it as its gate.

## Open items

- Adding albums needs a new ingest tool. The Django `scan_library` and `compile_catalog` commands that produced `albums.json` were removed with Django; they remain in git history before this restructure.
- Play counts (`p`) are static in `albums.json`. The Worker's `tracks_status.served` counts fresh fetches (not plays) and could feed a periodic update.
- `artist.name.json` and `artist.name-id.json` differ only in the type of artist 2074; the build reads `artist.name.json`.
