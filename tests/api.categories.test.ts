import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, type TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = makeApp();
});

describe('categories API', () => {
  it('seeds the generic starter categories', async () => {
    const res = await request(ctx.app).get('/api/categories');
    const names = res.body.categories.map((c: any) => c.name);
    expect(names).toEqual([
      'Deep work',
      'Drills',
      'Reading',
      'Fitness',
      'Side project',
      'Meetings',
      'Admin',
      'Other',
    ]);
  });

  it('creates, renames, recolors, and archives a category', async () => {
    const { body: cat } = await request(ctx.app)
      .post('/api/categories')
      .send({ name: 'System Design', color: '#123abc', emoji: '🏗' });
    expect(cat.color).toBe('#123abc');

    const renamed = await request(ctx.app)
      .patch(`/api/categories/${cat.id}`)
      .send({ name: 'Sys Design', color: '#ff0000' });
    expect(renamed.body.name).toBe('Sys Design');

    const archived = await request(ctx.app).patch(`/api/categories/${cat.id}`).send({ archived: 1 });
    expect(archived.body.archived).toBe(1);
  });

  it('rejects bad colors and empty names', async () => {
    expect(
      (await request(ctx.app).post('/api/categories').send({ name: 'x', color: 'red' })).status
    ).toBe(400);
    expect(
      (await request(ctx.app).post('/api/categories').send({ name: '', color: '#112233' })).status
    ).toBe(400);
  });
});
