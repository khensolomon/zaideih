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
npm run build                  # compile the catalog, then build dist/web
npm run build:desktop          # build the desktop renderer into platforms/desktop/app
cd platforms/desktop && npm install && npm start   # run the desktop app
```

| Path | Purpose |
|------|---------|
| `assets/data/` | Source of truth: `albums.json`, artist and category tables, `media.json` (track audio paths) |
| `src/` | Shared app: catalog model, search, player, library, offline downloads, UI |
| `platforms/web/` | PWA entry point, service worker, manifest, icons |
| `platforms/desktop/` | Electron main process |
| `worker/media/` | Cloudflare Worker that streams audio from R2 at `media.zaideih.com/audio/:id` |
| `tools/` | Catalog compiler, media path tool, platform build |
| `docs/architecture.md` | Design decisions and data flow |

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
