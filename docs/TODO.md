# To do

Work agreed for later, with what is known so far. Larger designs get their own document when they start.

## Lyrics: typing in a scanned page (OCR)

Photographing a hymnbook page to fill in the lyrics studio. Browsers have no built-in text recognition that reads Myanmar script (the Shape Detection API's TextDetector is experimental and Latin-only). The two ways known:

- A recognition library in the app (Tesseract.js with Latin and Myanmar language data): several MB to download, against the project's minimal-dependency rule; works offline once downloaded.
- Recognition on the server (Cloudflare Workers AI, a vision model): no download, but a cost per page, and not within the Free plan's limits for regular use.

Either way the result goes into the studio as a draft to correct, never saved directly; sheet-music syllables ("To - pa") are joined as the studio already offers. To discuss before building.

## Home: settling on section titles (phones)

Home should settle on a section's title after a scroll comes to rest near it. CSS scroll snapping was tried and removed (it dragged on iPhone); the settle-after-rest version (`settleOnSections`, app.js) does not settle on the device. To look at again with a device at hand.

## Lyrics search on the Worker

Searching lyrics runs on the device from an index of every shown text (about 250 KB per 1,000 songs with lyrics, docs/lyrics.md "Search"). Past several thousand songs, searching moves to the Worker: a D1 full-text table (FTS5) beside `lyrics`, and the app asking the Worker when online.
