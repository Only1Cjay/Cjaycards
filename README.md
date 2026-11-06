# CjayCards — Spaced Repetition Flashcards

A simple spaced-repetition flashcard app, built by a PharmD student at the University of Benin for his own studying — Anatomy, Biochemistry, and whatever comes next. Create decks, review the cards that are due, and let the app schedule the rest.

No accounts, no build step, no server of your own to run. Your data lives in your browser first, and syncs when you're online.

## Features

### Studying
- **Decks** — create as many decks as you like, each with its own colour and its own review intervals.
- **Three card types**
  - **Basic** — front → back.
  - **Cloze** — fill in the blank, using `{{c1::answer}}` markers.
  - **Reversed** — an optional flipped sibling card (back → front) created alongside a basic card.
- **Four-grade rating** — after revealing an answer, rate it **Again / Hard / Good / Easy**. Each grade maps to the deck's next review interval.
- **Customisable intervals per deck** — the default schedule is ~1 hour, 1 day, 3 days, then 7 days, but each deck's intervals can be changed.
- **Mastered cards** — a card counts as mastered after 3 "Easy" ratings in a row, or when you mark it mastered manually. Mastered cards stop showing as due.
- **Cram mode** — study a whole deck regardless of what's due, with an on-screen timer.
- **Study by tag** — pick a tag and study just the cards that carry it.
- **Bury, duplicate, move, reset** — bury a card until tomorrow, duplicate it, move it to another deck, or reset its progress and start over.
- **Bulk actions** — select several cards at once to move or delete them.
- **Keyboard shortcuts** during study (including a shortcut to add a card).

### Organisation
- **Decks tab** — every deck with its due count, mastered count, and a mastery progress bar.
- **Due tab** — all cards due across every deck, in one place.
- **Search** — find cards across all decks.
- **Tags view** — browse cards by tag, with automatic tag suggestions generated from card text.
- **Activity view** — your review streak, a 90-day review heatmap, and a feed of recent reviews.

### Sync, backup & offline
- **Works offline** — it's a PWA: a service worker caches the app shell, an offline banner tells you when you're disconnected, and changes still save locally.
- **Cjay Cloud sync** — decks and cards sync automatically (a couple of seconds after a change) through a Cloudflare Worker, with a sync-status icon in the header. A "Force Sync" option is in Settings.
- **Google Drive backup** — manually push your data to, or pull it back from, your own Google Drive. This needs your own Google OAuth Client ID, entered in the Drive modal.
- **JSON backup / restore** — export all data to a file, and restore from one later (with a choice of how to merge it).
- **CSV import / export** — import cards from a CSV file, or export a deck (or everything) as CSV.
- **Push notifications** — optional; enable them in Settings to be reminded about due cards.
- **Demo mode** — open the app with `?view=1` for a read-only demo with sample Anatomy and Biochemistry decks.

### Appearance
- Light and dark mode (sun/moon toggle in the header).
- Three colour families to choose from in Settings: Slate, Ink, and Espresso. Your choice is remembered.
- Installable — an install banner offers to add it to your home screen.

## Getting started

There is nothing to install and no build step.

1. Open `index.html` in a browser.
2. Create a deck (the **+** button), add cards, and start studying from the **Due** tab.
3. To try it without saving anything, open it with `?view=1` added to the URL for the read-only demo.

That's it. Data is stored in your browser's local storage, so it stays on that device unless you turn on Cjay Cloud sync or back it up to Google Drive / a file.

## Tech stack

- **Vanilla HTML, CSS, and JavaScript** — no framework, no bundler, no build step.
- **localStorage** — all decks, cards, reviews, and settings (schema v1, key `cjaycards.data.v1`).
- **Service Worker** (`sw.js`, cache `cjaycards-v1.1.2`) — offline caching, update prompts, and push notifications.
- **Web App Manifest** (`manifest.json`) — standalone display, portrait orientation, installable with an SVG icon.
- **Cloudflare Worker** (`cjay-cloud.monaplayzsbackup.workers.dev`) — cross-device sync and push (VAPID) via a sync token.
- **Google Drive API** — optional manual backup, using the Google API client (`gapi`) and Google Identity Services, with a user-supplied OAuth Client ID.
- **CDN dependencies** — Google Fonts (Plus Jakarta Sans / Inter) and Font Awesome 6.5.1 icons.

## Project structure

```
Cjaycards/
├── index.html    # App shell: header, Decks/Due tabs, menus, modals, install banner
├── app.js        # All app logic (~120 KB): study engine, sync, Drive, CSV, themes, push
├── storage.js    # Data layer (~13 KB): decks/cards/reviews, scheduling, streak, heatmap
├── styles.css    # All styling (~54 KB)
├── sw.js         # Service worker: offline cache, push notifications
├── manifest.json # PWA manifest
├── icon.svg      # App icon
└── README.md     # This file
```

The previous README was two lines: `# Cjaycards` / `simple spaced repetition app` — which is also the repository's GitHub description.

## Status

Actively developed in September–October 2026; the most recent commits (as of this writing) are from 23 October 2026. The app is usable as-is — the author uses it for his own pharmacy coursework.
