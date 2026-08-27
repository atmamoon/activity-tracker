import type { DB } from '../db.ts';

const STEP = 10;

/** Next position at the end of a day's task list. */
export function nextTaskPosition(db: DB, date: string): number {
  const row = db
    .prepare('SELECT MAX(position) AS m FROM tasks WHERE date = ?')
    .get(date) as { m: number | null };
  return (row.m ?? 0) + STEP;
}

/**
 * Rewrite positions for a day so tasks appear in the given id order.
 * Ids not belonging to the day are ignored; day tasks missing from the
 * list keep their relative order after the listed ones.
 */
export function reorderDay(db: DB, date: string, orderedIds: string[]) {
  const existing = db
    .prepare('SELECT id FROM tasks WHERE date = ? ORDER BY position, created_at')
    .all(date) as Array<{ id: string }>;
  const existingIds = new Set(existing.map((r) => r.id));
  const seen = new Set<string>();
  const finalOrder: string[] = [];
  for (const id of orderedIds) {
    if (existingIds.has(id) && !seen.has(id)) {
      finalOrder.push(id);
      seen.add(id);
    }
  }
  for (const { id } of existing) {
    if (!seen.has(id)) finalOrder.push(id);
  }
  const update = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
  const tx = db.transaction(() => {
    finalOrder.forEach((id, i) => update.run((i + 1) * STEP, id));
  });
  tx();
}

/** Generic list reorder for books/templates/categories. */
export function reorderList(
  db: DB,
  table: 'books' | 'templates' | 'categories',
  positionCol: string,
  orderedIds: string[]
) {
  const update = db.prepare(`UPDATE ${table} SET ${positionCol} = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => update.run((i + 1) * STEP, id));
  });
  tx();
}

export function nextListPosition(db: DB, table: 'books' | 'templates' | 'categories', positionCol: string): number {
  const row = db.prepare(`SELECT MAX(${positionCol}) AS m FROM ${table}`).get() as {
    m: number | null;
  };
  return (row.m ?? 0) + STEP;
}
