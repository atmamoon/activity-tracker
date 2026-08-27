# 🎯 Activity Tracker

A local-first personal day planner built for interview-prep life: a reorderable
task queue for each day, recurring daily blocks, a parallel-books reading
tracker, and two-way Google Calendar sync so interview/assessment blocks are
always visible and never double-booked.

Everything runs and stays on your machine — a SQLite file in `data/`.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 4820 (change with `API_PORT`).

## The daily workflow

- **Quick add** — type a title, tap a category chip (RCA, Data Questions,
  Mental Math/Quant, Reading, Job Applications, …), press Enter. Press `n`
  from anywhere to focus the box.
- **Up next** — the first unfinished task is always the big "NOW" card, so
  after a break you instantly know what to do. Drag any card (handle on the
  left) to reorder the rest of your day in seconds. Keyboard reordering works
  too: focus a handle, press space, then arrow keys.
- **Done / skip / move** — check tasks off, skip today, or send them to
  tomorrow from the `⋯` menu. Unfinished tasks from previous days show up in a
  banner — one click brings them into today.
- **Daily blocks** (Settings → Daily blocks) — your fixed routine (daily
  practice, reading, …) auto-appears in the queue on the weekdays you choose.
  Deleting one instance doesn't bring it back; pausing the block stops it
  everywhere.
- **Books** — track the books you read in parallel, with page/chapter/percent
  progress. Drag cards to decide what to read next ("READ NEXT" tag). The
  **+ plan** button drops a reading task for that book into the current day.
- **Timeline** — the right panel shows your calendar events (striped = busy)
  and any tasks with a start time. Tasks that overlap a calendar event get an
  "⚠ overlaps" warning automatically. The red line is "now".

Shortcuts: `n` quick add · `t` today · `←`/`→` previous/next day.

## Calendar sync

Two options, switchable in **Settings → Calendar**:

### Option A — Google Calendar (two-way: pull events, push tasks)

One-time setup (~3 minutes, your tokens never leave your machine):

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   and create an **OAuth client ID** (type: *Web application*).
2. Add `http://localhost:4820/api/calendar/google/callback` as an authorized
   redirect URI.
3. Enable the **Google Calendar API** for the project
   ([direct link](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)).
4. Paste the client ID + secret into Settings and click **Connect Google
   account**.

Then:
- Pick which calendars to show as busy blocks and which one tasks get pushed to.
- **Push**: give a task a start time, then `⋯ → Push to calendar`. Later edits
  to its title/time/date sync to the event automatically; deleting can remove
  the event too.
- **Pull**: sync runs on app load, every 10 minutes, and on demand via the
  header button.

### Option B — ICS feed (read-only, zero setup)

In Google Calendar → Settings → your calendar → *Integrate calendar*, copy the
**Secret address in iCal format** and paste it into Settings. Events pull in
(including recurring ones); pushing tasks isn't possible in this mode.

## Tests

```bash
npm test          # 59 tests: API, calendar sync (mocked Google), ICS parsing, UI
npm run typecheck
```

## Stack

React 19 + Vite + zustand + dnd-kit · Express 5 + better-sqlite3 ·
no cloud, no accounts, one JSON API.

## Data

- SQLite database: `data/tracker.db` (gitignored). Back it up by copying the file.
- Google OAuth credentials/tokens are stored in the `settings` table locally.
