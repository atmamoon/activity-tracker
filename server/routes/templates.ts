import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db.ts';
import { nextListPosition, reorderList } from '../lib/order.ts';
import { isValidTimeStr } from '../lib/time.ts';

const daysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7);

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  category_id: z.string().nullable().optional(),
  days: daysSchema.optional(),
  planned_start: z.string().refine(isValidTimeStr, 'invalid time').nullable().optional(),
  planned_minutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
  active: z.union([z.literal(0), z.literal(1)]).optional(),
});

const patchSchema = createSchema.partial();

export function templateRoutes(db: DB): Router {
  const router = Router();
  const getTemplate = (id: string) =>
    db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as any;

  const serialize = (t: any) => ({ ...t, days: JSON.parse(t.days) });

  router.get('/templates', (_req, res) => {
    const templates = (db.prepare('SELECT * FROM templates ORDER BY position').all() as any[]).map(
      serialize
    );
    res.json({ templates });
  });

  router.post('/templates', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO templates (id, title, category_id, days, planned_start, planned_minutes, position, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      b.title,
      b.category_id ?? null,
      JSON.stringify([...new Set(b.days ?? [0, 1, 2, 3, 4, 5, 6])].sort()),
      b.planned_start ?? null,
      b.planned_minutes ?? null,
      nextListPosition(db, 'templates', 'position'),
      b.active ?? 1
    );
    res.status(201).json(serialize(getTemplate(id)));
  });

  router.patch('/templates/:id', (req, res) => {
    const template = getTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: 'template not found' });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const b = parsed.data;
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, val: unknown) => {
      fields.push(`${col} = ?`);
      values.push(val);
    };
    for (const key of ['title', 'category_id', 'planned_start', 'planned_minutes', 'active'] as const) {
      if (key in b) set(key, (b as any)[key]);
    }
    if (b.days !== undefined) set('days', JSON.stringify([...new Set(b.days)].sort()));
    if (fields.length > 0) {
      values.push(template.id);
      db.prepare(`UPDATE templates SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    res.json(serialize(getTemplate(template.id)));
  });

  router.post('/templates/reorder', (req, res) => {
    const schema = z.object({ templateIds: z.array(z.string()).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'templateIds must be an array' });
    reorderList(db, 'templates', 'position', parsed.data.templateIds);
    const templates = (db.prepare('SELECT * FROM templates ORDER BY position').all() as any[]).map(
      serialize
    );
    res.json({ templates });
  });

  router.delete('/templates/:id', (req, res) => {
    const template = getTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: 'template not found' });
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM day_seeds WHERE template_id = ?').run(template.id);
      db.prepare('UPDATE tasks SET template_id = NULL WHERE template_id = ?').run(template.id);
      db.prepare('DELETE FROM templates WHERE id = ?').run(template.id);
    });
    tx();
    res.json({ ok: true });
  });

  return router;
}
