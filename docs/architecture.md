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
- Covers are generated from the album id as tones of the brand colour, since the data has no artwork.
- Logo: the mark from `assets/psd/icon.svg` (`src/ui/logo.js`), shown on a `#5a5a5a` tile. The app icons in `platforms/web/public/icons/` are generated from the same path.
- Navigation: wide screens use the sidebar. Small screens use an iOS-style bar: the logo on Home and "Back" elsewhere on the left, the page title in the centre, Search and Library on the right. Back follows in-app history (depth kept in `history.state`) and goes Home when there is none, e.g. after opening a shared link.
- Home highlights the most played artists per language (up to 12, from catalog play counts; the catch-all credits "Unknown" and "Various Artists" are excluded).
- Album tiles show the title, the main artist (with "+N" for the rest), year, song count and a mark when every song is downloaded. On pointer devices a play button appears over the cover on hover or focus and plays the album without opening it.
- Search suggestions (`src/ui/suggest.js`, an ARIA combobox): typing shows up to 2 artists, 2 albums and 4 songs; picking a song plays it. With no matches it offers the closest artist name or album title ("Did you mean", up to 2 typos, `correction()` in `src/core/search.js`). The empty box lists recent searches, kept per device in `localStorage`.

## Theme and player

- One theme, with no light or dark variant and no switch. The page is the logo grey `#5a5a5a` with white text; cards and inputs are darker greys (`#4e4e4e`, `#444444`).
- One colour: madder red (hue 352, `--brand-h`). On a mid-grey page a saturated red cannot carry text or icons, so it appears in three strengths: `--accent` (deep red fill under white text, 6.9:1), `--accent-ink` (pale rose text, 4.5:1 on the page) and `--accent-icon` (light red icons such as the liked heart, 3.4:1). Covers, artist avatars, the player deck and the visualizer use tones of the same hue; languages are told apart by tone, not hue.
- Live animation (`src/core/visualizer.js`, `src/ui/viz.js`): the `<audio>` element is routed through a Web Audio `AnalyserNode` on its first play. Frequency bars radiate from the play button and `--level` (loudness) drives its glow. The draw loop runs only while playing and visible, and not at all with `prefers-reduced-motion`. Pausing freezes the bars and the glow in place (dimmed); they are redrawn on resize and copied into the Now playing view if it opens while paused.
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

- Web: Cloudflare Pages (build command `npm ci && npm run build`, output `dist/web`) or Workers static assets. `dist/web/_headers` sets the CSP and caching: hashed assets and catalog files are immutable; `index.html`, `sw.js` and `meta.json` always revalidate.
- Audio Worker: `npx wrangler deploy --config worker/media/wrangler.toml`. Step-by-step guide, including what changed when Django was removed: [worker-audio.md](worker-audio.md).
- CI (`.github/workflows/ci.yml`) runs the tests, checks `media.json` coverage, and builds both platforms on every push and pull request.

## Open items

- Adding albums needs a new ingest tool. The Django `scan_library` and `compile_catalog` commands that produced `albums.json` were removed with Django; they remain in git history before this restructure.
- Play counts (`p`) are static in `albums.json`. The Worker's `tracks_status.served` counts fresh fetches (not plays) and could feed a periodic update.
- `artist.name.json` and `artist.name-id.json` differ only in the type of artist 2074; the build reads `artist.name.json`.
