# Songbooks

Status: agreed 2026-10-25. Step 1 (data and Worker) built in v26.10.25.15, step 2 (import) in v26.10.25.16; steps 3 to 5 to come.

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

### Import (step 2)

- Splitting (`src/core/songbook-import.js`, `splitHymns`): a hymn starts at its number alone on a line with its title on the next line with words, or at its number and its title in capitals on one line. A number alone with no title after it (a page number) and verse numbers ("1. …") are not hymns; a heading is only taken when its number is larger than the hymn before it, and the first one can be named (`from`). Titles in capitals become title case ("LUNGMUANNA KA NEI" → "Lungmuanna Ka Nei"). It says what to check: lines before the first hymn, numbers missing between two hymns, hymns with no words.
- In the app, for the Songbooks right: Songbooks (`#/songbooks`, in the sidebar's Browse and the logo menu, shown only to the right until books are public) lists the books and adds one (title, short name, language, edition, year, publisher; private). A book's **Add pages** (`#/songbooks/import?book=<id>`) takes pasted pages, shows the hymns found with their titles to correct and numbers already in the book greyed out (left as they are), and adds the rest one by one: the number and title, then the words as the text's first version. Adding stops at the first failure and says which hymn; what was added stays.
- From a file: `node tools/songbook.mjs split <file> [--from N]` shows the hymns found; `import <file> --book <id> [--from N] [--apply]` adds them the same way, signed in with `ZAIDEIH_SESSION` (a signed-in device's session token).
- Editing one hymn's words, its page and the book's index come with step 3.

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

## Decisions

- Ids: text ids start at 10,000,000,000 (`TEXT_BASE`, worker/media/songbooks.js), far above any track id, so every lyrics route takes a text id as it takes a track id.
- People are their own records for now; a writer who also performs has a person and a catalog artist, to be joined later if wanted.
- Topics and scripture are free text for now.

## Worker (step 1)

Routes in `worker/media/songbooks.js` (its header has the full list):

| Route | Who |
|---|---|
| `GET /songbooks` | anyone: public books; with the Songbooks right, private ones too |
| `POST /songbooks`, `POST /songbooks/:book` | Songbooks right; making a book public (or private again) is for the owner and co-owners, and needs rights `permission` or `public-domain` with a note |
| `GET /songbooks/:book` | the book and its entries (private: the right) |
| `POST /songbooks/:book/entries`, `POST /songbooks/:book/entries/:number` | Songbooks right: a hymn number printing a new or existing text; another text; taken out |
| `GET /songbooks/texts/:id` | a text with its work, credits, books and words (private: the right) |
| `POST /songbooks/texts/:id` | Songbooks right: title, language, first line, work, translated from, credits |
| `GET/POST /songbooks/people…`, `/songbooks/works…` | Songbooks right |

A text's words are lyrics rows under its id (`/lyrics/<text id>`): saved, versioned, hidden and restored there. For a text in no public book, the public read answers 404, and only the Songbooks right reads or edits it; the Songbooks right also looks after its versions as the Lyrics right does. Texts are not joined to recordings and not in the app's lyrics index until step 4.

Tables (`migrations/0007-songbooks.sql`): `songbooks`, `songbook_entries`, `song_texts`, `song_works`, `song_people`, `song_credits`; kept by `tools/d1.mjs reset` (`LIBRARY_TABLES`).
