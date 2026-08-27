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
