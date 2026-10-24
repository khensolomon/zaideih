# Lyrics

Lyrics of catalog songs, added and corrected by listeners who sign in, read by everyone.

Status: agreed 2026-10-22; built in v26.10.24.14.

## Rules

- Anyone signed in (and not blocked) adds or edits the lyrics of a catalog song. They appear for everyone at once.
- Every version is kept, with who saved it and when. A bad edit is undone by restoring an earlier version, which becomes the newest; nothing is lost.
- The Lyrics right (given on the admin page, Members; the owner and co-owners hold it too) sees every version, hides lyrics with a reason, shows them again, and restores an earlier version. Hidden lyrics are not shown to listeners; members cannot edit them, and are told the reason.
- Saving starts from the version the editor opened. When someone else saved first, the save is refused (409): the editor keeps their text and is shown the newer lyrics, and saving again replaces them knowingly.
- Uploads (members' own songs) have no lyrics for now.

Text is kept as typed, tidied: NFC, `\n` line ends, no spaces at line ends, no blank lines at either end, at most one blank line in a row. At most 20,000 characters.

## Formats

Lyrics are kept exactly as typed; their structure is read when they are shown (`src/core/lyrics-format.js`). Nothing is refused: what is not recognised is shown as written. The formats can be mixed.

| Format | Written as | Shown as |
|---|---|---|
| Sections (Genius style) | `[Verse 1]`, `[Chorus]`, `[Pre-Chorus]`, `[Bridge x2]`, `[Outro]` on a line of their own | A small label over each part |
| Hymnbook | `1.` opening a verse (labelled by its number alone, as hymnbooks print it); `Chorus:`, `Sakkik:` or `Refrain:` on its own line, or before the first words | The same; a chorus written once, after the first verse, is shown again after every later verse, as it is sung |
| A recalled chorus | `[Chorus]` (or `{chorus}`) with nothing under it | The last chorus again, dimmed |
| ChordPro | `{key: G}` `{capo: 2}` `{tempo: 72}` `{time: 3/4}`, `{soc}` … `{eoc}` (and verse, bridge, tab), `{c: softly}`, chords inline: `A[G]mazing [C]grace` | Details as chips; sections; notes; chords |
| Chord sheet | A line of only chords above the words, lined up by column | Chords over the words |
| Details, plain | `Key: G`, `Capo: 2`, `Tempo: 72` at the very top | Chips |
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

The editor has **Write** and **Preview**, buttons that insert `[Verse]`, `[Chorus]` and the other parts on a line of their own, a line saying what it recognises as the text is typed, and a short guide. A chord sheet is edited in a fixed-width font so the chords stay over their words.

## App

| Part | File |
|---|---|
| Page `#/lyrics/<song id>`: reading, editing, the Lyrics right's versions | `src/ui/lyrics-view.js` |
| Reading the structure (sections, chords, timing), transposing | `src/core/lyrics-format.js` |
| Drawing it | `src/ui/lyrics-render.js` |
| Reading (kept on the device for offline), saving, the Lyrics right | `src/core/lyrics.js` |
| Entry points: the Lyrics button in Now playing, and Lyrics in a song's menu | `src/app.js` |

Lyrics once read are kept on the device (IndexedDB `kv`, `lyrics.<song id>`), so they show offline. Online, the Worker is asked each time; its edge cache answers without touching D1.

## Worker

`worker/media/lyrics.js`:

| Route | Who | Does |
|---|---|---|
| `GET /lyrics/:song` | anyone | `{track, version, text, updated}`, or 404 when there are none (or they are hidden). Kept in the edge cache (`caches.default`) until the next change; browsers keep it 5 minutes |
| `POST /lyrics/:song {text, base}` | signed in | Saves the next version when `base` is the latest (0 for new lyrics); otherwise 409 `{error, current}`. The same text again saves nothing |
| `GET /lyrics/:song/versions` | Lyrics right | `{version, hidden, versions: [{version, text, at, note, by: {id, name}}]}` |
| `POST /lyrics/:song/hide {reason}` | Lyrics right | Hides them; the reason (1 to 300 characters) is shown to whoever tries to edit them |
| `POST /lyrics/:song/show` | Lyrics right | Shows them again |
| `POST /lyrics/:song/restore {version, base}` | Lyrics right | That version's text becomes the newest version (note "restored version N") |

D1:

| Table | Holds |
|---|---|
| `lyrics` | per song: the shown `version` and `text`, `updated_at`, `updated_by` (member id), and `hidden_at`, `hidden_by`, `hidden_reason` |
| `lyrics_versions` | every version: `(track, version)`, `text`, `member_id`, `at`, `note` |

A save is one D1 batch (the version row and the shown lyrics), each written only when the latest version is still `base`. Every change removes the song from the edge cache. Joining two accounts moves their versions to the kept member.

## Backups

The lyrics cannot be rebuilt from git: `tools/d1.mjs reset` keeps them like the other personal tables, and

    node tools/d1.mjs lyrics            # counts, and where the file would go
    node tools/d1.mjs lyrics --apply    # writes build/d1/lyrics-<date>.json (or --out <file>)

writes what is shown and every version (format `zaideih-lyrics/1`), with member ids only, no names or emails.
