import { Router } from 'express';
import type { DB } from '../db.ts';
import { isValidDateStr, addDaysStr, localToday } from '../lib/time.ts';

export type EntryStatus = 'done' | 'skipped' | 'missed' | 'planned' | 'removed';

export interface HistoryEntry {
  id: string;
  task_id: string | null;
  date: string;
  title: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  category_emoji: string | null;
  book_title: string | null;
  planned_start: string | null;
  planned_minutes: number | null;
  status: EntryStatus;
  completed_at: string | null;
  carried_from: string | null;
  removed: boolean;
}

interface Filters {
  categoryId?: string;
  status?: string;
  q?: string;
}

/** Display status: a still-open task in the past counts as missed, not pending. */
function deriveStatus(status: string, date: string, today: string): EntryStatus {
  if (status === 'done') return 'done';
  if (status === 'skipped') return 'skipped';
  return date < today ? 'missed' : 'planned';
}

/**
 * Flat list of activity entries in [from, to], newest first. Combines live
 * task rows with log entries whose task was since deleted, so removing a task
 * never silently erases the record of the work.
 */
export function buildEntries(db: DB, from: string, to: string, filters: Filters = {}): HistoryEntry[] {
  const today = localToday();
  const categories = new Map(
    (db.prepare('SELECT * FROM categories').all() as any[]).map((c) => [c.id, c])
  );
  const books = new Map(
    (db.prepare('SELECT id, title FROM books').all() as any[]).map((b) => [b.id, b.title])
  );

  const entries: HistoryEntry[] = [];

  const tasks = db
    .prepare('SELECT * FROM tasks WHERE date >= ? AND date <= ? ORDER BY date DESC, position')
    .all(from, to) as any[];
  for (const t of tasks) {
    const cat = t.category_id ? categories.get(t.category_id) : undefined;
    entries.push({
      id: t.id,
      task_id: t.id,
      date: t.date,
      title: t.title,
      category_id: t.category_id,
      category_name: cat?.name ?? null,
      category_color: cat?.color ?? null,
      category_emoji: cat?.emoji ?? null,
      book_title: t.book_id ? (books.get(t.book_id) ?? null) : null,
      planned_start: t.planned_start,
      planned_minutes: t.planned_minutes,
      status: deriveStatus(t.status, t.date, today),
      completed_at: t.completed_at,
      carried_from: t.carried_from,
      removed: false,
    });
  }

  // Deleted tasks: reconstruct one entry per task from its log trail.
  const orphanRows = db
    .prepare(
      `SELECT l.* FROM activity_log l
       WHERE l.date >= ? AND l.date <= ?
         AND l.task_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = l.task_id)
       ORDER BY l.at`
    )
    .all(from, to) as any[];
  const byTask = new Map<string, any[]>();
  for (const row of orphanRows) {
    const list = byTask.get(row.task_id) ?? [];
    list.push(row);
    byTask.set(row.task_id, list);
  }
  for (const [taskId, rows] of byTask) {
    // The latest state-bearing event describes what actually happened; a
    // trailing 'deleted' event only tells us the task is gone.
    const stateful = rows.filter((r) => r.event !== 'deleted');
    const rep = stateful.length > 0 ? stateful[stateful.length - 1] : rows[rows.length - 1];
    const status: EntryStatus =
      rep.event === 'done' ? 'done' : rep.event === 'skipped' ? 'skipped' : 'removed';
    const cat = rep.category_id ? categories.get(rep.category_id) : undefined;
    entries.push({
      id: `log:${taskId}`,
      task_id: taskId,
      date: rep.date,
      title: rep.title,
      category_id: rep.category_id,
      category_name: rep.category_name ?? cat?.name ?? null,
      category_color: cat?.color ?? null,
      category_emoji: cat?.emoji ?? null,
      book_title: rep.book_id ? (books.get(rep.book_id) ?? null) : null,
      planned_start: rep.planned_start,
      planned_minutes: rep.planned_minutes,
      status,
      completed_at: rep.event === 'done' ? rep.at : null,
      carried_from: null,
      removed: true,
    });
  }

  let out = entries;
  if (filters.categoryId) {
    out =
      filters.categoryId === 'none'
        ? out.filter((e) => !e.category_id)
        : out.filter((e) => e.category_id === filters.categoryId);
  }
  if (filters.status && filters.status !== 'all') {
    out = out.filter((e) => e.status === filters.status);
  }
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    out = out.filter((e) => e.title.toLowerCase().includes(needle));
  }

  return out.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (a.planned_start ?? '99:99').localeCompare(b.planned_start ?? '99:99') ||
      a.title.localeCompare(b.title)
  );
}

function resolveRange(query: Record<string, unknown>): { from: string; to: string } {
  const today = localToday();
  const to = isValidDateStr(query.to) ? (query.to as string) : today;
  if (isValidDateStr(query.from)) return { from: query.from as string, to };
  const days = Number(query.days);
  if (Number.isFinite(days) && days > 0) {
    return { from: addDaysStr(to, -Math.min(Math.trunc(days), 3650) + 1), to };
  }
  return { from: addDaysStr(to, -29), to };
}

export function historyRoutes(db: DB): Router {
  const router = Router();

  router.get('/history', (req, res) => {
    const { from, to } = resolveRange(req.query as Record<string, unknown>);
    const entries = buildEntries(db, from, to, {
      categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      q: typeof req.query.q === 'string' ? req.query.q.trim() : undefined,
    });

    const byDate = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const list = byDate.get(e.date) ?? [];
      list.push(e);
      byDate.set(e.date, list);
    }
    const days = [...byDate.entries()].map(([date, dayEntries]) => ({
      date,
      entries: dayEntries,
      summary: {
        done: dayEntries.filter((e) => e.status === 'done').length,
        skipped: dayEntries.filter((e) => e.status === 'skipped').length,
        missed: dayEntries.filter((e) => e.status === 'missed').length,
        planned: dayEntries.filter((e) => e.status === 'planned').length,
        doneMinutes: dayEntries
          .filter((e) => e.status === 'done')
          .reduce((sum, e) => sum + (e.planned_minutes ?? 0), 0),
      },
    }));

    res.json({ from, to, days, total: entries.length });
  });

  router.get('/stats', (req, res) => {
    const { from, to } = resolveRange(req.query as Record<string, unknown>);
    const entries = buildEntries(db, from, to);
    const today = localToday();
    // Future days aren't evidence of anything yet — exclude them from stats.
    const settled = entries.filter((e) => e.date <= today);

    const doneEntries = settled.filter((e) => e.status === 'done');
    const doneMinutes = doneEntries.reduce((s, e) => s + (e.planned_minutes ?? 0), 0);

    // Time share and counts per category.
    const catMap = new Map<string, any>();
    for (const e of settled) {
      const key = e.category_id ?? 'none';
      const row =
        catMap.get(key) ??
        {
          id: e.category_id,
          name: e.category_name ?? 'Uncategorized',
          color: e.category_color,
          emoji: e.category_emoji,
          planned: 0,
          done: 0,
          skipped: 0,
          missed: 0,
          doneMinutes: 0,
          share: 0,
        };
      row.planned += 1;
      if (e.status === 'done') {
        row.done += 1;
        row.doneMinutes += e.planned_minutes ?? 0;
      } else if (e.status === 'skipped') row.skipped += 1;
      else if (e.status === 'missed') row.missed += 1;
      catMap.set(key, row);
    }
    const categories = [...catMap.values()]
      .map((c) => ({ ...c, share: doneMinutes > 0 ? c.doneMinutes / doneMinutes : 0 }))
      .sort((a, b) => b.doneMinutes - a.doneMinutes || b.done - a.done);

    // Consistency per recurring activity, keyed on the title.
    const actMap = new Map<string, any>();
    for (const e of settled) {
      const key = e.title.trim().toLowerCase();
      const row =
        actMap.get(key) ??
        {
          title: e.title,
          category_name: e.category_name,
          category_color: e.category_color,
          dates: new Map<string, string>(),
          doneMinutes: 0,
        };
      // One verdict per day; a completion outranks anything else that day.
      const prev = row.dates.get(e.date);
      if (prev !== 'done') row.dates.set(e.date, e.status);
      if (e.status === 'done') row.doneMinutes += e.planned_minutes ?? 0;
      actMap.set(key, row);
    }
    const activities = [...actMap.values()]
      .map((a) => {
        const dates = [...a.dates.entries()].sort((x, y) => y[0].localeCompare(x[0]));
        const doneDays = dates.filter(([, s]) => s === 'done').length;
        const plannedDays = dates.length;
        let streak = 0;
        for (const [, s] of dates) {
          if (s !== 'done') break;
          streak += 1;
        }
        const lastDone = dates.find(([, s]) => s === 'done')?.[0] ?? null;
        return {
          title: a.title,
          category_name: a.category_name,
          category_color: a.category_color,
          plannedDays,
          doneDays,
          missedDays: dates.filter(([, s]) => s === 'missed').length,
          skippedDays: dates.filter(([, s]) => s === 'skipped').length,
          completionRate: plannedDays > 0 ? doneDays / plannedDays : 0,
          currentStreak: streak,
          lastDone,
          doneMinutes: a.doneMinutes,
        };
      })
      .sort((a, b) => b.plannedDays - a.plannedDays || b.completionRate - a.completionRate);

    const activeDays = new Set(settled.map((e) => e.date)).size;
    const missed = settled.filter((e) => e.status === 'missed').length;
    // Today's still-open tasks aren't failures yet, so they stay out of the
    // rate — it measures work that actually came due: done vs missed.
    const resolved = doneEntries.length + missed;
    res.json({
      from,
      to,
      totals: {
        activeDays,
        planned: settled.length,
        done: doneEntries.length,
        skipped: settled.filter((e) => e.status === 'skipped').length,
        missed,
        pending: settled.filter((e) => e.status === 'planned').length,
        doneMinutes,
        completionRate: resolved > 0 ? doneEntries.length / resolved : 0,
        avgMinutesPerActiveDay: activeDays > 0 ? Math.round(doneMinutes / activeDays) : 0,
      },
      categories,
      activities,
    });
  });

  return router;
}
