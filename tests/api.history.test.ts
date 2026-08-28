import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, localToday, addDays, type TestContext } from './helpers.ts';

let ctx: TestContext;
const today = localToday();
const yesterday = addDays(today, -1);
const twoDaysAgo = addDays(today, -2);

beforeEach(() => {
  ctx = makeApp();
});

/** Insert a task directly so tests can control date/status without auto-scheduling. */
function seedTask(opts: {
  id: string;
  date: string;
  title: string;
  status?: string;
  planned_start?: string | null;
  planned_minutes?: number | null;
  category_id?: string | null;
  completed_at?: string | null;
  position?: number;
}) {
  ctx.db
    .prepare(
      `INSERT INTO tasks (id, date, title, status, position, planned_start, planned_minutes,
         category_id, auto_time, completed_at, created_at)
       VALUES (@id, @date, @title, @status, @position, @planned_start, @planned_minutes,
         @category_id, 0, @completed_at, 'x')`
    )
    .run({
      status: 'todo',
      planned_start: null,
      planned_minutes: null,
      category_id: null,
      completed_at: null,
      position: 10,
      ...opts,
    });
}

describe('activity log', () => {
  it('records a done event with a snapshot of the task details', async () => {
    const cats = await request(ctx.app).get('/api/categories');
    const cat = cats.body.categories[0];
    seedTask({
      id: 't1',
      date: today,
      title: 'RCA drill',
      planned_start: '09:00',
      planned_minutes: 45,
      category_id: cat.id,
    });

    await request(ctx.app).patch('/api/tasks/t1').send({ status: 'done' });

    const rows = ctx.db.prepare('SELECT * FROM activity_log').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_id: 't1',
      title: 'RCA drill',
      event: 'done',
      planned_start: '09:00',
      planned_minutes: 45,
      category_name: cat.name,
    });
    expect(rows[0].at).toBeTruthy();
  });

  it('records skipped and reopened transitions but not no-op writes', async () => {
    seedTask({ id: 't1', date: today, title: 'x' });
    await request(ctx.app).patch('/api/tasks/t1').send({ status: 'skipped' });
    await request(ctx.app).patch('/api/tasks/t1').send({ status: 'todo' });
    await request(ctx.app).patch('/api/tasks/t1').send({ status: 'todo' }); // no change
    await request(ctx.app).patch('/api/tasks/t1').send({ title: 'renamed' }); // not a status change

    const events = (ctx.db.prepare('SELECT event FROM activity_log ORDER BY rowid').all() as any[]).map(
      (r) => r.event
    );
    expect(events).toEqual(['skipped', 'reopened']);
  });

  it('logs a deletion so completed work is not erased from history', async () => {
    seedTask({ id: 't1', date: yesterday, title: 'Finished then deleted', planned_minutes: 30 });
    await request(ctx.app).patch('/api/tasks/t1').send({ status: 'done' });
    await request(ctx.app).delete('/api/tasks/t1');

    const events = (ctx.db.prepare('SELECT event FROM activity_log ORDER BY rowid').all() as any[]).map(
      (r) => r.event
    );
    expect(events).toEqual(['done', 'deleted']);

    // Still surfaces in history, flagged as removed.
    const res = await request(ctx.app).get('/api/history?days=7');
    const entries = res.body.days.flatMap((d: any) => d.entries);
    const entry = entries.find((e: any) => e.title === 'Finished then deleted');
    expect(entry).toBeTruthy();
    expect(entry.status).toBe('done');
    expect(entry.removed).toBe(true);
  });

  it('keeps history readable after the category is renamed', async () => {
    const cats = await request(ctx.app).get('/api/categories');
    const cat = cats.body.categories[0];
    seedTask({ id: 't1', date: today, title: 'x', category_id: cat.id });
    await request(ctx.app).patch('/api/tasks/t1').send({ status: 'done' });
    await request(ctx.app).patch(`/api/categories/${cat.id}`).send({ name: 'Renamed Later' });

    const row = ctx.db.prepare('SELECT category_name FROM activity_log').get() as any;
    expect(row.category_name).toBe(cat.name); // snapshot, not the new name
  });
});

describe('GET /api/history', () => {
  it('groups entries by date, newest first, with per-day summaries', async () => {
    seedTask({
      id: 'a',
      date: yesterday,
      title: 'done task',
      status: 'done',
      planned_minutes: 30,
      completed_at: new Date().toISOString(),
    });
    seedTask({ id: 'b', date: yesterday, title: 'missed task', planned_minutes: 15, position: 20 });
    seedTask({ id: 'c', date: twoDaysAgo, title: 'older done', status: 'done', planned_minutes: 60 });

    const res = await request(ctx.app).get('/api/history?days=7');
    expect(res.status).toBe(200);
    expect(res.body.days.map((d: any) => d.date)).toEqual([yesterday, twoDaysAgo]);

    const day = res.body.days[0];
    expect(day.summary).toMatchObject({ done: 1, missed: 1, doneMinutes: 30 });
    // An unfinished task in the past reads as "missed", not "planned".
    expect(day.entries.find((e: any) => e.title === 'missed task').status).toBe('missed');
  });

  it('reports slot, duration and completion time for each entry', async () => {
    const completedAt = new Date().toISOString();
    seedTask({
      id: 'a',
      date: yesterday,
      title: 'Deep work',
      status: 'done',
      planned_start: '14:30',
      planned_minutes: 90,
      completed_at: completedAt,
    });
    const res = await request(ctx.app).get('/api/history?days=7');
    const entry = res.body.days[0].entries[0];
    expect(entry).toMatchObject({
      title: 'Deep work',
      planned_start: '14:30',
      planned_minutes: 90,
      status: 'done',
      completed_at: completedAt,
      date: yesterday,
    });
  });

  it('filters by status, category and search text', async () => {
    const cats = await request(ctx.app).get('/api/categories');
    const cat = cats.body.categories[0];
    seedTask({ id: 'a', date: yesterday, title: 'alpha done', status: 'done', category_id: cat.id });
    seedTask({ id: 'b', date: yesterday, title: 'beta missed', position: 20 });

    const doneOnly = await request(ctx.app).get('/api/history?days=7&status=done');
    expect(doneOnly.body.total).toBe(1);
    expect(doneOnly.body.days[0].entries[0].title).toBe('alpha done');

    const byCat = await request(ctx.app).get(`/api/history?days=7&categoryId=${cat.id}`);
    expect(byCat.body.total).toBe(1);

    const uncategorized = await request(ctx.app).get('/api/history?days=7&categoryId=none');
    expect(uncategorized.body.days[0].entries[0].title).toBe('beta missed');

    const search = await request(ctx.app).get('/api/history?days=7&q=BETA');
    expect(search.body.total).toBe(1);
    expect(search.body.days[0].entries[0].title).toBe('beta missed');
  });

  it('honours an explicit date range and excludes days outside it', async () => {
    seedTask({ id: 'a', date: yesterday, title: 'in range', status: 'done' });
    seedTask({ id: 'b', date: addDays(today, -20), title: 'out of range', status: 'done' });

    const res = await request(ctx.app).get(`/api/history?from=${yesterday}&to=${today}`);
    const titles = res.body.days.flatMap((d: any) => d.entries.map((e: any) => e.title));
    expect(titles).toEqual(['in range']);
  });
});

describe('GET /api/stats', () => {
  it('computes totals, completion rate and time logged', async () => {
    seedTask({ id: 'a', date: yesterday, title: 'a', status: 'done', planned_minutes: 60 });
    seedTask({ id: 'b', date: yesterday, title: 'b', status: 'done', planned_minutes: 30, position: 20 });
    seedTask({ id: 'c', date: yesterday, title: 'c', planned_minutes: 30, position: 30 });

    const res = await request(ctx.app).get('/api/stats?days=7');
    expect(res.body.totals).toMatchObject({
      planned: 3,
      done: 2,
      missed: 1,
      doneMinutes: 90,
      activeDays: 1,
    });
    expect(res.body.totals.completionRate).toBeCloseTo(2 / 3);
    expect(res.body.totals.avgMinutesPerActiveDay).toBe(90);
  });

  it("does not count today's still-open tasks against the completion rate", async () => {
    seedTask({ id: 'a', date: yesterday, title: 'done', status: 'done', planned_minutes: 30 });
    seedTask({ id: 'b', date: today, title: 'still open today', planned_minutes: 30, position: 20 });

    const res = await request(ctx.app).get('/api/stats?days=7');
    // 1 done, 0 missed, 1 pending → the open item is not a failure yet.
    expect(res.body.totals).toMatchObject({ done: 1, missed: 0, pending: 1 });
    expect(res.body.totals.completionRate).toBe(1);
  });

  it('reports each category share of logged time', async () => {
    const cats = await request(ctx.app).get('/api/categories');
    const [c1, c2] = cats.body.categories;
    seedTask({ id: 'a', date: yesterday, title: 'a', status: 'done', planned_minutes: 90, category_id: c1.id });
    seedTask({
      id: 'b',
      date: yesterday,
      title: 'b',
      status: 'done',
      planned_minutes: 30,
      category_id: c2.id,
      position: 20,
    });

    const res = await request(ctx.app).get('/api/stats?days=7');
    const top = res.body.categories[0];
    expect(top.name).toBe(c1.name);
    expect(top.doneMinutes).toBe(90);
    expect(top.share).toBeCloseTo(0.75);
    expect(res.body.categories[1].share).toBeCloseTo(0.25);
  });

  it('measures per-activity consistency and the current streak', async () => {
    // "Daily reading" done on the last three days; "Quant" done once, missed once.
    for (let i = 1; i <= 3; i++) {
      seedTask({ id: `r${i}`, date: addDays(today, -i), title: 'Daily reading', status: 'done', planned_minutes: 30 });
    }
    seedTask({ id: 'q1', date: addDays(today, -1), title: 'Quant', status: 'done', position: 20 });
    seedTask({ id: 'q2', date: addDays(today, -2), title: 'Quant', position: 20 });

    const res = await request(ctx.app).get('/api/stats?days=7');
    const reading = res.body.activities.find((a: any) => a.title === 'Daily reading');
    expect(reading).toMatchObject({ plannedDays: 3, doneDays: 3, currentStreak: 3 });
    expect(reading.completionRate).toBe(1);

    const quant = res.body.activities.find((a: any) => a.title === 'Quant');
    expect(quant).toMatchObject({ plannedDays: 2, doneDays: 1, missedDays: 1, currentStreak: 1 });
    expect(quant.completionRate).toBeCloseTo(0.5);
  });

  it('excludes future days from stats so upcoming plans do not count as misses', async () => {
    seedTask({ id: 'future', date: addDays(today, 3), title: 'Planned ahead', planned_minutes: 30 });
    seedTask({ id: 'past', date: yesterday, title: 'Did it', status: 'done', planned_minutes: 30 });

    const res = await request(ctx.app).get('/api/stats?days=30');
    expect(res.body.totals.planned).toBe(1);
    expect(res.body.totals.missed).toBe(0);
    expect(res.body.totals.completionRate).toBe(1);
  });
});
