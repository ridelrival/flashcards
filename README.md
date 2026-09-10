# Flash Cards

A small, offline-capable Japanese vocabulary app. No account, backend, build step, or runtime dependencies are required. The app keeps your library in your browser and runs on GitHub Pages.

## Run locally

Install Node.js 22 or newer, then run:

```sh
npm start
```

Open http://127.0.0.1:4173/. Use an HTTP server rather than opening `index.html` directly; ES modules, IndexedDB, and service workers require a supported origin.

## Learning and managing your cards

- Organize cards into sections and decks. Use the visible `⋯` menu to edit or delete an item.
- Search by Japanese word, reading, English, or Indonesian meaning. Decks render at most 50 cards per page. Selection across pages is preserved; **Select this page** selects the visible results.
- **Main** contains every card. **Skipped** and **Got It** are filters on the same card, so edits remain consistent. A card has one current learning status.
- Choose 10, 20, 50, or 100 cards per session, a daily goal, and a study direction in Settings. **All cards** allows extra practice before the next due date.
- **Skip · Again** schedules the card for 10 minutes later. **Got it** schedules 1 day, then 3 days, then doubles the interval up to 365 days. This is a simple fixed scheduler, not FSRS or a personalized retention model.
- Shuffle never moves the displayed card or previously answered cards. Turning it off restores the natural order of the remaining cards in the session.
- Each answer saves the card, today's count, and session together. **Save & exit** pauses the session; **Continue session** resumes it after reopening the app.
- Use **Undo** (or `Z`) for the most recent answer in the current page session. Undo restores its previous status, due date, and daily count. Undo history is cleared on reload or card edits; the saved session position remains available.
- During study, `Space` flips the card, `1` selects Skip, and `2` selects Got it. Shortcuts do not run while a dialog or form field is active.

## Backups and imports

**Download full backup (.json)** is the recovery format. It includes all section/deck/card IDs, card content, progress, due dates, daily totals, preferences, and the saved study session. Empty sections and decks are preserved. Restore validates the entire backup, previews it, and downloads the current library before replacing records in a single transaction.

**CSV** transfers card content, not progress. It supports Unicode, quoted commas, escaped quotes, and multiline fields. Headers can be reordered. Current columns are:

```text
sectionName,deckName,front,reading,furigana,meaningEn,meaningId
```

Legacy headers such as `Section`, `Deck Name`, `Meaning EN`, and `Meaning ID` are accepted. A word/front and at least one meaning column are required. Malformed records stop the whole import. A missing section name uses the currently opened section, or `Imported` on the home screen. Each import creates fresh decks; repeated names receive a numeric suffix rather than overwriting cards.

All user/imported content is rendered as text. Furigana elements are built through DOM APIs. HTML in a word or meaning is displayed literally.

## Migration and data safety

On first load, the app migrates the old `flashcard_*` localStorage keys to IndexedDB database `flashcards-v2`. The original keys are retained as a recovery copy and are never cleared or overwritten by this version.

Main cards receive stable IDs. Matching copies from Skipped/Got It are unified with the main card; changed copies that no longer match are preserved as additional cards. Duplicate main cards are retained. When an old card appears in both statuses, Skipped takes priority so it remains due for review. Old cards have no review dates, so migrated cards are initially due.

Corrupt legacy JSON, invalid references, or unavailable storage opens the recovery screen instead of replacing records with empty arrays. Failed writes leave previously committed records intact. Revision checks reject stale saves from another tab; reload that tab before continuing.

Browser storage is device- and origin-specific. Clearing site data removes the active library. Keep full backups, and use export/import to transfer to another device. Returning to the old application code will show its retained pre-migration localStorage snapshot, not newer IndexedDB changes.

## Offline and deployment

Deploy the repository root to GitHub Pages. Runtime files are `index.html`, `styles.css`, `js/`, `manifest.json`, `icon.png`, and `sw.js`.

The service worker caches the complete app shell on the first successful online visit. The installed shell is served consistently, including offline. Updates display an **Update now** notice rather than replacing a running session automatically. Increment `CACHE_NAME`'s version in `sw.js` whenever runtime files change.

Cache names include the application scope. Cleanup only removes this app's versioned caches; unrelated caches and legacy ambiguous cache names are left alone.

## Verification

```sh
npm test
```

The dependency-free Node suite covers migration, CSV roundtrips and malformed input, backups, scheduling, undo, shuffle identity, and service-worker cache behavior. GitHub Actions runs this suite for pushes and pull requests.

With the local server running, open `/tests/storage.html` and choose **Run isolated tests**. These use a temporary IndexedDB database, never the user's app database. They cover rollback, stale writers, persistence, full replacement, migration, and targeted saves with 3,001 cards.

## Code layout

- `js/core.js`: validation, migration, CSV/JSON, session order, scheduling, undo.
- `js/storage.js`: IndexedDB transactions and revision conflicts.
- `js/app.js`: accessible DOM rendering and interactions.
- `styles.css`: responsive layout, keyboard focus, reduced-motion support.
- `sw.js`: scoped, versioned offline shell.

The project has no production package dependencies and does not transmit study data to a server.
