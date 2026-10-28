# Audio studio

Most of the catalog was recorded from cassette tapes with a handheld recorder: before the music there is tape hiss, wind, handling noise or silence, and after it the tape runs on. The audio studio trims a song's recording at its start and end, on the files in R2, without a release. The app's live **Skip silence** (core/sound.js) does the same while a song plays, but only where Web Audio runs (not on iPhone and iPad, where iOS stops it when the screen locks), and with a short muted jump at the start; a trimmed file starts with its music everywhere: phones, car stereos, downloads.

## Who

The owner and co-owners, and members given the **Audio studio** right (Workspace, Members), like any right.

## The page (`#/audio/<track>`, `src/ui/audio-studio.js`)

From a song's menu, **Trim in the audio studio** (shown to those with the right). The page is a studio page (the sidebar narrowed to icons; the title bar in the installed desktop app). It is one guided card, with Fine-tune and the History folded under it.

- **The verdict.** The page reads the original recording (version 0) and says what it found, in a chip and a sentence: **Safe to cut** (only steady tape noise is cut), **Check this one** (a quiet sound apart from the music is kept: listen first), or **Nothing to cut**. A cut set by hand says **Set by hand**; a song already trimmed opens on the cut that plays, **Version *n* plays**.
- **One picture.** The first and the last seconds are drawn close up (12 s, or more to hold the cut), and the middle is folded into a short strip, so a few seconds of hiss on a song of minutes can be seen. What is cut is striped and labelled (`Cut · 4.0 s · tape noise`); the tape kept for safety is grey (`1.0 s kept`); a quiet sound kept is outlined in blue (`Quiet sound · kept`). The drawing is on a level scale (−60 dB to full), so the hiss shows, not only the music. On a phone the labels are said in lines under the picture. A recording of 40 s or less is drawn whole.
- **Moving a cut.** Each end's cut is dragged on its part of the picture; a tap on the folded middle listens from there. Where a cut holds sound clearly louder than the tape, that part is outlined and the page says so (**The cut at the start goes into the sound**), with **Back to the suggestion**; saving still works (**Save anyway**).
- **Checking.** **Check the start** plays the last 2 s that are cut, a short tone, then the first 3 s that stay: the join as it will be heard. **Check the end** plays the last 3 s that stay, the tone, then what is cut. They play the decoded original, before anything is saved.
- **Saving.** One button, **Save · cut 7.1 s**, without a further question: the saved state follows at once, with **Listen to the saved file** (the file as the Worker serves it, not a preview), **Undo** (the version played before plays again; the new version stays in the history; the page keeps the cut, to be changed and saved again) and **Next song in the album**.
- **Fine-tune** (folded): each cut's time typed (minutes:seconds), steps of 0.1 s and 1 s, **Play across the cut** (3 s either side, nothing left out), **Move each cut to the quietest moment within 0.15 s** (on: each cut lands on the quietest 20 ms nearby, where a cut is not heard), a note for the history, **Back to the suggestion** and **Cut nothing**. Keys, while nothing is being typed: ← → move the cut 0.1 s (Shift: 1 s), `[` `]` choose the start or the end, Space checks it, Ctrl+S (⌘S) saves.
- **History** (folded): every version and the original, which one plays now, who made each and when. **Listen** plays the file itself; **Play this one** makes any version, or the original, the one everyone hears.

The page keeps its state while the app reads the list of trimmed songs again (after a save, and every five minutes): it is not drawn again from the start.

## The suggestion (`src/core/trim.js`)

Cautious by design: a cut that takes music away is worse than a second of hiss left in.

- **Levels** in 20 ms windows. **The tape's floor**: the quieter of the median levels of the recording's first and last 3 s (where the tape runs) and of its quietest 2 %, digital silence left out. A share of the whole recording alone would find quiet music: hiss is usually a few seconds of a song of minutes.
- **Sound**: 6 dB above the floor for 0.2 s or more (the median of 7 windows, so a click does not count). **The music**: 12 dB above the floor and no more than 20 dB under the recording's loud parts (its ninetieth percentile), for most of 0.6 s.
- **The cut** keeps 1 s of tape before the first sound and 2 s after the last; a cut under 0.3 s is not made.
- **Check**: sound that starts more than 1 s before the music, or goes on more than 3 s after it, is a quiet sound apart from the music (a hum, a count-in, a voice, a long fade): it is kept and marked. What would be cut but is not steady, as tape noise is (its levels spread more than 9 dB), is not cut and is marked too.
- **Nothing to cut**: no steady noise long enough at either end, or no music found above the tape.

## The audio Worker (`worker/media/audio-edits.js`, `worker/media/mp3.js`)

| Route | Who | What |
|---|---|---|
| `GET /edits` | anyone | `{ at, tracks: { <track>: [version, durationMs] } }`: songs whose current version was set (made the original again: `[0, null]`); cached a minute |
| `GET /edits/:track` | Audio studio right | the versions (cut times in the original, length, bytes, note, who, when), the current one, the latest changes |
| `POST /edits/:track {startMs, endMs, base, note, plan}` | Audio studio right | a new version, cut from the original; `base` is the version it was made against (another current meanwhile: 409); `plan` is the cut as the studio planned it (below) |
| `POST /edits/:track/restore {version, base}` | Audio studio right | that version (0: the original) the one played |

**Cutting without loss.** An MP3 is a chain of frames of about 26 ms each. A cut keeps the frames between the two times, byte for byte: nothing is decoded or encoded again, so the sound loses nothing, and it takes a moment. The ID3 tags at the start and the end are kept. A Xing/Info (or VBRI) first frame describes the whole song (frame and byte counts, seek table), so a new Xing/Info frame is written for what is kept (Xing when the bitrate varies; none when the original was constant bitrate without one). The LAME extension (encoder delay, gapless padding) is not carried over. The first frame kept may borrow bits from frames cut away (the bit reservoir) and is then silent, one frame; cuts are set in quiet tape, where that is not heard. Times are snapped to frame edges and answered as cut.

**Who scans the file.** The studio has the whole recording (it read it for the waveform), so it finds the frames there (`mp3.js scan`, before decoding, which takes the bytes away) and sends the cut as a plan: the file's size, where the ID3 tag ends, the first frame kept and the frames kept, the byte range of the sound kept and the last frame's offset, the ID3v1 tag's offset, and the Xing/Info frame it wrote (base64). The Worker checks the plan against the original in storage — the same size; a frame at the start and at the end of the range, of one version and sample rate, the last ending where the range does; a whole Xing/Info frame — with two reads of four bytes, then copies the ranges from storage to the new object, streamed (`FixedLengthStream`): it never reads the recording whole, so a long recording costs it neither memory nor CPU time. A plan that does not fit is refused (422) and nothing is made. Without a plan (an older app build) the Worker reads and scans the original itself, up to `MAX_BYTES` (40 MB).

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
