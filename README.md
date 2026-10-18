# LinguaForge · Language Practice Journal

Build your English intuition, one sentence at a time.

A mobile-friendly, local-first English and Japanese practice app hosted on GitHub Pages.

The homepage offers two entries: English keeps the existing EnglishForge experience; Japanese uses the same learning flow with its own vocabulary, sentences, kana readings, and Japanese pronunciation. The repository is `greamown/lingua-forge`; the English learning space still uses existing EnglishForge records.

## Features
- Language selector homepage with separate English (`practice.html?lang=en`) and Japanese (`practice.html?lang=ja`) learning spaces
- Independent local study records, JSON backups, and automatic cloud sync for each language, with first/last practice times per item
- Warm paper-and-green learning journal layout, with responsive mobile navigation and keyboard focus indicators
- Guided flashcards, session progress, restartable completion screens, and quiz self-assessment summaries
- Library filters for new, due, and familiar sentences (due counts exclude unstudied items)
- Daily practice: Monday–Friday two new items, with review; Saturday weekly recall; Sunday long-term review
- Chinese-to-English active recall and self-assessment
- Separate vocabulary/phrase, sentence, and mixed practice modes across flashcards, quizzes, and the library
- Normal-speed and slow English text-to-speech, plus hide-and-recall shadowing (browser speech synthesis)
- Editable material types in the library; changing a type keeps existing review progress
- Delete items from the library (with confirmation); deletions sync to other devices
- Difficulty-based review intervals: 0, 1, 3, 7, 14, 30, 60 days
- Searchable vocabulary/sentence library
- JSON import with duplicate detection and JSON progress backup
- Works without server, credentials, or external dependencies

## Run
Open `index.html` in a modern browser, or enable GitHub Pages in **Settings → Pages → Deploy from a branch → main → /(root)**.

When Pages is enabled, the expected URL is:
https://greamown.github.io/lingua-forge/

## Checks
Run `node --test tests/*.test.cjs` (Node.js 18+; no dependencies). These checks cover session restart, direct navigation, answer/skip handling, review counts, self-assessment, library filtering, material types, shadowing, speech error handling, Japanese text matching, and cloud backup isolation.

## Language data

English retains the existing `english-forge-v1` browser storage key, so existing records carry over. Japanese uses `japanese-forge-v1` and starts with 10 independent introductory examples. Returning to the language selector never merges or deletes progress.

Cloud sync stores English in `englishRecords` and Japanese in `japaneseRecords` (each a JSON string, which avoids Firestore's 20,000-fields-per-document limit) under `users/{uid}/backups/latest`; each write touches only its own field, so syncing one language preserves the other. Records are keyed by the same normalized text that skips duplicate imports, so a lesson imported on two devices stays one item. Each item keeps its own record with the time it last changed (unmarking or clearing writes a dated removal record too). Once signed in with Google, the page syncs automatically: on sign-in, about 1.5 seconds after each change, and when the tab is hidden or shown again. A sync reads the cloud copy, keeps the newer record for each item, and writes the result back in one Firestore transaction, so progress from different devices on the same account is combined rather than overwritten. Device clocks decide which change is newer. Older whole-snapshot backups are merged in once (dated by their upload time) and then removed. Existing rules remain compatible. All apps share this one Firestore document, which Firestore caps at 1 MiB; if the libraries grow large, give each app its own document and update `firestore.rules`.

## Import format
```json
[
  {
    "english": "Let's clarify the goal first.",
    "chinese": "我們先釐清目標。",
    "category": "Business",
    "source": "English-Class"
  }
]
```

For Japanese, choose the Japanese entry first and import ([sample file](reference/japanese-example.json)):
```json
{
  "language": "ja",
  "items": [
    {"japanese":"水","reading":"みず","romaji":"mizu","chinese":"水","kind":"word"},
    {"japanese":"水をください。","reading":"みずをください。","romaji":"mizu o kudasai.","chinese":"請給我水。","kind":"sentence"}
  ]
}
```
`japanese` holds Japanese text, `reading` holds kana (hiragana or katakana), `romaji` holds the romanized reading, and `chinese` holds the Chinese prompt. `example` optionally holds a Japanese-only example for playback. Romaji is supplied by the material author; it is not generated automatically. Japanese does not infer spoken examples from bilingual notes, because Chinese and Japanese can share characters. Internally, both languages use the legacy `english` text field for compatibility; Japanese imports also accept `japanese` or `ja`. Japanese JSON exports use `japanese`, while English exports retain `english`. Both preserve learning progress and include a `language` identifier; importing a labelled backup into the other language is rejected.

English materials do not need Japanese-only fields. Existing Japanese materials with missing kana or romaji remain usable; reimporting the same Japanese text fills only missing `reading`/`romaji` values, preserving existing text and progress. You can also enter both readings in the Japanese add-material form. Kana and romaji are searchable and hidden alongside the answer during recall.

The importer also accepts objects with `items`, `references`, `vocabulary`, or `sentences` arrays, plus common aliases for English and Chinese fields.

An optional `kind` field accepts `"word"` (including phrases) or `"sentence"`. Imports under `vocabulary` and `sentences` retain that type. Untyped items use sentence-ending punctuation as a first pass; correct ambiguous items with the type selector in the library. Existing browser data needs no migration.

English notes use the form `Example sentence.（中文翻譯。）`; `example` is accepted when `note` is absent. Reimporting the same English text refreshes its English, Chinese, and note from the file (imported text cannot be edited in the app), leaving learning progress untouched. Chinese prompts should be a short Traditional Chinese meaning with no English, so they never reveal the answer.

For pronunciation practice, reveal a flashcard, listen at normal speed, use slow playback to shadow it, then hide the English and say it again. Bilingual examples in material notes also have normal/slow playback; only the English portion is spoken. Words focus on stress and syllables; sentences focus on rhythm, linking, and pauses. This is self-assessed practice, not microphone pronunciation scoring.

## Privacy and limitations
- All added content and practice progress are stored in the current browser's `localStorage`.
- Progress syncs between devices only when signed in with Google; otherwise export JSON backups regularly.
- The website does not access Gmail, and no Gmail tokens or private email bodies are committed to this repository.
- Gmail content can be transformed into a reviewable JSON reference dataset in ChatGPT and then imported into this app.
- Answer checks compare normalized strings; alternative correct expressions require your own judgment.
- Voice pronunciation is provided by browser text-to-speech; this version does not score microphone pronunciation.
- Review scheduling is lightweight, not a scientifically validated SRS implementation.

## Next steps
- Curate and import the rest of the English-Class learning reference.
- Add smarter answer checking and English interview scenarios.


## Firebase private cloud sync (optional)

The UI has Google sign-in and automatic Firestore sync. **It remains inactive until you configure your own Firebase project.**

1. Create a project at https://console.firebase.google.com/ (choose the Spark plan).
2. Add a **Web app** under project settings and copy its Firebase SDK `firebaseConfig` into `firebase-config.js`. This config identifies the public Firebase app; never paste service-account credentials.
3. In **Build → Authentication → Sign-in method**, enable **Google** and configure the support email.
4. In **Authentication → Settings → Authorized domains**, add `greamown.github.io` (and localhost for testing if needed).
5. In **Build → Firestore Database**, create the database, then copy the contents of `firestore.rules` into the **Rules** editor and click **Publish**. Do not leave Firestore in test mode.
6. Deploy the changes to GitHub Pages, open **Materials & Backups**, and sign in with Google. Progress then syncs automatically; **Sync Now** forces a sync. These labels appear in Chinese in the app.

### Security notes
- Database reads/writes are scoped to `users/{request.auth.uid}/backups/latest` by Firestore rules.
- With the rules as written, any Google user permitted to sign in may have their own private backup. They cannot access each other's records.
- If you want only one authorized Google account, configure an email/UID allowlist in Firebase Rules after your first sign-in.
- `firebase-config.js` is visible publicly; this is normal for Firebase client SDK configuration. Database access must be protected by Firestore Rules.
- The existing `reference/*.json` files have already been committed to a **public repository**, so they are public (including in Git history). Moving them to Firestore later does not erase that public history.
