# Zaideih desktop

Electron shell around the shared app in `src/`. The renderer is built by `tools/build.mjs --platform desktop` into `app/` and served over `app://zaideih`.

```bash
npm install     # installs Electron (this package only)
npm start       # builds the renderer from the repository root, then launches the app
```

The catalog is bundled, so browsing works without a connection. Songs stream from the audio Worker; downloaded songs are stored in the app's IndexedDB and play offline. See `docs/architecture.md` for the security settings.

Packaging into installers is not set up yet.
