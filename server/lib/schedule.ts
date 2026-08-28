import type { DB } from '../db.ts';
import { hhmmToMinutes, minutesToHhmm, localToday } from './time.ts';
import { eventsForDay } from './sync.ts';

/**
 * Auto-scheduling: tasks left without an explicit time get one assigned
 * automatically, packed into free slots around calendar events and other
 * tasks. A task's time is "pinned" (auto_time=0) once the user sets it
 * explicitly — via the edit modal or a timeline drag — and pinned tasks are
 * never moved by this logic; they just become obstacles for the rest.
 */

export const WORK_START = 8 * 60; // 8am
export const WORK_END = 22 * 60; // 10pm
export const DAY_END = 24 * 60;
export const DEFAULT_DURATION = 30;
export const SNAP_MINUTES = 15;

export interface Interval {
  start: number;
  end: number;
}

export function roundUpToSnap(minutes: number, snap: number = SNAP_MINUTES): number {
  return Math.ceil(minutes / snap) * snap;
}

/**
 * Earliest start >= searchFrom where [start, start+duration) fits without
 * overlapping any obstacle. Prefers a slot that ends by `preferredEnd`
 * (working hours); falls back to `hardEnd` (end of day) if the working
 * window is already full.
 */
export function findFreeSlot(
  obstacles: Interval[],
  searchFrom: number,
  duration: number,
  preferredEnd: number = WORK_END,
  hardEnd: number = DAY_END
): number | null {
  const sorted = [...obstacles].sort((a, b) => a.start - b.start);
  const attempt = (ceiling: number): number | null => {
    let cursor = Math.max(0, searchFrom);
    if (ceiling - cursor < duration) return null;
    for (const ob of sorted) {
      if (ob.end <= cursor) continue;
      if (ob.start >= ceiling) break;
      if (ob.start - cursor >= duration) return cursor;
      cursor = Math.max(cursor, ob.end);
      if (ceiling - cursor < duration) return null;
    }
    return ceiling - cursor >= duration ? cursor : null;
  };
  const inWindow = attempt(preferredEnd);
  return inWindow !== null ? inWindow : attempt(hardEnd);
}

function currentMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function eventIntervalsForDay(db: DB, date: string): Interval[] {
  const events = eventsForDay(db, date) as Array<{ start: string; end: string; all_day: 0 | 1 }>;
  const [y, m, dd] = date.split('-').map(Number);
  const dayStartMs = new Date(y, m - 1, dd).getTime();
  const out: Interval[] = [];
  for (const ev of events) {
    if (ev.all_day) continue;
    const s = Math.max(0, Math.min(DAY_END, (new Date(ev.start).getTime() - dayStartMs) / 60000));
    const e = Math.max(0, Math.min(DAY_END, (new Date(ev.end).getTime() - dayStartMs) / 60000));
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

function placeAutoTasks(
  db: DB,
  date: string,
  nowOverride: number | undefined,
  onlyUnset: boolean
): any[] {
  const today = localToday();
  if (date < today) return []; // never rewrite history

  const searchFloor =
    date === today ? Math.max(WORK_START, roundUpToSnap(nowOverride ?? currentMinutes())) : WORK_START;

  const rows = db
    .prepare('SELECT * FROM tasks WHERE date = ? ORDER BY position, created_at')
    .all(date) as any[];

  const isCandidate = (t: any) => t.status === 'todo' && t.auto_time && (!onlyUnset || !t.planned_start);

  const obstacles: Interval[] = eventIntervalsForDay(db, date);
  for (const t of rows) {
    if (isCandidate(t)) continue;
    if (t.planned_start) {
      const s = hhmmToMinutes(t.planned_start);
      obstacles.push({ start: s, end: s + (t.planned_minutes ?? DEFAULT_DURATION) });
    }
  }

  const autoTasks = rows.filter(isCandidate);
  if (autoTasks.length === 0) return [];

  let cursor = searchFloor;
  const changed: any[] = [];
  const update = db.prepare('UPDATE tasks SET planned_start = ?, planned_minutes = ? WHERE id = ?');

  const tx = db.transaction(() => {
    for (const t of autoTasks) {
      const duration = t.planned_minutes ?? DEFAULT_DURATION;
      const slot = findFreeSlot(obstacles, cursor, duration);
      if (slot == null) continue; // no room left today; leave it untimed
      const newStart = minutesToHhmm(slot);
      if (t.planned_start !== newStart || t.planned_minutes !== duration) {
        update.run(newStart, duration, t.id);
        changed.push({ ...t, planned_start: newStart, planned_minutes: duration });
      }
      obstacles.push({ start: slot, end: slot + duration });
      cursor = slot + duration;
    }
  });
  tx();
  return changed;
}

/** Assign a slot only to tasks with no time yet — never disturbs already-placed ones. */
export function scheduleNewly(db: DB, date: string, nowOverride?: number): any[] {
  return placeAutoTasks(db, date, nowOverride, true);
}

/** Recompute every non-pinned task's slot in queue order (used after reorder/pin changes). */
export function reflowDay(db: DB, date: string, nowOverride?: number): any[] {
  return placeAutoTasks(db, date, nowOverride, false);
}
