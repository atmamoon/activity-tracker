import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db.ts';
import { nextListPosition, reorderList } from '../lib/order.ts';

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex value like #3b82f6');

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: colorSchema,
  emoji: z.string().max(8).optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: colorSchema.optional(),
  emoji: z.string().max(8).optional(),
  archived: z.union([z.literal(0), z.literal(1)]).optional(),
});

export function categoryRoutes(db: DB): Router {
  const router = Router();
  const getCategory = (id: string) =>
    db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as any;

  router.get('/categories', (_req, res) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY position').all();
    res.json({ categories });
  });

  router.post('/categories', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const id = randomUUID();
    db.prepare(
      'INSERT INTO categories (id, name, color, emoji, position, archived) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(id, b.name, b.color, b.emoji ?? '', nextListPosition(db, 'categories', 'position'));
    res.status(201).json(getCategory(id));
  });

  router.patch('/categories/:id', (req, res) => {
    const category = getCategory(req.params.id);
    if (!category) return res.status(404).json({ error: 'category not found' });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['name', 'color', 'emoji', 'archived'] as const) {
      if (key in b) {
        fields.push(`${key} = ?`);
        values.push((b as any)[key]);
      }
    }
    if (fields.length > 0) {
      values.push(category.id);
      db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    res.json(getCategory(category.id));
  });

  router.post('/categories/reorder', (req, res) => {
    const schema = z.object({ categoryIds: z.array(z.string()).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'categoryIds must be an array' });
    reorderList(db, 'categories', 'position', parsed.data.categoryIds);
    res.json({ categories: db.prepare('SELECT * FROM categories ORDER BY position').all() });
  });

  return router;
}
