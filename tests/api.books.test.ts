import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, localToday, type TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = makeApp();
});

describe('books API', () => {
  it('creates, updates progress with clamping, and finishes a book', async () => {
    const { body: book } = await request(ctx.app)
      .post('/api/books')
      .send({ title: 'Thinking, Fast and Slow', author: 'Kahneman', unit: 'chapter', total: 38 });
    expect(book.status).toBe('reading');
    expect(book.current).toBe(0);

    // Progress beyond total clamps to total.
    const bumped = await request(ctx.app).patch(`/api/books/${book.id}`).send({ current: 50 });
    expect(bumped.body.current).toBe(38);

    const finished = await request(ctx.app)
      .patch(`/api/books/${book.id}`)
      .send({ status: 'finished' });
    expect(finished.body.finished_at).toBeTruthy();

    const reopened = await request(ctx.app)
      .patch(`/api/books/${book.id}`)
      .send({ status: 'reading' });
    expect(reopened.body.finished_at).toBeNull();
  });

  it('orders reading before queued before finished, then by queue position', async () => {
    const mk = (title: string, status: string) =>
      request(ctx.app).post('/api/books').send({ title, status });
    await mk('q1', 'queued');
    await mk('r1', 'reading');
    await mk('f1', 'finished');
    await mk('r2', 'reading');
    const res = await request(ctx.app).get('/api/books');
    expect(res.body.books.map((b: any) => b.title)).toEqual(['r1', 'r2', 'q1', 'f1']);
  });

  it('reorders books to set the read-next queue', async () => {
    const { body: a } = await request(ctx.app).post('/api/books').send({ title: 'A' });
    const { body: b } = await request(ctx.app).post('/api/books').send({ title: 'B' });
    const { body: c } = await request(ctx.app).post('/api/books').send({ title: 'C' });
    const res = await request(ctx.app)
      .post('/api/books/reorder')
      .send({ bookIds: [c.id, a.id, b.id] });
    expect(res.body.books.map((x: any) => x.title)).toEqual(['C', 'A', 'B']);
  });

  it('deleting a book unlinks its tasks instead of orphaning them', async () => {
    const { body: book } = await request(ctx.app).post('/api/books').send({ title: 'Doomed' });
    const today = localToday();
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Read Doomed', book_id: book.id });
    await request(ctx.app).delete(`/api/books/${book.id}`);
    const day = await request(ctx.app).get(`/api/day/${today}`);
    const after = day.body.tasks.find((t: any) => t.id === task.id);
    expect(after.book_id).toBeNull();
  });

  it('validates input', async () => {
    expect((await request(ctx.app).post('/api/books').send({ title: '' })).status).toBe(400);
    expect(
      (await request(ctx.app).post('/api/books').send({ title: 'x', unit: 'scrolls' })).status
    ).toBe(400);
    expect((await request(ctx.app).patch('/api/books/nope').send({ title: 'x' })).status).toBe(404);
  });
});
