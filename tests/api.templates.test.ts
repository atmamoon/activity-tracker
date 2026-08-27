import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, localToday, addDays, type TestContext } from './helpers.ts';
import { weekdayOf } from '../server/lib/materialize.ts';

let ctx: TestContext;
const today = localToday();

beforeEach(() => {
  ctx = makeApp();
});

describe('templates (daily blocks)', () => {
  it('materializes an active template into today exactly once', async () => {
    const { body: tpl } = await request(ctx.app)
      .post('/api/templates')
      .send({ title: 'Daily reading', days: [0, 1, 2, 3, 4, 5, 6], planned_minutes: 45 });
    expect(tpl.days).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const day1 = await request(ctx.app).get(`/api/day/${today}`);
    expect(day1.body.tasks.map((t: any) => t.title)).toEqual(['Daily reading']);
    expect(day1.body.tasks[0].template_id).toBe(tpl.id);

    // Fetch again — must not duplicate.
    const day2 = await request(ctx.app).get(`/api/day/${today}`);
    expect(day2.body.tasks).toHaveLength(1);
  });

  it('deleting a seeded task does not resurrect it', async () => {
    await request(ctx.app).post('/api/templates').send({ title: 'Practice', days: [0, 1, 2, 3, 4, 5, 6] });
    const day = await request(ctx.app).get(`/api/day/${today}`);
    await request(ctx.app).delete(`/api/tasks/${day.body.tasks[0].id}`);
    const again = await request(ctx.app).get(`/api/day/${today}`);
    expect(again.body.tasks).toHaveLength(0);
  });

  it('does not seed past days or non-matching weekdays', async () => {
    const yesterday = addDays(today, -1);
    const dayAfterTomorrow = addDays(today, 2);
    // Template that runs only on the weekday of dayAfterTomorrow.
    await request(ctx.app)
      .post('/api/templates')
      .send({ title: 'Specific-day block', days: [weekdayOf(dayAfterTomorrow)] });

    const past = await request(ctx.app).get(`/api/day/${yesterday}`);
    expect(past.body.tasks).toHaveLength(0);

    const target = await request(ctx.app).get(`/api/day/${dayAfterTomorrow}`);
    expect(target.body.tasks.map((t: any) => t.title)).toEqual(['Specific-day block']);

    // A day whose weekday doesn't match gets nothing. Find the next day that
    // doesn't match the template weekday.
    let nonMatching = addDays(today, 3);
    while (weekdayOf(nonMatching) === weekdayOf(dayAfterTomorrow)) {
      nonMatching = addDays(nonMatching, 1);
    }
    const miss = await request(ctx.app).get(`/api/day/${nonMatching}`);
    expect(miss.body.tasks).toHaveLength(0);
  });

  it('paused templates do not seed; reactivating seeds future views', async () => {
    const { body: tpl } = await request(ctx.app)
      .post('/api/templates')
      .send({ title: 'Quant drills', active: 0 });
    expect((await request(ctx.app).get(`/api/day/${today}`)).body.tasks).toHaveLength(0);

    await request(ctx.app).patch(`/api/templates/${tpl.id}`).send({ active: 1 });
    expect((await request(ctx.app).get(`/api/day/${today}`)).body.tasks).toHaveLength(1);
  });

  it('validates template input', async () => {
    expect((await request(ctx.app).post('/api/templates').send({ title: '' })).status).toBe(400);
    expect(
      (await request(ctx.app).post('/api/templates').send({ title: 'x', days: [9] })).status
    ).toBe(400);
    expect(
      (await request(ctx.app).post('/api/templates').send({ title: 'x', planned_start: '99:99' }))
        .status
    ).toBe(400);
  });

  it('deletes a template and cleans up seeds + task links', async () => {
    const { body: tpl } = await request(ctx.app).post('/api/templates').send({ title: 'Del me' });
    const day = await request(ctx.app).get(`/api/day/${today}`);
    const seededTask = day.body.tasks[0];
    await request(ctx.app).delete(`/api/templates/${tpl.id}`);
    // Task remains but is unlinked; template gone; day_seeds cleaned.
    const after = await request(ctx.app).get(`/api/day/${today}`);
    expect(after.body.tasks[0].id).toBe(seededTask.id);
    expect(after.body.tasks[0].template_id).toBeNull();
    expect((await request(ctx.app).get('/api/templates')).body.templates).toHaveLength(0);
  });

  it('reorders templates', async () => {
    const { body: a } = await request(ctx.app).post('/api/templates').send({ title: 'A' });
    const { body: b } = await request(ctx.app).post('/api/templates').send({ title: 'B' });
    const res = await request(ctx.app)
      .post('/api/templates/reorder')
      .send({ templateIds: [b.id, a.id] });
    expect(res.body.templates.map((t: any) => t.title)).toEqual(['B', 'A']);
  });
});
