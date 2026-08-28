import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../server/db.ts';
import { findFreeSlot, scheduleNewly, reflowDay, WORK_START, WORK_END, DEFAULT_DURATION } from '../server/lib/schedule.ts';
import { localToday, hhmmToMinutes } from '../server/lib/time.ts';

describe('findFreeSlot', () => {
  it('returns the search-from time when there are no obstacles', () => {
    expect(findFreeSlot([], 9 * 60, 30)).toBe(9 * 60);
  });

  it('skips over an obstacle that overlaps the search start', () => {
    const slot = findFreeSlot([{ start: 9 * 60, end: 10 * 60 }], 9 * 60, 30);
    expect(slot).toBe(10 * 60);
  });

  it('fits into a gap between two obstacles', () => {
    const obstacles = [
      { start: 9 * 60, end: 9 * 60 + 30 },
      { start: 10 * 60, end: 11 * 60 },
    ];
    // Gap 9:30-10:00 is exactly 30 minutes — a 30-min task fits there.
    expect(findFreeSlot(obstacles, 9 * 60, 30)).toBe(9 * 60 + 30);
    // A 45-min task does not fit that gap; falls through to after 11am.
    expect(findFreeSlot(obstacles, 9 * 60, 45)).toBe(11 * 60);
  });

  it('falls back past the preferred window when it is full, staying within the hard end', () => {
    // Working hours (8am-10pm) fully booked; only room left is 10pm-11pm.
    const obstacles = [{ start: WORK_START, end: WORK_END }];
    const slot = findFreeSlot(obstacles, WORK_START, 30);
    expect(slot).toBe(WORK_END);
  });

  it('returns null when nothing fits even in the hard end', () => {
    const obstacles = [{ start: 0, end: 24 * 60 }];
    expect(findFreeSlot(obstacles, 0, 30)).toBeNull();
  });
});

describe('scheduleNewly / reflowDay', () => {
  let db: DB;
  const today = localToday();

  beforeEach(() => {
    db = openDb(':memory:');
  });

  function insertTask(opts: {
    id: string;
    date?: string;
    title?: string;
    status?: string;
    position?: number;
    planned_start?: string | null;
    planned_minutes?: number | null;
    auto_time?: 0 | 1;
  }) {
    db.prepare(
      `INSERT INTO tasks (id, date, title, status, position, planned_start, planned_minutes, auto_time, created_at)
       VALUES (@id, @date, @title, @status, @position, @planned_start, @planned_minutes, @auto_time, 'x')`
    ).run({
      date: today,
      title: 'task',
      status: 'todo',
      position: 10,
      planned_start: null,
      planned_minutes: null,
      auto_time: 1,
      ...opts,
    });
  }

  it('assigns a default 30-minute slot at/after the working-hours floor for a brand-new task', () => {
    insertTask({ id: 't1', position: 10 });
    const changed = scheduleNewly(db, today, WORK_START); // pretend "now" is exactly 8am
    expect(changed).toHaveLength(1);
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t1') as any;
    expect(row.planned_start).toBe('08:00');
    expect(row.planned_minutes).toBe(DEFAULT_DURATION);
  });

  it('packs multiple new auto tasks back-to-back in queue order without overlapping', () => {
    insertTask({ id: 'a', position: 10 });
    insertTask({ id: 'b', position: 20 });
    insertTask({ id: 'c', position: 30 });
    scheduleNewly(db, today, WORK_START);
    const rows = db.prepare('SELECT * FROM tasks WHERE date = ? ORDER BY position').all(today) as any[];
    expect(rows.map((r) => r.planned_start)).toEqual(['08:00', '08:30', '09:00']);
  });

  it('schedules around a fixed (pinned) task instead of overlapping it', () => {
    insertTask({ id: 'pinned', position: 10, planned_start: '08:15', planned_minutes: 30, auto_time: 0 });
    insertTask({ id: 'auto1', position: 20 });
    scheduleNewly(db, today, WORK_START);
    const auto = db.prepare('SELECT * FROM tasks WHERE id = ?').get('auto1') as any;
    // 8:00-8:15 gap is too short for a 30-min task; next opening is 8:45.
    expect(auto.planned_start).toBe('08:45');
  });

  it('scheduleNewly never touches a task that already has a time', () => {
    insertTask({ id: 'placed', position: 10, planned_start: '14:00', planned_minutes: 30 });
    const changed = scheduleNewly(db, today, WORK_START);
    expect(changed).toHaveLength(0);
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('placed') as any;
    expect(row.planned_start).toBe('14:00');
  });

  it('reflowDay re-sequences all auto tasks to match a new queue order', () => {
    insertTask({ id: 'a', position: 10, planned_start: '08:00', planned_minutes: 30 });
    insertTask({ id: 'b', position: 20, planned_start: '08:30', planned_minutes: 30 });
    // Swap queue order: b now comes first.
    db.prepare('UPDATE tasks SET position = 5 WHERE id = ?').run('b');
    const changed = reflowDay(db, today, WORK_START);
    const ids = changed.map((c) => c.id).sort();
    expect(ids).toEqual(['a', 'b']);
    const rows = db.prepare('SELECT * FROM tasks WHERE date = ? ORDER BY position').all(today) as any[];
    expect(rows.map((r) => `${r.id}:${r.planned_start}`)).toEqual(['b:08:00', 'a:08:30']);
  });

  it('reflowDay leaves a pinned task alone and reflows the rest around it', () => {
    insertTask({ id: 'auto1', position: 10, planned_start: '08:00', planned_minutes: 30 });
    insertTask({ id: 'pinned', position: 20, planned_start: '08:30', planned_minutes: 30, auto_time: 0 });
    insertTask({ id: 'auto2', position: 30, planned_start: '09:00', planned_minutes: 30 });
    // Reorder: auto2 now comes before auto1, pinned stays put logically.
    db.prepare('UPDATE tasks SET position = 5 WHERE id = ?').run('auto2');
    reflowDay(db, today, WORK_START);
    const pinned = db.prepare('SELECT * FROM tasks WHERE id = ?').get('pinned') as any;
    expect(pinned.planned_start).toBe('08:30'); // untouched
    const auto2 = db.prepare('SELECT * FROM tasks WHERE id = ?').get('auto2') as any;
    const auto1 = db.prepare('SELECT * FROM tasks WHERE id = ?').get('auto1') as any;
    // auto2 (now first in queue) gets the earliest slot; auto1 flows after,
    // and both avoid the pinned 08:30-09:00 block.
    expect(auto2.planned_start).toBe('08:00');
    expect(hhmmToMinutes(auto1.planned_start)).toBeGreaterThanOrEqual(hhmmToMinutes('09:00'));
  });

  it('does not schedule or reflow tasks on a past date', () => {
    const yesterday = db.prepare("SELECT date(?, '-1 day') AS d").get(today) as any;
    insertTask({ id: 'old', date: yesterday.d, position: 10 });
    expect(scheduleNewly(db, yesterday.d)).toHaveLength(0);
    expect(reflowDay(db, yesterday.d)).toHaveLength(0);
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('old') as any;
    expect(row.planned_start).toBeNull();
  });

  it('skips a done task when reflowing but keeps its old time as an obstacle', () => {
    insertTask({ id: 'done1', position: 10, planned_start: '08:00', planned_minutes: 30, status: 'done' });
    insertTask({ id: 'auto1', position: 20 });
    scheduleNewly(db, today, WORK_START);
    const auto1 = db.prepare('SELECT * FROM tasks WHERE id = ?').get('auto1') as any;
    expect(auto1.planned_start).toBe('08:30'); // avoided the done task's slot
  });
});
