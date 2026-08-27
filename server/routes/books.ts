import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db.ts';
import { nowIso } from '../db.ts';
import { nextListPosition, reorderList } from '../lib/order.ts';

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300).optional(),
  unit: z.enum(['page', 'chapter', 'percent']).optional(),
  total: z.number().positive().max(100000).nullable().optional(),
  status: z.enum(['reading', 'queued', 'finished']).optional(),
  notes: z.string().max(5000).optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().max(300).optional(),
  unit: z.enum(['page', 'chapter', 'percent']).optional(),
  total: z.number().positive().max(100000).nullable().optional(),
  current: z.number().min(0).max(100000).optional(),
  status: z.enum(['reading', 'queued', 'finished']).optional(),
  notes: z.string().max(5000).optional(),
});

export function bookRoutes(db: DB): Router {
  const router = Router();
  const getBook = (id: string) => db.prepare('SELECT * FROM books WHERE id = ?').get(id) as any;

  router.get('/books', (_req, res) => {
    const books = db
      .prepare(
        `SELECT * FROM books ORDER BY CASE status WHEN 'reading' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, queue_position`
      )
      .all();
    res.json({ books });
  });

  router.post('/books', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO books (id, title, author, unit, total, current, status, queue_position, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(
      id,
      b.title,
      b.author ?? '',
      b.unit ?? 'page',
      b.total ?? null,
      b.status ?? 'reading',
      nextListPosition(db, 'books', 'queue_position'),
      b.notes ?? '',
      nowIso()
    );
    res.status(201).json(getBook(id));
  });

  router.patch('/books/:id', (req, res) => {
    const book = getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'book not found' });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;

    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val);
    };
    for (const key of ['title', 'author', 'unit', 'total', 'notes'] as const) {
      if (key in b) set(key, (b as any)[key]);
    }
    if (b.current !== undefined) {
      const total = 'total' in b ? b.total : book.total;
      const clamped = total != null ? Math.min(b.current, total) : b.current;
      set('current', clamped);
    }
    if (b.status !== undefined && b.status !== book.status) {
      set('status', b.status);
      set('finished_at', b.status === 'finished' ? nowIso() : null);
    }
    if (fields.length > 0) {
      values.push(book.id);
      db.prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    res.json(getBook(book.id));
  });

  router.post('/books/reorder', (req, res) => {
    const schema = z.object({ bookIds: z.array(z.string()).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'bookIds must be an array' });
    reorderList(db, 'books', 'queue_position', parsed.data.bookIds);
    const books = db
      .prepare(
        `SELECT * FROM books ORDER BY CASE status WHEN 'reading' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, queue_position`
      )
      .all();
    res.json({ books });
  });

  router.delete('/books/:id', (req, res) => {
    const book = getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'book not found' });
    const tx = db.transaction(() => {
      db.prepare('UPDATE tasks SET book_id = NULL WHERE book_id = ?').run(book.id);
      db.prepare('DELETE FROM books WHERE id = ?').run(book.id);
    });
    tx();
    res.json({ ok: true });
  });

  return router;
}
