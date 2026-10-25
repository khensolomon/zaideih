# Lyrics

Lyrics of catalog songs, added and corrected by listeners who sign in, read by everyone.

Status: agreed 2026-10-22; built in v26.10.24.14; formats v26.10.24.16; the studio, credits, reports and the Zawgyi check v26.10.24.18; translations, search by lyrics, the mark on songs with lyrics and lyrics in Now playing v26.10.24.19; shared lyrics v26.10.24.27; similar titles and find v26.10.24.30; proposals, compare and merge v26.10.24.32.

## Rules

- Anyone signed in (and not blocked) adds or edits the lyrics of a catalog song. They appear for everyone at once.
- Every version is kept, with who saved it and when. A bad edit is undone by restoring an earlier version, which becomes the newest; nothing is lost.
- The Lyrics right (given on the admin page, Members; the owner and co-owners hold it too) sees every version, hides lyrics with a reason, shows them again, and restores an earlier version. Hidden lyrics are not shown to listeners; members cannot edit them, and are told the reason.
- Saving starts from the version the editor opened. When someone else saved first, the save is refused (409): the editor keeps their text and is shown the newer lyrics, and saving again replaces them knowingly.
- Anyone signed in reports lyrics that are wrong or should not be here (one open report per member, song and language). The Lyrics right sees the reports in the studio's History and on the admin page (Lyrics); hiding, showing, restoring, or "Nothing to change" deals with them.
- A member saves at most 30 versions an hour (429 beyond, the text staying in the studio); the Lyrics right has no cap.
- Myanmar text must be Unicode. Text in the Zawgyi encoding is refused (422) with a clear message, by the studio before saving and by the Worker; it is never converted, the writer converts it first.
- Uploads (members' own songs) have no lyrics for now.

Text is kept as typed, tidied: NFC, `\n` line ends, no spaces at line ends, no blank lines at either end, at most one blank line in a row. At most 20,000 characters.

## Translations

A song has its own words (lang `""`, "Original") and may have translations: English (`en`) and Myanmar (`my`). Each is kept on its own, with its own versions, reports and hiding; every route takes `?lang=` (none: the original). A translation may be written before the original.

- Reading (`#/lyrics/<song>?lang=en`): when a song has translations, a switch (Original, English, Myanmar) shows the ones it has. A translation is shown beside the original, part beside part when both have the same parts (else in two columns); on phones the translation is under each part, smaller. "Translation only" turns that off (kept on the device, `zaideih.lyrics.side`).
- The studio (`#/lyrics/<song>/studio?lang=en`): a language picker in the header (the languages without lyrics yet are marked "none yet"); translating, the song's own words are there for reference (open or closed). Drafts are kept per language. Parts are inserted with English names (Verse, Chorus).
- The admin page's Lyrics list marks translations.

## Shared lyrics

The same song is often recorded again on other albums, by the same singer or another, with the same words. Such recordings share one text instead of keeping copies.

- **Who links**: anyone may contribute; only those with the Lyrics right change what others rely on. A song without lyrics, or "Same song as another?" under a song's lyrics, offers the songs with lyrics whose title is the same or close (`src/core/titles.js`: compared without case, spaces, punctuation or symbols; close is at most about a quarter of the letters different, or one title inside the other, as when a subtitle is added; a song sung again often has its title written another way, such as "သားသမီးတိုင်းအတွက်ယေရှု" and "သားသမီးတိုင်းရဲ့ယေရှု"), the same title first, then the closest, the same artist first, each with its first line and "Same title" or "Similar title". A field under them finds any song with lyrics by its title, an artist, its album or a line of its words. Many different songs share a title, so nothing is linked by itself. A member says **Same song**: a proposal, waiting in Admin → Lyrics. A link asked for by a member without the Lyrics right (as older app builds offer) is answered 403, saying it was sent as a proposal instead, and the proposal is recorded. The Lyrics right uses the lyrics of a song (**Use these lyrics**), or, when both songs have lyrics, **Compare**s them to merge.
- **Merging** (the Lyrics right, `src/core/lyrics-merge.js`): the two copies side by side, compared by their sung words, line by line, each once: chords, times, details, part names, spacing, punctuation, repeat marks ("x2") and a part written out again are not differences. Lines found in only one are listed. The copy worked on most is suggested, with its reasons (versions, people, lines, timing, chords, translations, a recent edit; open reports count against it), and chosen; the other can be chosen instead. After merging there is one text; the other song's own text and history stay with it, hidden ("merged into song N", listed in its studio's history), its timing stays its own, a translation only it had goes to the kept text, and songs that showed its text show the kept one. "Give it a copy of its own" brings its text back as its own, its history continuing.
- **One text**: a correction, a translation, hiding or restoring, made from any of the recordings, is one for all of them. The lyrics page and the studio name the other recordings ("Also sung on …").
- **Timing is each recording's own**, since a song sung again often has another tempo. A shared text keeps no times; each recording's are kept apart, put into the text it reads and taken out of the text it saves. Timing a recording makes no new version of the words. When a text is shared for the first time, the times in it are its own recording's: they move apart, and a version without them is saved (note "shared with song N; each recording keeps its own timing").
- **Never over lyrics**: a song with lyrics of its own is linked only by merging (`merge: true`), never over its text by accident. A song already linked is not linked again until it is unlinked. A link to a linked song goes to the song that has the text, and songs that showed the linked song's text move to that source too: a link is never two steps.
- **Undoing** is for the Lyrics right, in the studio of the linked song: "Give it a copy of its own" writes the text, with that recording's timing, as its own first version (note "copied from song N"), and from then on it changes on its own; hidden texts are not copied. "Unlink" leaves it without lyrics. The shared text stays with the others either way. When the last linked recording leaves, the text is no longer shared and the source's own timing is written back into it (a version with the note "no longer shared; its own timing is back"). Unlinked rows are kept (`unlinked_at`), for the index and the record.

## Search

`src/core/lyrics-index.js` keeps every shown text's words on the device (IndexedDB `kv`, `lyrics.index`), from `GET /lyrics/index`: in full once, then only what changed since (`?since=`), at start and when the app comes back into view (at most every 30 minutes), and at once after saving in the studio. Searching is then offline and instant:

- The search page lists **In the lyrics**: songs with a line holding every word of the query (normalised as the app's search does: case, accents, spacing), the line shown, best first (the words together as typed, then a line starting with them). One line per song, the original before a translation (marked "(English)"). Under three letters, nothing. Shown also when no title matches.
- Songs with lyrics carry a small mark after their title in song lists.

The words are what is sung (`lyricsWords`): each line once, without times, chords, details or notes, the original title first. The Worker keeps them with the lyrics (`lyrics.words`) and fills them for texts saved before. The index's size grows with the lyrics: about 250 KB per 1,000 songs; past several thousand songs, searching moves to the Worker (D1 full-text search).

## In Now playing

The player sheet's top bar has a lyrics button (kept on the device, `zaideih.np.lyrics`). On, the lyrics take the cover's place on phones (above the title and controls) and the queue's on wide screens (`src/ui/np-lyrics.js`). Timed lyrics light the line being sung and keep it in the middle of the panel (not while the listener scrolled it in the last 4 seconds); tapping a timed line goes there. Lyrics read once are kept while the app is open; saving in the studio reads them again.

## Formats

Lyrics are kept exactly as typed; their structure is read when they are shown (`src/core/lyrics-format.js`). Nothing is refused: what is not recognised is shown as written. The formats can be mixed.

| Format | Written as | Shown as |
|---|---|---|
| Sections (Genius style) | `[Verse 1]`, `[Chorus]`, `[Pre-Chorus]`, `[Bridge x2]`, `[Outro]` on a line of their own | A small label over each part |
| Hymnbook | `1.` opening a verse (labelled by its number alone, as hymnbooks print it); `Chorus:`, `Sakkik:` or `Refrain:` on its own line, or before the first words | The same; a chorus written once, after the first verse, is shown again after every later verse, as it is sung |
| A recalled chorus | `[Chorus]` (or `{chorus}`) with nothing under it | The last chorus again, dimmed |
| ChordPro | `{key: G}` `{capo: 2}` `{tempo: 72}` `{time: 3/4}`, `{soc}` … `{eoc}` (and verse, bridge, tab), `{c: softly}`, chords inline: `A[G]mazing [C]grace` | Details as chips; sections; notes; chords |
| Chord sheet | A line of only chords above the words, lined up by column | Chords over the words |
| Details, plain | `Key: G`, `Capo: 2`, `Tempo: 72`, `Time: 4/4` at the very top | Chips |
| Credits, plain | `Hymn: 167`, `Original title: …`, `Words: …`, `Music: …` (or `Words and music: …`), `Scripture: …` at the very top; ChordPro `{lyricist}`, `{composer}` | A line under the title |
| Notes | A line in brackets: `(spoken)`, `(repeat)` | Small italic |
| Answering part | `(…)` inside a line: another voice, an echo | Lighter, in italics |
| LRC | `[01:23.40] words`, several times on one line, `[offset: +250]`, `[ti:]` `[ar:]` | Timed lines (below) |

Without any section names, a block of two or more lines that comes back the same is taken for the chorus.

Section names are matched on the start of the label, followed only by a number, a repeat (`x2`, `(2x)`) or a singer (`Chorus - Lal Pa`), so a line of words such as "Verse of my life" stays words. The names are in `SECTION_WORDS`: English; Myanmar သံပြိုင် (chorus) and အပိုဒ် (verse); Zolai Sakkik (chorus) and Tang (verse). An unknown name in brackets (`[Lasak]`) is shown as a label of its own. Names used in Mizo and Falam hymnbooks belong in that list.

Chord names: a root A to G with `#`, `b`, `♯` or `♭`; a quality (`m`, `maj`, `min`, `dim`, `aug`, `sus`, `add`, `°`, `ø`, `+`); extensions; a bass (`/F#`); or `N.C.`. Words that only look like chords ("Ama", "Am I") are left as words: a chord line holds nothing but chords.

## How lyrics are shown

`src/ui/lyrics-render.js`:

- Each part is labelled in small capitals. The chorus has a bar down its side and stronger weight; the pre-chorus a dashed bar; the bridge a shaded box; intro, outro, interlude and spoken parts are in italics. A repeat shows as `×2`.
- Key, capo, tempo and time are chips under the title.
- Chords are hidden until **Show chords** (the choice is kept on the device, `zaideih.lyrics.chords`). Shown, each chord sits over the syllable it starts on, and **−** / **+** transpose by a semitone (from −5 to +6), the key chip following ("A (from G)"). A song written with flats keeps to flats.
- Timed lyrics (LRC) show without their times. While that song plays, the line being sung is lit and kept in view (not while the listener has scrolled by hand in the last 4 seconds), and tapping a line goes there.

The page's head: the album cover (to the album), the title, and on the line under it Play (a round icon) with whether this song is the one playing: moving bars and "Playing", or "Paused"; then the artists and the album, as links. Play starts this song, from it on in its album; on the song playing, it pauses and resumes. When the song ends and another plays while the page is open, a line says what plays now, with the way to its lyrics. **Share** gives the page's link (the device's share sheet, or the link copied).

Credits show as a line under the title ("Hymn 167 · *Waiting on the Lord* · Words and music: … · Luk. 24:49"). The text size (A− / A+, four steps) is kept on the device (`zaideih.lyrics.size`).

## Studio

`#/lyrics/<song id>/studio` (`src/ui/lyrics-studio.js`): the whole page is for writing one song's lyrics, while the song plays in the app's own player. The sidebar narrows to icons while it is open (not saved as the listener's choice); on phones the studio's header replaces the floating bar.

The header: back to the lyrics, the song, the state ("Draft kept on this device", "Version 3"), four modes as icons with their names as hints (**Write**, **Preview**, **Timing**, and **History** for the Lyrics right), and **Save** as a round check ("Save as version 4"; Ctrl or Cmd + S).

- **Write.** The words are in a real `<textarea>`, so phone keyboards, Myanmar input, spell-check and undo work as everywhere. Under it, a layer draws the same text with what is recognised tinted (verse numbers, section names, chords, times, answering parts); the margin labels each part at its first line, with a bar along it (silver for the chorus) and "↻ Sakkik" where a chorus is sung again without being written. The details at the top of the lyrics are chips above the text, not lines in it: a chip changes or removes its detail, **+** adds one (`setDetail` writes the top lines; `splitDetails` keeps them apart from the words). On wide screens a **+** in the margin beside the line being written inserts a part (Tang, Sakkik for Zolai songs; Verse, Chorus otherwise; numbered in hymnbook lyrics), a chord, an answering part `( )` or a note; on phones the same row sits above the keyboard, with the app's player lifted above it (`--kb`, app.js).
- **Preview.** The lyrics as listeners will see them, credits and chords included.
- **Timing.** The lines in the order they are sung, a chorus sung again included. Play the song (from it, in its album) and tap as each line starts; the time is the player's exact position. Times are written into the text as LRC (`1. [00:12.50]Topa ngak ta un`); a line sung again carries a time for each time it is sung (`[00:33.80][01:40.10]Vang-liat-na!`), and the reader gives them to the repeats in order. Tapping a line in the list goes back to it (the song goes to just before the line before it); "Undo last tap" and "Clear all times".
- **History** (the Lyrics right). Open reports with "Nothing to change", hide (with a reason) or show, and every version with "Restore"; a merged song's own earlier history listed apart; on a linked song, "Give it a copy of its own" and "Unlink".

The merge panel (the Lyrics right) opens from **Compare** in the studio's "Same song as another?" list, or from a proposal's Compare on the admin page: `#/lyrics/<song>/studio?merge=<other song>&proposal=<id>`. Merging there answers the proposal.

Drafts: what is typed is kept on the device as it is typed (IndexedDB `kv`, `lyrics.draft.<song id>[.<lang>]`, with the version it started from), and written at once when the page is left, so a closed tab loses nothing. Coming back continues the draft ("Continuing your draft from 10:42"); when someone saved since, saving shows their version to compare. "Discard changes" goes back to the saved version. Saving clears the draft.

Banners: text in Zawgyi (Save is off until it is Unicode); text copied from sheet music, words split into syllables ("To - pa"), with **Join syllables** (hyphens inside words stay); someone else saved meanwhile.

## App

| Part | File |
|---|---|
| Page `#/lyrics/<song id>`: reading, text size, reporting | `src/ui/lyrics-view.js` |
| The studio `#/lyrics/<song id>/studio` | `src/ui/lyrics-studio.js` |
| Proposals waiting, recent edits and reports for the Lyrics right (admin page, Lyrics); declining a proposal | `src/admin/admin.js` |
| Offering and finding the same song: similar titles, the find field, Same song, Use these lyrics, Compare | `src/ui/lyrics-share.js` |
| Comparing titles (same or close) | `src/core/titles.js` |
| Comparing two copies by their sung words, and which to keep (the studio's `?merge=`) | `src/core/lyrics-merge.js` |
| Reading the structure (sections, chords, timing, details), transposing, the Zawgyi check, joining syllables, writing details and times back | `src/core/lyrics-format.js` |
| Drawing it | `src/ui/lyrics-render.js` |
| Reading (kept on the device for offline), saving, reporting, proposing, drafts, the Lyrics right (hide, show, restore, link, unlink, compare) | `src/core/lyrics.js` |
| Entry points: the Lyrics button in Now playing, and Lyrics in a song's menu | `src/app.js` |

Lyrics once read are kept on the device (IndexedDB `kv`, `lyrics.<song id>[.<lang>]`), so they show offline. Online, the Worker is asked each time; its edge cache answers without touching D1.

## Worker

`worker/media/lyrics.js`:

| Route | Who | Does |
|---|---|---|
| `GET /lyrics/:song` | anyone | `{track, lang, version, text, updated}`, with `shared` on a linked song, or 404 when there are none (or they are hidden). Kept in the edge cache (`caches.default`) for 10 minutes, a 404 for 60 seconds; browsers keep it 5 minutes |
| `POST /lyrics/:song {text, base}` | signed in | Saves the next version when `base` is the latest (0 for new lyrics); otherwise 409 `{error, current}`. The same text again saves nothing |
| `GET /lyrics/:song/versions` | Lyrics right | `{track, source, lang, version, hidden, versions, own, reports}`; each version `{version, text, at, note, by: {id, name}}`; `own` is a merged song's earlier history |
| `POST /lyrics/:song/hide {reason}` | Lyrics right | Hides them; the reason (1 to 300 characters) is shown to whoever tries to edit them |
| `POST /lyrics/:song/show` | Lyrics right | Shows them again |
| `POST /lyrics/:song/restore {version, base}` | Lyrics right | That version's text becomes the newest version (note "restored version N") |
| `POST /lyrics/:song/report {reason}` | signed in | A report (1 to 300 characters); a second one by the same member replaces the first |
| `POST /lyrics/:song/resolve` | Lyrics right | Its open reports dealt with, nothing changed |
| `GET /lyrics/index?since=<seconds>` | anyone | `{at, songs: [[track, lang, version, words]], gone: [[track, lang]]}`: with since 0, every shown text (edge cached for 10 minutes); later, what changed since (hidden texts as gone). `at` is the next `since` |
| `POST /lyrics/:song/propose {to, note}` | signed in | A proposal that the song is the same as song `to`; one open per member and song (a second replaces the first), at most 20 open per member |
| `POST /lyrics/:song/link {to, merge, keep, proposal}` | Lyrics right | The song shows the lyrics of song `to` (or of the song `to` shows); songs that showed this song's text show the new source's. A song with lyrics of its own is refused (409) unless `merge: true`, with `keep` "track" or "to" naming the text kept. Proposals between the two (and `proposal`) are done. Answers its lyrics, with `shared`. Signed in without the right: recorded as a proposal, answered 403 saying so |
| `GET /lyrics/:song/compare?with=<song>` | Lyrics right | `{a, b}`: each song's shown text (its source's), versions, people, last update, languages, open reports |
| `POST /lyrics/:song/decline {proposal, reason}` | Lyrics right | The proposal numbered `proposal` (required) declined; the reason (1 to 300 characters) is kept with the proposal. Members are not shown it yet |
| `POST /lyrics/:song/unlink {copy}` | Lyrics right | No longer shared; with `copy: true`, it keeps a copy of the text and its timing as its own (hidden texts excepted). When it was the last linked recording, the source's own timing goes back into its text. `{track, source, copied}` |
| `GET /lyrics/recent` | Lyrics right | `{proposals: [open, oldest first], edits: [the 50 latest versions, with song, member and whether hidden], reports: [songs with open reports, with each reason]}` |

`GET /lyrics/:song/versions` also lists the song's open reports. Hiding, showing and restoring deal with them. A POST to an address without a POST route (such as `/versions`) answers 404; restoring is only `/restore`.

On a linked song, every route reads and writes the shared text (the `source` song's): versions, hiding, restoring, reports. Its answer carries `shared: {source, with: [the other songs]}` and the song's own timing; a save takes the times out of the text, keeps them for the song, and saves the words to the source (no new version when only the times changed). The index lists every linked song with the shared words, and an unlinked one as gone.

D1:

| Table | Holds |
|---|---|
| `lyrics` | per song and language `(track, lang)`: the shown `version` and `text`, `words` (for searching), `updated_at`, `updated_by` (member id), `hidden_at`, `hidden_by`, `hidden_reason`, `changed_at` (the last save, hide or show) |
| `lyrics_versions` | every version: `(track, lang, version)`, `text`, `member_id`, `at`, `note` |
| `lyrics_reports` | reports: `track`, `lang`, `member_id`, `reason`, `at`, `resolved_at`, `resolved_by` |
| `lyrics_links` | shared lyrics: `track` shows the text of `source`; `member_id`, `at`; `unlinked_at`, `unlinked_by` once undone |
| `lyrics_proposals` | proposals that `track` is the same song as `target`: `member_id`, `note`, `at`, `status` (open, done, declined), `decided_by`, `decided_at`, `reason` |
| `lyrics_times` | one recording's timing of a shared text: `(track, lang)`, `times` (JSON, a list of seconds per sung line, in order), `member_id`, `at` |

`migrations/0002-lyrics-languages.sql` brings a database from before translations to this shape (the lyrics there become originals); `node tools/d1.mjs schema --apply` runs it once. The backup (`tools/d1.mjs lyrics`, format `zaideih-lyrics/3`) carries the language, the links and each recording's timing. `migrations/0004-lyrics-links.sql` adds the two tables of shared lyrics; `migrations/0005-lyrics-proposals.sql` the proposals.

A save is one D1 batch (the version row and the shown lyrics), each written only when the latest version is still `base`. Every change removes the song from the edge cache, but a Cache API delete reaches only the data centre that ran the change: elsewhere the change shows once the copy there ends, which is why answers are kept only 10 minutes (`EDGE_S`; 60 seconds for "no lyrics", `EDGE_MISS_S`). Joining two accounts moves the other member's lyrics versions, reports, proposals, links and timing to the kept member.

## Backups

The lyrics cannot be rebuilt from git: `tools/d1.mjs reset` keeps them like the other personal tables, and

    node tools/d1.mjs lyrics            # counts, and where the file would go
    node tools/d1.mjs lyrics --apply    # writes build/d1/lyrics-<date>.json (or --out <file>)

writes what is shown and every version, which songs share another's lyrics, and each recording's timing of a shared text (format `zaideih-lyrics/3`), with member ids only, no names or emails.
