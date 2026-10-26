# Audio studio

Most of the catalog was recorded from cassette tapes with a handheld recorder: before the music there is tape hiss, wind, handling noise or silence, and after it the tape runs on. The audio studio trims a song's recording at its start and end, on the files in R2, without a release. The app's live **Skip silence** (core/sound.js) does the same while a song plays, but only where Web Audio runs (not on iPhone and iPad, where iOS stops it when the screen locks), and with a short muted jump at the start; a trimmed file starts with its music everywhere: phones, car stereos, downloads.

## Who

The owner and co-owners, and members given the **Audio studio** right (Workspace, Members), like any right.

## The page (`#/audio/<track>`, `src/ui/audio-studio.js`)

From a song's menu, **Trim in the audio studio** (shown to those with the right). The page is a studio page (no floating bar on phones; the title bar in the installed desktop app).

- It reads the original recording (version 0) and draws it: the whole song, and close up around the start and the end (six seconds on each side). The drawing is on a level scale (−60 dB to full), so the tape's hiss before and after the music shows, not only the music.
- It suggests where the music starts and ends (`src/core/trim.js`): the recording's level in 20 ms windows; its noise floor from the quieter tenth of them (tape is never digitally silent); the music where the level stays 12 dB above the floor for most of 0.6 s; 0.25 s kept before it and 0.7 s after it (a note dying away). **Use the suggestion** goes back to it; **Back to the whole recording** cuts nothing.
- The cuts are moved by dragging the handles (on the whole recording or a close-up; a close-up holds still while its cut is dragged), by typing the times (minutes:seconds), or by 0.1 s steps. With **Move each cut to the quietest moment nearby** (on), each cut lands on the quietest 20 ms within 0.15 s, where a cut is not heard.
- **What is cut** and **How it starts** / **How it ends** play the edges from the decoded original, before anything is saved. A tap on the whole recording, away from the handles, plays six seconds from there.
- The line under them says what changes: how much is cut at each end, and the song's length after (and now).
- **Save as a new version** asks once more, with the times and the length, then the audio Worker makes the version. An optional note goes into the history.
- **Versions** lists every version and the original, which one plays now, who made each and when. **Listen** plays the file itself as the Worker serves it (the saved result, not a preview); **Make it the one played** makes any version, or the original, current again.

## The audio Worker (`worker/media/audio-edits.js`, `worker/media/mp3.js`)

| Route | Who | What |
|---|---|---|
| `GET /edits` | anyone | `{ at, tracks: { <track>: [version, durationMs] } }`: songs whose current version was set (made the original again: `[0, null]`); cached a minute |
| `GET /edits/:track` | Audio studio right | the versions (cut times in the original, length, bytes, note, who, when), the current one, the latest changes |
| `POST /edits/:track {startMs, endMs, base, note}` | Audio studio right | a new version, cut from the original; `base` is the version it was made against (another current meanwhile: 409) |
| `POST /edits/:track/restore {version, base}` | Audio studio right | that version (0: the original) the one played |

**Cutting without loss.** An MP3 is a chain of frames of about 26 ms each. A cut keeps the frames between the two times, byte for byte: nothing is decoded or encoded again, so the sound loses nothing, and it takes a moment. The ID3 tags at the start and the end are kept. A Xing/Info (or VBRI) first frame describes the whole song (frame and byte counts, seek table), so a new Xing/Info frame is written for what is kept (Xing when the bitrate varies; none when the original was constant bitrate without one). The LAME extension (encoder delay, gapless padding) is not carried over. The first frame kept may borrow bits from frames cut away (the bit reservoir) and is then silent, one frame; cuts are set in quiet tape, where that is not heard. Times are snapped to frame edges and answered as cut.

**Storage.** The original (`music/<folder>/<file>`) is never changed or deleted. Version *n* of a track is `edits/<track>/<n>.mp3`. D1 (migration `0009-audio-edits.sql`): `audio_versions` (each version and its cut), `audio_current` (the version played, when set), `audio_log` (cuts and restores, who and when).

**Playing.** `/audio/:id?v=<n>` plays version *n* (0 the original; an unknown version: 404); without `v`, the current version. A version asked for never changes, so it is cached as before (immutable for ranges); the current version of an edited song, asked without `v`, only for five minutes. The answer carries `X-Zaideih-Version`.

## The app (`src/core/audio-edits.js`)

The app reads `GET /edits` when it starts (the last copy kept on the device at once, offline too) and every five minutes while shown, and at once after a save or restore in the studio. Then:

- an edited song is played as `?v=<version>` (`config.js` `audioUrl`), so a copy of another version kept by a browser is never played instead;
- its length is the version's (`applyEdits`, again after the catalog is rebuilt for album holds);
- a downloaded copy of another version is downloaded again (`offline.refreshVersions`; the copy kept plays until the new one has arrived);
- what Skip silence and Even volume remember of a song (where its music starts, how loud it is) is kept per version, since a trimmed recording starts elsewhere.

## Later

- **Clean**: wind and rumble cut, hiss reduced from a sample of the noise, fades and an even level, which needs the sound decoded and encoded again (in the browser; AAC in an .m4a, which plays everywhere, iOS and car stereos included, and needs no added library).
- **An album at a time**: the suggestion for every song of an album, checked in a list and saved together.
