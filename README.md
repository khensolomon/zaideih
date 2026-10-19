# Zaideih Music Station 🎵

**A cultural oasis and collective library for the "unsung artists" of the Zo people.**

Zaideih (meaning **"Sing Proud"**) is a multi-platform music station designed to preserve and share ethnic recordings that touch the soul.

![GitHub stars](https://img.shields.io/github/stars/khensolomon/zaideih)
![License](https://img.shields.io/github/license/khensolomon/zaideih)
![Last commit](https://img.shields.io/github/last-commit/khensolomon/zaideih)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/khensolomon/zaideih/deploy.yml)

- ⚡ **Multi-platform**: one HTML5 app for the web (installable PWA) and desktop (Electron)
- 📴 **Offline first**: browse the full catalog and play downloaded songs without a connection
- 🌍 **Global access** to rare ethnic music collections
- 🤝 **Uniting communities** through shared linguistic and musical heritage
- 🆓 **100% Free** with no economic profit motive
- 📂 **Open Source** foundation for custom library building
- 📻 **Broadcast ready** with Bluetooth and background play support

## About

In Zolai, *Zaideih* means **"sing proud."** Zolai is the written language of the [Zo people](https://en.wikipedia.org/wiki/Zo_people) across Myanmar and India (*Zomi, Mizo, Chin, Tedim, Falam, Hakha, Paite, Kuki, and more*). Despite different dialects like Zopau or Zokam, our music and traditions bridge the borders between us.

Initiated in 2006 and officially launched in 2007, Zaideih has evolved through several eras:
ASP 🕸️ ➔ Flash ⚡ ➔ PHP 🐘 ➔ Node.js 🟢 ➔ Python 🐍 + Flutter 💙 ➔ HTML5 📴

This journey ensures your heritage remains accessible on any modern device.

## Features & Capabilities

- **Smart Discovery**: Real-time search and suggestions for artists and tracks
- **Personal Library**: Manage your own playlists, track recent searches, and sort your collection
- **Enhanced Playback**: Support for background audio, Bluetooth broadcasting, and lyrics display
- **Community Driven**: Built-in comment systems to discuss and share the stories behind the songs

### Categories

| Category           | Details                                                   |
|--------------------|-----------------------------------------------------------|
| Tribal Collections | Zomi • Mizo • Falam • Chin • Kuki • Paite • Tedim • Hakha |
| Genres             | Gospel • Worship • Traditional • Contemporary             |
| Themes             | Love of the Land • At Mercy • Heritage • Faith            |

```bash
git clone https://github.com/khensolomon/zaideih.git
```

---

## Privacy & Security

We believe your music journey is personal. Zaideih is designed with privacy in mind; we do not monetize your data or search history. Our goal is preservation and accessibility, not tracking.

## Who is this for?

- **The Zo Diaspora**: Anyone wanting to stay connected to their roots
- **Music Archivists**: Linguists and historians documenting "unsung heroes" of Southeast Asian music
- **Developers**: Those interested in building their own localized music libraries using our open-source core

---

## Development

The app is static: the catalog ships as JSON and the browser does the rest, so any static host can serve the web build. The only build dependency is [esbuild](https://esbuild.github.io/); tools use the Node.js standard library.

```bash
npm install
npm test
npm run dev                    # http://localhost:8080 with live reload (no service worker)
npm run preview                # production build on http://localhost:8080 (service worker on)
npm run desktop                # desktop app (first time: cd platforms/desktop && npm install)
```

### Testing the UI locally

- `npm run dev` compiles the catalog, builds the web app unminified with source maps, serves it on <http://localhost:8080> and reloads the page after every change in `src/`, `platforms/web/` or `assets/data/`. The service worker is off, so nothing is cached between edits. The server applies the same `_headers` (CSP, caching) as Cloudflare, so CSP problems show up locally.
- `npm run preview` serves the production build with the service worker, for testing install, updates and offline: load the page once, then switch DevTools → Network to *Offline* and reload.
- Songs stream from `media.zaideih.com`. `http://localhost:8080` is an allowed origin of the audio Worker, so downloads work locally once the updated Worker is deployed. Another port is not an allowed origin: streaming still works, downloads do not. A different audio host can be used with `ZAIDEIH_AUDIO_URL='http://127.0.0.1:9000/{id}.mp3' npm run dev`.
- Phones: Chrome DevTools device mode covers layout. On a real Android phone, `adb reverse tcp:8080 tcp:8080` keeps the address `localhost`, which the service worker and the Worker's allowed origins both require. `node tools/serve.mjs --host 0.0.0.0` exposes the server on the LAN, but over plain http to a LAN IP the service worker and downloads are unavailable.
- Clearing state: DevTools → Application → Storage → *Clear site data* removes downloads, the library and the service worker for `localhost:8080`.

### Versions

Releases are numbered `vyy.mm.dd.changes`, e.g. `v26.10.19.1` for the first release on 2026-10-19 and `v26.10.19.2` for the next one that day. `package.json` holds the number (without the `v`) and the app shows it in the sidebar and Library.

```bash
node tools/version.mjs           # show the next version (dry run)
node tools/version.mjs --apply   # write it to every package.json and lockfile
git tag v26.10.19.2
```

The scheme is not semver, so `npm version` cannot bump it.

| Path | Purpose |
|------|---------|
| `assets/data/` | Source of truth: `albums.json`, artist and category tables, `media.json` (track audio paths) |
| `src/` | Shared app: catalog model, search, player, library, offline downloads, UI |
| `platforms/web/` | PWA entry point, service worker, manifest, icons |
| `platforms/desktop/` | Electron main process |
| `worker/media/` | Cloudflare Worker that streams audio from R2 at `media.zaideih.com/audio/:id` |
| `tools/` | Catalog compiler, media path tool, platform build |
| `docs/architecture.md` | Design decisions and data flow |
| `docs/worker-audio.md` | Deploying and checking the audio Worker |

Data tools are dry runs by default; `--apply` writes. See [docs/architecture.md](docs/architecture.md) for the catalog, audio and offline design.

## Contributing

Zaideih is a labor of love supported by the community and friends (special thanks to **Thang Biak Lal, Paupi, and Cinpu**).

- ⭐ Star the project
- 🐛 Report issues
- 🔧 Submit pull requests

---

## Todo

- [ ] Ingest tool for new albums (replaces the Django `scan_library` and `compile_catalog` commands)
- [ ] Play counts from the audio Worker's `tracks_status` table back into `albums.json`
- [ ] Lyrics from `assets/lyric/`
- [ ] Desktop packaging (installers) and downloads saved as files

---

*Zaideih — Preserving the melody of the Zo people for generations to come.*
