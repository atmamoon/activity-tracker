import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, localToday, addDays, type TestContext } from './helpers.ts';

let ctx: TestContext;
const today = localToday();
const tomorrow = addDays(today, 1);
const yesterday = addDays(today, -1);

beforeEach(() => {
  ctx = makeApp();
});

describe('tasks API', () => {
  it('creates a task and lists it in the day payload', async () => {
    const create = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Do data questions' });
    expect(create.status).toBe(201);
    expect(create.body.title).toBe('Do data questions');
    expect(create.body.status).toBe('todo');

    const day = await request(ctx.app).get(`/api/day/${today}`);
    expect(day.status).toBe(200);
    expect(day.body.tasks).toHaveLength(1);
    expect(day.body.tasks[0].id).toBe(create.body.id);
  });

  it('rejects invalid dates, empty titles, and bad times', async () => {
    expect(
      (await request(ctx.app).post('/api/tasks').send({ date: '2026-13-99', title: 'x' })).status
    ).toBe(400);
    expect(
      (await request(ctx.app).post('/api/tasks').send({ date: today, title: '   ' })).status
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .post('/api/tasks')
          .send({ date: today, title: 'x', planned_start: '25:99' })
      ).status
    ).toBe(400);
    expect((await request(ctx.app).get('/api/day/not-a-date')).status).toBe(400);
  });

  it('validates 2026-02-29 style impossible dates', async () => {
    const res = await request(ctx.app).post('/api/tasks').send({ date: '2026-02-29', title: 'x' });
    expect(res.status).toBe(400);
  });

  it('marks done with completed_at, and back to todo clears it', async () => {
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'RCA drill' });
    const done = await request(ctx.app).patch(`/api/tasks/${task.id}`).send({ status: 'done' });
    expect(done.body.status).toBe('done');
    expect(done.body.completed_at).toBeTruthy();
    const undone = await request(ctx.app).patch(`/api/tasks/${task.id}`).send({ status: 'todo' });
    expect(undone.body.completed_at).toBeNull();
  });

  it('auto-schedules a task created with no time, and back-to-back new tasks do not overlap', async () => {
    const { body: t1 } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'a' });
    expect(t1.planned_start).toBeTruthy();
    expect(t1.planned_minutes).toBeGreaterThan(0);
    expect(t1.auto_time).toBe(1);
    const { body: t2 } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'b' });
    expect(t2.planned_start).not.toBe(t1.planned_start);
  });

  it('an explicit time at creation is pinned (auto_time=0) and not touched by later scheduling', async () => {
    const { body: t1 } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'fixed', planned_start: '09:00', planned_minutes: 30 });
    expect(t1.auto_time).toBe(0);
    await request(ctx.app).post('/api/tasks').send({ date: today, title: 'auto' });
    const after = await request(ctx.app).get(`/api/day/${today}`);
    const fixed = after.body.tasks.find((t: any) => t.id === t1.id);
    expect(fixed.planned_start).toBe('09:00');
  });

  it('resubmitting the same time via PATCH does not pin an auto-scheduled task', async () => {
    const { body: t1 } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'a' });
    expect(t1.auto_time).toBe(1);
    // Edit modal always sends planned_start; resubmitting the unchanged value
    // must not remove the task from future reflows.
    const patched = await request(ctx.app)
      .patch(`/api/tasks/${t1.id}`)
      .send({ title: 'a (renamed)', planned_start: t1.planned_start, planned_minutes: t1.planned_minutes });
    expect(patched.body.auto_time).toBe(1);
  });

  it('changing the time via PATCH pins the task; clearing it releases it back to auto', async () => {
    const { body: t1 } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'a' });
    const pinned = await request(ctx.app)
      .patch(`/api/tasks/${t1.id}`)
      .send({ planned_start: '20:00' });
    expect(pinned.body.auto_time).toBe(0);
    expect(pinned.body.planned_start).toBe('20:00');

    const released = await request(ctx.app)
      .patch(`/api/tasks/${t1.id}`)
      .send({ planned_start: null });
    expect(released.body.auto_time).toBe(1);
  });

  it('reordering re-sequences auto-scheduled times to match the new queue order', async () => {
    const { body: a } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'a' });
    const { body: b } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'b' });
    expect(a.planned_start < b.planned_start).toBe(true);

    const res = await request(ctx.app)
      .post(`/api/days/${today}/reorder`)
      .send({ taskIds: [b.id, a.id] });
    const byId = Object.fromEntries(res.body.tasks.map((t: any) => [t.id, t]));
    // b now comes first in the queue, so it should get the earlier time.
    expect(byId[b.id].planned_start < byId[a.id].planned_start).toBe(true);
  });

  it('reorders a day and appends unlisted tasks after listed ones', async () => {
    const ids: string[] = [];
    for (const title of ['a', 'b', 'c', 'd']) {
      const { body } = await request(ctx.app).post('/api/tasks').send({ date: today, title });
      ids.push(body.id);
    }
    const res = await request(ctx.app)
      .post(`/api/days/${today}/reorder`)
      .send({ taskIds: [ids[2], ids[0]] });
    expect(res.status).toBe(200);
    const order = res.body.tasks.map((t: any) => t.title);
    expect(order).toEqual(['c', 'a', 'b', 'd']);
  });

  it('reorder ignores ids from other days and duplicates', async () => {
    const { body: t1 } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'a' });
    const { body: t2 } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'b' });
    const { body: other } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: tomorrow, title: 'other-day' });
    const res = await request(ctx.app)
      .post(`/api/days/${today}/reorder`)
      .send({ taskIds: [t2.id, other.id, t2.id, t1.id] });
    expect(res.body.tasks.map((t: any) => t.title)).toEqual(['b', 'a']);
    const otherDay = await request(ctx.app).get(`/api/day/${tomorrow}`);
    expect(otherDay.body.tasks).toHaveLength(1);
  });

  it('moves a task to another date and records carried_from', async () => {
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'apply to jobs' });
    const moved = await request(ctx.app).patch(`/api/tasks/${task.id}`).send({ date: tomorrow });
    expect(moved.body.date).toBe(tomorrow);
    expect(moved.body.carried_from).toBe(today);

    // Moving again should preserve the original origin date.
    const moved2 = await request(ctx.app)
      .patch(`/api/tasks/${task.id}`)
      .send({ date: addDays(today, 2) });
    expect(moved2.body.carried_from).toBe(today);
  });

  it('lists carryover candidates and carries them into the target day', async () => {
    ctx.db
      .prepare(
        `INSERT INTO tasks (id, date, title, status, position, created_at)
         VALUES ('old1', ?, 'unfinished from yesterday', 'todo', 10, 'x'),
                ('old2', ?, 'done from yesterday', 'done', 20, 'x')`
      )
      .run(yesterday, yesterday);

    const cand = await request(ctx.app).get(`/api/days/${today}/carryover`);
    expect(cand.body.candidates.map((t: any) => t.id)).toEqual(['old1']);

    const res = await request(ctx.app)
      .post(`/api/days/${today}/carryover`)
      .send({ taskIds: ['old1', 'old2'] });
    expect(res.status).toBe(200);
    const titles = res.body.tasks.map((t: any) => t.title);
    expect(titles).toContain('unfinished from yesterday');
    // done task must NOT be carried
    expect(titles).not.toContain('done from yesterday');
    const carried = res.body.tasks.find((t: any) => t.id === 'old1');
    expect(carried.carried_from).toBe(yesterday);
  });

  it('carryover candidates for a future day exclude today\'s still-active tasks', async () => {
    await request(ctx.app).post('/api/tasks').send({ date: today, title: 'active today' });
    ctx.db
      .prepare(
        `INSERT INTO tasks (id, date, title, status, position, created_at)
         VALUES ('overdue', ?, 'overdue task', 'todo', 10, 'x')`
      )
      .run(yesterday);
    const res = await request(ctx.app).get(`/api/days/${tomorrow}/carryover`);
    expect(res.body.candidates.map((t: any) => t.id)).toEqual(['overdue']);
  });

  it('deletes a task', async () => {
    const { body: task } = await request(ctx.app).post('/api/tasks').send({ date: today, title: 'x' });
    const del = await request(ctx.app).delete(`/api/tasks/${task.id}`);
    expect(del.body.ok).toBe(true);
    expect((await request(ctx.app).get(`/api/day/${today}`)).body.tasks).toHaveLength(0);
    expect((await request(ctx.app).delete(`/api/tasks/${task.id}`)).status).toBe(404);
  });

  it('404s on patching a missing task', async () => {
    expect((await request(ctx.app).patch('/api/tasks/nope').send({ title: 'x' })).status).toBe(404);
  });
});
