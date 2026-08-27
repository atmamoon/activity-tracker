import type { DB } from '../db.ts';
import { getSetting } from '../db.ts';
import { GoogleClient } from './google.ts';
import { getCalendarMode } from './sync.ts';
import { dateAtTime, toRfc3339Local } from './time.ts';

const DEFAULT_MINUTES = 60;

export function getPushCalendarId(db: DB): string {
  return getSetting(db, 'push_calendar_id') ?? 'primary';
}

export function buildEventBody(task: {
  id: string;
  title: string;
  date: string;
  planned_start: string;
  planned_minutes: number | null;
  notes?: string;
}) {
  const start = dateAtTime(task.date, task.planned_start);
  const end = new Date(start.getTime() + (task.planned_minutes ?? DEFAULT_MINUTES) * 60 * 1000);
  return {
    summary: task.title,
    description: task.notes || 'Planned in Activity Tracker',
    start: { dateTime: toRfc3339Local(start) },
    end: { dateTime: toRfc3339Local(end) },
    extendedProperties: { private: { activityTrackerTaskId: task.id } },
  };
}

/**
 * Create or update the Google event for a task with a planned time.
 * Requires google mode + connection; throws with a readable message otherwise.
 */
export async function pushTaskToCalendar(db: DB, google: GoogleClient, task: any): Promise<any> {
  if (getCalendarMode(db) !== 'google' || !google.isConnected()) {
    throw new Error('Google Calendar is not connected (push requires Google mode)');
  }
  if (!task.planned_start) {
    throw new Error('Set a start time on the task before pushing it to the calendar');
  }
  const body = buildEventBody(task);
  if (task.calendar_event_id && task.calendar_id) {
    await google.patchEvent(task.calendar_id, task.calendar_event_id, body);
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  }
  const calendarId = getPushCalendarId(db);
  const created = await google.insertEvent(calendarId, body);
  db.prepare('UPDATE tasks SET calendar_event_id = ?, calendar_id = ? WHERE id = ?').run(
    created.id,
    calendarId,
    task.id
  );
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
}

/** Re-push an already-linked task after its title/date/time changed. */
export async function syncTaskEvent(db: DB, google: GoogleClient, task: any): Promise<void> {
  if (!task.calendar_event_id || !task.calendar_id) return;
  if (getCalendarMode(db) !== 'google' || !google.isConnected()) {
    throw new Error('Google Calendar is not connected');
  }
  if (!task.planned_start) {
    // Time removed → the event no longer matches; delete it and unlink.
    await removeTaskEvent(db, google, task);
    return;
  }
  await google.patchEvent(task.calendar_id, task.calendar_event_id, buildEventBody(task));
}

/** Delete the linked event (best effort on 404) and unlink locally. */
export async function removeTaskEvent(db: DB, google: GoogleClient, task: any): Promise<void> {
  if (!task.calendar_event_id || !task.calendar_id) return;
  if (getCalendarMode(db) !== 'google' || !google.isConnected()) {
    throw new Error('Google Calendar is not connected');
  }
  try {
    await google.deleteEvent(task.calendar_id, task.calendar_event_id);
  } finally {
    db.prepare('UPDATE tasks SET calendar_event_id = NULL, calendar_id = NULL WHERE id = ?').run(
      task.id
    );
    db.prepare('DELETE FROM calendar_events WHERE id = ?').run(
      `${task.calendar_id}:${task.calendar_event_id}`
    );
  }
}
