import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db.ts';
import { nowIso } from '../db.ts';
import type { GoogleClient } from '../lib/google.ts';
import { nextTaskPosition, reorderDay } from '../lib/order.ts';
import { materializeDay, localToday } from '../lib/materialize.ts';
import { eventsForDay } from '../lib/sync.ts';
import { isValidDateStr, isValidTimeStr } from '../lib/time.ts';
import { syncTaskEvent, removeTaskEvent } from '../lib/taskEvents.ts';

const createSchema = z.object({
  date: z.string().refine(isValidDateStr, 'invalid date'),
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(5000).optional(),
  category_id: z.string().nullable().optional(),
  book_id: z.string().nullable().optional(),
  planned_start: z.string().refine(isValidTimeStr, 'invalid time').nullable().optional(),
  planned_minutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(5000).optional(),
  category_id: z.string().nullable().optional(),
  book_id: z.string().nullable().optional(),
  status: z.enum(['todo', 'done', 'skipped']).optional(),
  planned_start: z.string().refine(isValidTimeStr, 'invalid time').nullable().optional(),
  planned_minutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
  date: z.string().refine(isValidDateStr, 'invalid date').optional(),
});

export function taskRoutes(db: DB, google: GoogleClient): Router {
  const router = Router();

  const getTask = (id: string) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;

  router.get('/day/:date', (req, res) => {
    const date = req.params.date;
    if (!isValidDateStr(date)) return res.status(400).json({ error: 'invalid date' });
    materializeDay(db, date, localToday());
    const tasks = db
      .prepare('SELECT * FROM tasks WHERE date = ? ORDER BY position, created_at')
      .all(date);
    const events = eventsForDay(db, date);
    res.json({ date, tasks, events });
  });

  router.post('/tasks', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tasks (id, date, title, notes, category_id, book_id, status, position,
         planned_start, planned_minutes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?)`
    ).run(
      id,
      b.date,
      b.title,
      b.notes ?? '',
      b.category_id ?? null,
      b.book_id ?? null,
      nextTaskPosition(db, b.date),
      b.planned_start ?? null,
      b.planned_minutes ?? null,
      nowIso()
    );
    res.status(201).json(getTask(id));
  });

  router.patch('/tasks/:id', async (req, res) => {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;

    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val);
    };

    for (const key of ['title', 'notes', 'category_id', 'book_id', 'planned_start', 'planned_minutes'] as const) {
      if (key in b) set(key, (b as any)[key]);
    }
    if (b.status !== undefined && b.status !== task.status) {
      set('status', b.status);
      set('completed_at', b.status === 'done' ? nowIso() : null);
    }
    if (b.date !== undefined && b.date !== task.date) {
      set('date', b.date);
      set('position', nextTaskPosition(db, b.date));
      if (!task.carried_from) set('carried_from', task.date);
    }
    if (fields.length > 0) {
      values.push(task.id);
      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    let updated = getTask(task.id);
    // Keep a pushed calendar event in sync with title/time/date edits.
    let warning: string | undefined;
    if (
      updated.calendar_event_id &&
      ('title' in b || 'planned_start' in b || 'planned_minutes' in b || 'date' in b)
    ) {
      try {
        await syncTaskEvent(db, google, updated);
      } catch (err) {
        warning = `Saved locally, but updating the calendar event failed: ${(err as Error).message}`;
      }
      // syncTaskEvent may unlink the event (e.g. time removed) — re-read.
      updated = getTask(task.id);
    }
    res.json(warning ? { ...updated, _warning: warning } : updated);
  });

  router.post('/days/:date/reorder', (req, res) => {
    const date = req.params.date;
    if (!isValidDateStr(date)) return res.status(400).json({ error: 'invalid date' });
    const schema = z.object({ taskIds: z.array(z.string()).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'taskIds must be an array' });
    reorderDay(db, date, parsed.data.taskIds);
    const tasks = db
      .prepare('SELECT * FROM tasks WHERE date = ? ORDER BY position, created_at')
      .all(date);
    res.json({ date, tasks });
  });

  router.get('/days/:date/carryover', (req, res) => {
    const date = req.params.date;
    if (!isValidDateStr(date)) return res.status(400).json({ error: 'invalid date' });
    const candidates = db
      .prepare(
        `SELECT * FROM tasks WHERE status = 'todo' AND date < ? ORDER BY date DESC, position LIMIT 50`
      )
      .all(date);
    res.json({ candidates });
  });

  router.post('/days/:date/carryover', async (req, res) => {
    const date = req.params.date;
    if (!isValidDateStr(date)) return res.status(400).json({ error: 'invalid date' });
    const schema = z.object({ taskIds: z.array(z.string()).min(1).max(100) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'taskIds must be a non-empty array' });
    const warnings: string[] = [];
    for (const id of parsed.data.taskIds) {
      const task = getTask(id);
      if (!task || task.status !== 'todo' || task.date >= date) continue;
      db.prepare(
        'UPDATE tasks SET date = ?, position = ?, carried_from = COALESCE(carried_from, ?) WHERE id = ?'
      ).run(date, nextTaskPosition(db, date), task.date, id);
      if (task.calendar_event_id) {
        try {
          await syncTaskEvent(db, google, getTask(id));
        } catch (err) {
          warnings.push(`"${task.title}": calendar event not updated (${(err as Error).message})`);
        }
      }
    }
    const tasks = db
      .prepare('SELECT * FROM tasks WHERE date = ? ORDER BY position, created_at')
      .all(date);
    res.json({ date, tasks, warnings });
  });

  router.delete('/tasks/:id', async (req, res) => {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    let warning: string | undefined;
    if (task.calendar_event_id && req.query.deleteEvent === '1') {
      try {
        await removeTaskEvent(db, google, task);
      } catch (err) {
        warning = `Task deleted, but removing the calendar event failed: ${(err as Error).message}`;
      }
    }
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    res.json({ ok: true, warning });
  });

  return router;
}
