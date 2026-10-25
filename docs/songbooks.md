# Songbooks

Status: proposed 2026-10-25, not built. To be agreed before any part is built.

Hymnals and praise books (Tedim Labu, Galhiam and others) as lyrics collections of their own: texts with no recording in Zaideih, found by book and hymn number, searchable, and joined to the recordings that sing them. Built on the lyrics system (docs/lyrics.md), which already keeps versions, history, reports, translations and shared texts.

## What is known

- Books number their hymns (hymn numbers, not page numbers). Numbers belong to one edition of a book.
- Texts come from printed books, so they are scanned and corrected.
- Rights are not settled for any book yet. Texts are entered and edited now, and shown to the public only once a book's rights are settled.
- Credits matter as much as the words: who wrote the words, who wrote the music, the tune, who translated, from which original. These are linked records, not free text.

## The model

Four kinds of record, each with an id of its own, kept in D1 beside the lyrics (no release needed to add or change them):

| Record | Holds | Example |
|---|---|---|
| **Person** | name, other spellings, years, a short note | Fanny Crosby; a Tedim translator |
| **Work** | the hymn as a work, whatever its language: original title and language, words by (people), music by (people), tune name, metre, year, scripture, topics | "Blessed Assurance", words Fanny Crosby, music Phoebe Knapp, tune ASSURANCE, 9.10.9.9 |
| **Text** | one singable version of a work in one language: its words (the lyrics, versioned as today), translated by (people), translated from (another text) | the English original; the Tedim text |
| **Book** and **entry** | a book (title, short name such as "TL", language, edition, year, publisher, rights: unsettled, permission or public domain); an entry is a hymn number in a book, printing one text | Tedim Labu 145 prints the Tedim text |

Joined like this:

```
Person ── wrote words / music ──▶ Work ◀── is a version of ── Text ◀── prints ── Entry (Book, number)
Person ── translated ─────────────────────────────────────────▶ Text ◀── sings ── Recording (catalog track)
```

- One work has many texts (the original and its translations); one text can be printed in several books under different numbers; one text is sung by any number of recordings.
- A recording joins a text the way shared lyrics join recordings today (`lyrics_links`): the text is the source, each recording keeps its own line timing. Recordings already typed in can be merged into the book's text with the merge that exists.
- Two kinds of translation stay apart: a **singable version** (its own text, its own book numbers) and a **meaning translation** shown beside the words (today's `lang` variants, English and Myanmar). Both are kept.
- The free-text details lyrics have now (Hymn, Original title, Words, Music, Scripture: `DETAILS` in lyrics-format.js) become these links once a text belongs to a work; for a recording without a work they stay as they are.

## Rights and who sees what

- A book is **private** until its rights are set to permission or public domain: its entries, their texts and their search words are seen only by those with the Songbooks right, and a recording joined to a private text does not show that text to the public.
- Making a book public is one switch, by the owner or a co-owner, with the rights note required.
- A new **Songbooks** right (given in Members, like any right) creates books, people and works, and edits entries; members can correct texts of public books as they correct lyrics now.

## Scanning

- Tedim and other Latin-script books: the phone's own text recognition (Live Text on iPhone, Google Lens on Android) already reads a page well, at no cost and with nothing to add to the app. The page's text is pasted into an import screen that splits it at hymn numbers into entries, as drafts to correct, never saved unseen.
- Myanmar-script books need real recognition (docs/TODO.md, "typing in a scanned page"): a library in the app or a vision model on the server, each with its cost. Decided when a Myanmar book is started.
- A command-line import (`tools/songbook.mjs`, dry run unless `--apply`) for a whole book from a text file, for books typed elsewhere.

## In the app

- **Songbooks** in the sidebar and the logo menu: the books (public ones, and private ones marked for those with the right).
- **A book** (`#/book/<id>`): its numbered index, filtered by number or words; "145" jumps to the hymn.
- **An entry** (`#/book/<id>/<number>`): the lyrics page as today, headed "Tedim Labu 145", with the work's credits as links (a person's page lists everything they wrote or translated), other versions of the work, other books printing the same text, and Play when recordings are joined.
- **A recording** joined to a text shows "Tedim Labu 145" under its title.
- **Search**: a line of the words finds the entry as lyrics do now (the index on the device grows entries beside recordings); "Tedim Labu 145" or "TL 145" goes straight to it; people are found by name.

## Steps

Each step is a release of its own, agreed before it starts:

1. Data and Worker: the tables, routes and rights; the Songbooks right; private by default.
2. Import: the paste-and-split screen and `tools/songbook.mjs`.
3. Book and entry pages, people and works.
4. Search and joining recordings to texts (and merging typed-in copies).
5. Workspace: managing books, people and works; making a book public.

## Open questions

- Ids: entries and texts need ids the lyrics tables accept beside track ids. A reserved range (texts from 10,000,000,000 up, far above any track id) keeps every lyrics route working unchanged; a separate column is cleaner but touches every lyrics query. The range is proposed.
- Does a person record join catalog artists when a writer also performs (one person, two records today)?
- Topics and scripture: free text, or fixed lists?
