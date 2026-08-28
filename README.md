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
  The section is collapsed by default (click "📚 Reading" to expand) —
  your choice sticks across reloads.
- **Timeline** — the right panel shows your calendar events (striped = busy)
  and any tasks with a start time. Tasks that overlap a calendar event get an
  "⚠ overlaps" warning automatically. The red line is "now".
  - **Auto-scheduling**: a task with no time gets one automatically — packed
    into the next free slot between 8am–10pm, working around your calendar
    events and other tasks. Reordering the queue re-sequences these times to
    match.
  - **Drag to move, drag the bottom edge to resize** — just like Google
    Calendar. Either action pins that task's time (it won't be touched by
    auto-scheduling again); a plain click still opens the edit modal. Clear
    a task's time in the edit modal to hand it back to auto-scheduling.

Shortcuts: `n` quick add · `t` today · `←`/`→` previous/next day.

## Past activity

The **Past activity** tab is the durable record of what you actually did.
Every completion, skip, reopen, and deletion is written to an append-only
`activity_log` table with a snapshot of the task's details — so history stays
readable even after you rename a task, rename a category, or delete the task
outright (removed items still show up, flagged as such).

- **The log** — days newest-first, each entry showing its slot (start–end),
  duration, category, book, whether it was carried over, and its outcome:
  done / missed / skipped / upcoming. An unfinished task in the past reads as
  **missed**, which is the signal for what's slipping.
- **Filters** — date range (7/30/90 days, all time), category, status, and a
  title search.
- **Where the time goes** — share of logged time per category, plus a
  consistency table per recurring activity (days done ÷ days planned, current
  streak). This answers "what am I most consistent at", "what keeps getting
  missed", and "what is eating my day".

Note on the numbers: the summary tiles always describe the **whole date
range**, not the filtered list below them. The completion rate is
`done ÷ (done + missed)` — today's still-open tasks aren't counted as failures
because the day isn't over yet.

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
npm test          # 96 tests: API, scheduling, history/stats, calendar sync (mocked Google), ICS, UI
npm run typecheck
```

## Stack

React 19 + Vite + zustand + dnd-kit · Express 5 + better-sqlite3 ·
no cloud, no accounts, one JSON API.

## Data

- SQLite database: `data/tracker.db` (gitignored). Back it up by copying the file.
- Google OAuth credentials/tokens are stored in the `settings` table locally.
