# Zaideih Music Station

A free, open library of music by the Zo people and their neighbours, kept so these songs are preserved and stay easy to find and listen to.

![License](https://img.shields.io/github/license/khensolomon/zaideih)
![Check](https://img.shields.io/github/actions/workflow/status/khensolomon/zaideih/ci.yml?label=check)
![Release](https://img.shields.io/github/actions/workflow/status/khensolomon/zaideih/release.yml?label=release)
![Last commit](https://img.shields.io/github/last-commit/khensolomon/zaideih)

## About

In Zolai, *Zaideih* means "sing proud". Zolai is the written language of the [Zo people](https://en.wikipedia.org/wiki/Zo_people) of Myanmar and India (Zomi, Mizo, Chin, Tedim, Falam, Hakha, Paite, Kuki and others). Across dialects such as Zopau and Zokam, the music and traditions are shared.

The catalog holds about 2,300 albums and 28,000 songs by 2,000 artists, in Zolai, Mizo, Falam, Hakha, Chin, Myanmar and other languages, mostly gospel, worship, traditional and contemporary music.

- **Free to listen**: no account, no ads, nothing for sale, no financial benefit.
- **The music belongs to its artists**: Zaideih only keeps it available. Rights holders can [open an issue](https://github.com/khensolomon/zaideih/issues) to have a recording credited differently or removed.
- **Private by design**: no account is needed; signed in, liked songs and playlists follow the account, and history and downloads stay on the device. Usage statistics are collected only with consent; song plays are counted without anything that identifies the listener.

Started in 2006 and launched in 2007, Zaideih has been rebuilt several times: ASP, Flash, PHP, Node.js, Python with Flutter, and now a static HTML5 app.

## Features

- One app for the web (installable PWA) and the desktop (Electron).
- Offline first: the whole catalog is browsable offline, and downloaded songs play without a connection.
- Search across Latin and Myanmar script, with spelling variants, close matches, "did you mean" and simple questions such as "most played Mizo gospel albums from the 1990s".
- Library: liked songs, playlists and history; signed in, liked songs and playlists follow the account across devices, and a backup file keeps the library without an account.
- Player with a queue, shuffle and repeat, lock-screen and media-key controls, and animated backgrounds in Now playing that follow the music.
- Sound for old recordings, applied while listening: skip silent tape at the start and end, clean up air blowing, rumble and hiss, even out volume between recordings, play one-sided recordings in both ears, and a ten-band equaliser with presets.
- Generated artwork: album covers and artist pictures drawn from the catalog itself.
- Lyrics: added and corrected by listeners who sign in, with translations, chords, timing, and search by a line of the words. See [docs/lyrics.md](docs/lyrics.md).
- Personal music: signed in with Google, GitHub or a passkey, upload music of one's own to a private library that only its owner can play, on any device. See [docs/library.md](docs/library.md).

## Development

The app is static: the catalog ships as JSON and the browser does the rest, so any static host can serve the web build. The only build dependency is [esbuild](https://esbuild.github.io/); the tools use the Node.js standard library.

```bash
git clone https://github.com/khensolomon/zaideih.git
cd zaideih
npm install
npm test
npm run dev        # http://localhost:8080, unminified, live reload, no service worker
npm run preview    # production build on http://localhost:8080, with the service worker
npm run desktop    # desktop app (first time: cd platforms/desktop && npm install)
```

Data tools are dry runs by default; `--apply` writes. Accounts, credentials and settings for a deployment of its own: [docs/setup.md](docs/setup.md).

### Testing locally

- `npm run dev` compiles the catalog, builds the web app with source maps, serves it on <http://localhost:8080> and reloads the page after every change in `src/`, `platforms/web/` or `assets/data/`. The server applies the same `_headers` (CSP, caching) as Cloudflare, so CSP problems show up locally.
- `npm run preview` serves the production build with the service worker, for testing install, updates and offline: load the page once, set DevTools Network to Offline, and reload.
- Songs stream from `media.zaideih.com`. Only `http://localhost:8080` is an allowed origin of the audio Worker; on another port neither streaming nor downloads work, because the player requests audio in CORS mode. Another audio host can be used with `ZAIDEIH_AUDIO_URL='http://127.0.0.1:9000/{id}.mp3' npm run dev`.
- Plays are never counted from local builds: dev builds send nothing, and the Worker counts only the released app's origins.
- Phones: Chrome DevTools device mode covers layout. On an Android phone, `adb reverse tcp:8080 tcp:8080` keeps the address `localhost`, which the service worker and the Worker's allowed origins both require.
- To start clean, use DevTools, Application, Storage, *Clear site data*.

### Releases

Versions are `vyy.mm.dd.changes`, for example `v26.10.19.1` for the first release on 2026-10-19 and `v26.10.19.2` for the next one that day. The scheme is not semver, so `npm version` cannot bump it.

```bash
node tools/version.mjs                                  # show the next version (dry run)
node tools/version.mjs --note "What changed" --apply    # write it, with a CHANGELOG.md section
git commit -am "release: web 26.10.20.6 What changed"   # on master: test, build, deploy
```

A push to master whose first line, or whose merged pull request's title, starts with `release:` (`web`, `audio`, `d1`, `web+audio`, `all`) is tested, deployed to Cloudflare, tagged and published as a GitHub release. See [docs/releasing.md](docs/releasing.md).

### Layout

| Path | Purpose |
|------|---------|
| `assets/data/` | Source of truth: `albums.json`, artist and category tables, `media.json` (audio paths) |
| `src/` | Shared app: catalog, search, player, library, offline downloads, play counts, UI |
| `platforms/web/` | PWA entry point, service worker, manifest, icons |
| `platforms/desktop/` | Electron main process |
| `worker/media/` | Cloudflare Worker (`media.zaideih.com`): streams audio from R2, counts plays and serves their totals, accounts and sign-in (GitHub, Google, passkeys), personal libraries and publish requests, synced likes and playlists, lyrics; D1 schema in `schema.sql` |
| `tools/` | Catalog compiler, media paths, D1 schema and reset (`d1.mjs`), platform build, versions and release plan, playback diagnostics |
| `wrangler.jsonc` | The site on Cloudflare (Workers static assets from `dist/web`) |
| `.github/workflows/` | `ci.yml` checks every push; `release.yml` deploys `release:` pushes |

### Documentation

- [docs/setup.md](docs/setup.md): from a fresh clone to a release: accounts, credentials (where to get them, where they go, what they may do) and settings
- [docs/architecture.md](docs/architecture.md): design, data flow, catalog, audio, offline, play counts, admin page
- [docs/worker-audio.md](docs/worker-audio.md): the audio Worker: routes, deploying, checking, sign-in
- [docs/accounts.md](docs/accounts.md): accounts, sign-ins and sessions
- [docs/library.md](docs/library.md): personal libraries (uploads, signed streaming, moderation)
- [docs/sync.md](docs/sync.md): liked songs and playlists synced across devices
- [docs/lyrics.md](docs/lyrics.md): lyrics: rules, formats, the studio, shared lyrics, search
- [docs/releasing.md](docs/releasing.md): one-time Cloudflare and GitHub setup, release targets, rollback
- [docs/TODO.md](docs/TODO.md): work not yet done
- [CHANGELOG.md](CHANGELOG.md): what changed in each release

## Roadmap

- [x] Show the counted plays in the app
- [x] Hidden admin page to edit the catalog through GitHub
- [x] Personal libraries: private uploads with moderation
- [ ] Add albums from R2 folders to the catalog
- [x] Ask for an upload to be published
- [x] Lyrics, added and edited in the app
- [ ] Share links for rights holders
- [ ] Import the lyrics in `assets/lyric/`
- [ ] Desktop installers, and downloads saved as files

## Contributing

Issues and pull requests are welcome. Zaideih is supported by its community and friends, with special thanks to Thang Biak Lal, Paupi and Cinpu.
