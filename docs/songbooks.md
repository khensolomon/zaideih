# Songbooks

Status: agreed 2026-10-25. Built: step 1 (data and Worker) in v26.10.25.15, step 2 (import) in v26.10.25.16, steps 3 to 5 (pages, search, joining recordings, editing) in v26.10.25.17.

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

- A book is **private** until its rights are set to permission or public domain: its entries, their texts and their search words are seen only by those with the Songbooks right, and a recording joined to a private text does not show that text to the public. Every lyrics route of such a recording (reading, saving, history, compare, hide, restore, joining another recording to it) follows the text's own rules: only those who see its book read it, and only its editors (or the Songbooks right) change it; the Lyrics right alone does neither.
- Making a book public is one switch, by the owner or a co-owner, with the rights note required.
- A new **Songbooks** right (given in Members, like any right) creates books, people and works, and edits entries; members can correct texts of public books as they correct lyrics now.

### Collaborators on one book

The Songbooks right reaches every book. To give someone one book only, the owner, a co-owner or anyone with the Songbooks right appoints them to it (the book's page, **Collaborators**: found by name, GitHub login or email; they sign in to Zaideih once first). Appointments are kept in `songbook_members` (migration 0008), one role per member and book:

| Role | Sees | Changes |
|---|---|---|
| Editor | the book while private, its songs, their words and history | the book's details and rights note, Add pages, numbers (renumber, add, delete in a private book), each song's words (studio), title, first line, language, credits and work, recordings joined; new people and works, and the people and works of the book's songs |
| Reader | the book while private, its songs and their words | nothing |

What stays with the owner and co-owners: making a book public or private again, and deleting songs from a public book. What stays with the Songbooks right: new books, appointing, and people or works credited only outside the editor's books (they are shared by every book). A song printed in two books is edited by an editor of either. A blocked member sees what the public sees; joining two accounts keeps the appointments of both.

Every book the person sees carries `may`: `manage` (the Songbooks right), `edit`, `read`, or null (a public book, not appointed). The app shows editing from it; a text's `may` is the most its books allow.

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

## Built (steps 3 to 5)

Pages (`src/ui/songbook-pages.js`):

- **The books** (`#/songbooks`, `src/ui/songbooks-view.js`): a shelf of covers, each the book's short name on a shade of its own (`art.js` shadeOf) with a spine and its language as an imprint; the title, edition, year and songs under it, Private and Editor or Reader when they apply. Find (title, short name, language, publisher), show All, Public, Private or Appointed (only when there is something to tell apart), and sort by title, most songs or language. Add pages is a small button on the cover's corner for those who edit the book (on hover where there is one). **New songbook** (the Songbooks right) is a dialog: title, short name (its initials until edited; a short name already used is said as typed), language (those of the books offered), and edition, year and publisher folded away; the cover is drawn as they are typed; Create songbook opens Add pages.
- **A book's head**: its cover beside the title.
- **For editors, a studio**: a book's page and a song's page carry the studio's header (as the lyrics studio's): back (to the books, or to the book), the title and a line under it (short name, Private, songs, the person's role), and the tools as icons: on a book Add pages, Details and rights and (the Songbooks right) Collaborators; on a song Edit the words, Details, and the previous and next number. The page is then a studio page (`body[data-studio]`, set by the view's `studio`): no floating bar on phones, the header as the title bar in the installed desktop app. Listeners see the pages as before.

- **A book** (`#/songbook/<id>`): its hymns by number, title and first line, filtered as typed; Enter on a number opens that hymn. With the Songbooks right: Add pages, and Details and rights (title, short name, language, edition, year, publisher, rights and how they are settled; Public for the owner and co-owners).
- **A hymn** (`#/songbook/<id>/<number>`, or `#/songbooks/text/<id>` wherever it is printed): the words as lyrics are shown (chips, parts, notes; meaning translations as language chips), About this hymn (the work, words, music, arrangement, translated by, tune, metre, year, scripture, topics, each person a link), other versions of the work, the recordings that sing it (Play), the previous and next hymn. A private book's hymn says so.
- **A person** (`#/songbooks/person/<id>`) and **a work** (`#/songbooks/work/<id>`): what they wrote, composed or translated; the work's versions.
- **Editing** (the Songbooks right), on the hymn: Edit the words opens the lyrics studio for the text (`#/songbooks/text/<id>/studio`: writing and preview; no timing or same-song offers, which are for recordings); Details edits the title, first line and language, translators and words in that language, the work (found by title or tune, or new) with its words, music and arrangement; changes the hymn's number in the book (a number taken is refused); and deletes the hymn. Deleting takes only this number out when the words are printed in another book too; otherwise the text goes with its words, versions, reports and credits, and is refused (409) while recordings are joined to it, which are unjoined first. In a public book only the owner and co-owners delete. Under Recordings, Join a recording lists the catalog's songs with a title close to the hymn's (`core/titles.js`, the same closeness as for same-song offers; held albums left out), each with Join, and finds any other by title; recordings are joined (a recording with words of its own is joined only when asked, its own kept in its history), or unjoined.

Search (`src/ui/views.js`, `src/ui/suggest.js`): "TL 145", "tl145" or "Tedim Labu 145" opens that hymn, first among the suggestions and above the results; a book's name or short name shows the book; a line of a public hymn's words finds it ("In the songbooks"), from the app's lyrics index, which takes public texts in and drops texts of a book made private. A text added to, taken out of or replaced in a public book counts as changed in the index too, and a deleted text stays as an empty hidden row, so devices drop it. The hymns are named from `GET /songbooks/index` (`core/songbooks.js`, kept on the device, read again every 10 minutes; signed in, the private books the person sees, in memory only).

Recordings: a recording joined to a text shows its words (shared lyrics: the text is the source, each recording keeps its own timing) and says "Words from Tedim Labu 145" on its lyrics page. Joining needs the Lyrics or the Songbooks right, or to be an editor of a book printing the text. A recording joined to a private text shows no words.

Step 5 was planned for the Workspace; it is in the app instead, on the book and hymn pages, because the Workspace needs a GitHub sign-in and the Songbooks right does not.

Songbooks shows in the sidebar's Browse and the logo menu once a book is public, always for the Songbooks right, and for those appointed to a book.

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
| `GET /songbooks` | anyone: public books, and the private ones the person sees (the right, or appointed); each with `may`; `create`, `publish` say what the person may do |
| `GET /songbooks/:book/collaborators`, `POST /songbooks/:book/collaborators {member, role}` | Songbooks right: those appointed; appoints as `editor` or `reader`, or (`role: null`) takes off |
| `GET /songbooks/members?q=` | Songbooks right: members by name, GitHub login or email (2 letters at least), to appoint |
| `POST /songbooks`, `POST /songbooks/:book` | Songbooks right (a new book); the right or an editor (a book's details); making a book public (or private again) is for the owner and co-owners, and needs rights `permission` or `public-domain` with a note |
| `GET /songbooks/:book` | the book and its entries (private: the right) |
| `POST /songbooks/:book/entries`, `POST /songbooks/:book/entries/:number` | Songbooks right or an editor of the book: a hymn number printing a new or existing text; another text (`text`); another number (`number`); taken out (`remove`); deleted (`delete`: the number, or the text when no other book prints it) |
| `GET /songbooks/texts/:id` | a text with its work, credits, books and words (private: the right) |
| `POST /songbooks/texts/:id` | Songbooks right, or an editor of a book printing it: title, language, first line, work, translated from, credits |
| `GET/POST /songbooks/people…`, `/songbooks/works…` | Songbooks right; an editor finds and adds them, and changes those of the songs in their books |

A text's words are lyrics rows under its id (`/lyrics/<text id>`): saved, versioned, hidden and restored there. For a text in no public book, the public read answers 404, and only the Songbooks right reads or edits it; the Songbooks right also looks after its versions as the Lyrics right does. Texts are not joined to recordings and not in the app's lyrics index until step 4.

Tables (`migrations/0007-songbooks.sql`): `songbooks`, `songbook_entries`, `song_texts`, `song_works`, `song_people`, `song_credits`; kept by `tools/d1.mjs reset` (every table not in `REBUILDABLE_TABLES`).
