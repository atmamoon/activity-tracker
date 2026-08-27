import type { DB } from '../db.ts';
import { getSetting, setSetting, nowIso } from '../db.ts';
import type { GoogleClient } from './google.ts';
import { expandIcsEvents, fetchIcs } from './ics.ts';
import { dateAtLocalMidnight, addDaysStr, toRfc3339Local } from './time.ts';

export interface SyncResult {
  source: 'google' | 'ics' | 'none';
  eventCount: number;
}

export function getCalendarMode(db: DB): 'google' | 'ics' | 'none' {
  const mode = getSetting(db, 'calendar_mode');
  if (mode === 'google' || mode === 'ics') return mode;
  return 'none';
}

export function getSelectedCalendarIds(db: DB): string[] {
  try {
    const raw = getSetting(db, 'google_calendar_ids');
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

/**
 * Pull events for [fromDate, toDate] (inclusive, local days) into the cache.
 * Replaces all cached events for the active source — a full-window refresh
 * keeps deletions on the calendar side consistent locally.
 */
export async function syncCalendar(
  db: DB,
  google: GoogleClient,
  fromDate: string,
  toDate: string,
  icsFetcher: (url: string) => Promise<any> = fetchIcs
): Promise<SyncResult> {
  const mode = getCalendarMode(db);
  if (mode === 'none') return { source: 'none', eventCount: 0 };

  const from = dateAtLocalMidnight(fromDate);
  const to = dateAtLocalMidnight(addDaysStr(toDate, 1));

  const rows: Array<{
    id: string;
    calendar_id: string;
    summary: string;
    start: string;
    end: string;
    all_day: 0 | 1;
  }> = [];

  if (mode === 'google') {
    const calendarIds = getSelectedCalendarIds(db);
    if (calendarIds.length === 0 || !google.isConnected()) {
      return { source: 'google', eventCount: 0 };
    }
    for (const calId of calendarIds) {
      const items = await google.listEvents(calId, toRfc3339Local(from), toRfc3339Local(to));
      for (const ev of items) {
        if (ev.status === 'cancelled') continue;
        const allDay = Boolean(ev.start?.date);
        const start = allDay ? ev.start.date : ev.start?.dateTime;
        const end = allDay ? ev.end?.date ?? ev.start.date : ev.end?.dateTime ?? start;
        if (!start) continue;
        rows.push({
          id: `${calId}:${ev.id}`,
          calendar_id: calId,
          summary: ev.summary ?? '(no title)',
          start,
          end,
          all_day: allDay ? 1 : 0,
        });
      }
    }
  } else {
    const url = getSetting(db, 'ics_url');
    if (!url) return { source: 'ics', eventCount: 0 };
    const parsed = await icsFetcher(url);
    const events = expandIcsEvents(parsed, from, to);
    for (const ev of events) {
      rows.push({
        id: ev.id,
        calendar_id: 'ics',
        summary: ev.summary || '(no title)',
        start: ev.start,
        end: ev.end,
        all_day: ev.allDay ? 1 : 0,
      });
    }
  }

  const source = mode;
  const insert = db.prepare(`
    INSERT INTO calendar_events (id, source, calendar_id, summary, start, end, all_day, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary, start = excluded.start, end = excluded.end,
      all_day = excluded.all_day, updated_at = excluded.updated_at,
      calendar_id = excluded.calendar_id, source = excluded.source
  `);
  const tx = db.transaction(() => {
    // Full refresh: drop everything from this source, re-insert the window.
    db.prepare('DELETE FROM calendar_events WHERE source = ?').run(source);
    const stamp = nowIso();
    // Dedupe ids defensively (e.g. same event id in two selected calendars).
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      insert.run(r.id, source, r.calendar_id, r.summary, r.start, r.end, r.all_day, stamp);
    }
  });
  tx();
  setSetting(db, 'last_sync', nowIso());
  setSetting(db, 'sync_error', null);
  return { source, eventCount: rows.length };
}

/**
 * Cached events overlapping a local day. All-day events are stored with
 * date-only strings; timed events as ISO datetimes.
 */
export function eventsForDay(db: DB, date: string): Array<Record<string, unknown>> {
  const dayStart = dateAtLocalMidnight(date);
  const dayEnd = dateAtLocalMidnight(addDaysStr(date, 1));
  const all = db
    .prepare('SELECT * FROM calendar_events')
    .all() as Array<{ start: string; end: string; all_day: 0 | 1 } & Record<string, unknown>>;
  return all
    .filter((ev) => {
      if (ev.all_day) {
        // Date-only strings, [start, end) exclusive end per RFC 5545; treat a
        // degenerate end (missing or not after start) as a single-day event.
        const end = ev.end && ev.end > ev.start ? ev.end : addDaysStr(ev.start, 1);
        return ev.start <= date && date < end;
      }
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      return e > dayStart && s < dayEnd;
    })
    .sort((a, b) => (a.all_day !== b.all_day ? b.all_day - a.all_day : String(a.start).localeCompare(String(b.start))));
}
