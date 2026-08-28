import { randomUUID } from 'node:crypto';
import type { DB } from '../db.ts';
import { nowIso } from '../db.ts';

export type ActivityEvent = 'done' | 'skipped' | 'reopened' | 'deleted';

/**
 * Append an event to the audit trail, snapshotting the task's details so the
 * entry stays readable after the task (or its category) is renamed or removed.
 */
export function logActivity(db: DB, task: any, event: ActivityEvent, at: string = nowIso()) {
  const category = task.category_id
    ? (db.prepare('SELECT name FROM categories WHERE id = ?').get(task.category_id) as
        | { name: string }
        | undefined)
    : undefined;
  db.prepare(
    `INSERT INTO activity_log (id, task_id, date, title, category_id, category_name,
       book_id, event, planned_start, planned_minutes, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    task.id,
    task.date,
    task.title,
    task.category_id ?? null,
    category?.name ?? null,
    task.book_id ?? null,
    event,
    task.planned_start ?? null,
    task.planned_minutes ?? null,
    at
  );
}

/** Map a status transition onto a log event, or null when nothing is worth recording. */
export function eventForStatusChange(from: string, to: string): ActivityEvent | null {
  if (to === from) return null;
  if (to === 'done') return 'done';
  if (to === 'skipped') return 'skipped';
  if (to === 'todo') return 'reopened';
  return null;
}
