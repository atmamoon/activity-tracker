import { randomUUID } from 'node:crypto';
import type { DB } from '../db.ts';
import { nowIso } from '../db.ts';
import { nextTaskPosition } from './order.ts';

/**
 * Seed a day with tasks from active templates matching its weekday.
 * Each template seeds a given date at most once (tracked in day_seeds),
 * so deleting a seeded task does not resurrect it.
 * Only today and future days are seeded — opening an old day for
 * reference should not backfill it with routine blocks.
 */
export function materializeDay(db: DB, date: string, todayDate: string) {
  if (date < todayDate) return;
  const weekday = weekdayOf(date);
  const templates = db
    .prepare('SELECT * FROM templates WHERE active = 1 ORDER BY position')
    .all() as Array<{
    id: string;
    title: string;
    category_id: string | null;
    days: string;
    planned_start: string | null;
    planned_minutes: number | null;
  }>;

  const seeded = db.prepare('SELECT 1 FROM day_seeds WHERE date = ? AND template_id = ?');
  const markSeeded = db.prepare('INSERT INTO day_seeds (date, template_id) VALUES (?, ?)');
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, date, title, notes, category_id, status, position,
      planned_start, planned_minutes, template_id, created_at)
    VALUES (?, ?, ?, '', ?, 'todo', ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const t of templates) {
      let days: number[];
      try {
        days = JSON.parse(t.days);
      } catch {
        days = [0, 1, 2, 3, 4, 5, 6];
      }
      if (!days.includes(weekday)) continue;
      if (seeded.get(date, t.id)) continue;
      insertTask.run(
        randomUUID(),
        date,
        t.title,
        t.category_id,
        nextTaskPosition(db, date),
        t.planned_start,
        t.planned_minutes,
        t.id,
        nowIso()
      );
      markSeeded.run(date, t.id);
    }
  });
  tx();
}

/** Weekday (0=Sun..6=Sat) of a YYYY-MM-DD date, timezone-safe. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Local date as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
