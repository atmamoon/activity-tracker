import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { makeApp, localToday, type TestContext } from './helpers.ts';
import { setSetting } from '../server/db.ts';

const today = localToday();

/** Fake Google backend: token endpoint + calendar API with an in-memory event store. */
function fakeGoogle() {
  const events = new Map<string, any>();
  let eventSeq = 1;
  const calls: Array<{ method: string; url: string; body?: any }> = [];

  const fetchImpl = vi.fn(async (url: any, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? tryParse(String(init.body)) : undefined;
    calls.push({ method, url: u, body });

    const json = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      const params = new URLSearchParams(String(init?.body));
      if (params.get('grant_type') === 'authorization_code') {
        return json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
      }
      if (params.get('refresh_token') === 'rt-revoked') {
        return json({ error: 'invalid_grant' }, 400);
      }
      return json({ access_token: 'at-2', expires_in: 3600 });
    }
    if (u.includes('/users/me/calendarList')) {
      return json({
        items: [
          { id: 'primary-cal', summary: 'Personal', primary: true, accessRole: 'owner' },
          { id: 'work-cal', summary: 'Work', accessRole: 'writer' },
        ],
      });
    }
    const eventsMatch = u.match(/\/calendars\/([^/]+)\/events(?:\/([^?/]+))?/);
    if (eventsMatch) {
      const calId = decodeURIComponent(eventsMatch[1]);
      const eventId = eventsMatch[2] ? decodeURIComponent(eventsMatch[2]) : null;
      if (method === 'GET' && !eventId) {
        const items = [...events.values()].filter((e) => e.calendarId === calId);
        return json({ items });
      }
      if (method === 'POST') {
        const id = `ev-${eventSeq++}`;
        events.set(id, { id, calendarId: calId, status: 'confirmed', ...body });
        return json({ id });
      }
      if (method === 'PATCH' && eventId) {
        if (!events.has(eventId)) return json({ error: { message: 'Not Found' } }, 404);
        events.set(eventId, { ...events.get(eventId), ...body });
        return json({ id: eventId });
      }
      if (method === 'DELETE' && eventId) {
        if (!events.has(eventId)) return json({ error: { message: 'Not Found' } }, 404);
        events.delete(eventId);
        return new Response(null, { status: 204 });
      }
    }
    return json({ error: { message: `Unhandled: ${method} ${u}` } }, 500);
  });

  return { fetchImpl, events, calls };
}

function tryParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function connect(ctx: TestContext) {
  setSetting(ctx.db, 'google_client_id', 'cid');
  setSetting(ctx.db, 'google_client_secret', 'csecret');
  setSetting(ctx.db, 'google_refresh_token', 'rt-1');
  setSetting(ctx.db, 'calendar_mode', 'google');
  setSetting(ctx.db, 'google_calendar_ids', JSON.stringify(['primary-cal']));
  setSetting(ctx.db, 'push_calendar_id', 'primary-cal');
}

let ctx: TestContext;
let fake: ReturnType<typeof fakeGoogle>;

beforeEach(() => {
  fake = fakeGoogle();
  ctx = makeApp(fake.fetchImpl as any);
});

describe('google calendar integration', () => {
  it('reports disconnected status initially', async () => {
    const res = await request(ctx.app).get('/api/calendar/status');
    expect(res.body).toMatchObject({ mode: 'none', googleConnected: false, hasClientCreds: false });
  });

  it('stores credentials and produces an auth url', async () => {
    await request(ctx.app)
      .post('/api/calendar/google/credentials')
      .send({ clientId: 'cid-123456789', clientSecret: 'csecret' });
    const res = await request(ctx.app).get('/api/calendar/google/auth');
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('accounts.google.com');
    expect(res.body.url).toContain('access_type=offline');
  });

  it('rejects the oauth callback with a bad state', async () => {
    const res = await request(ctx.app).get('/api/calendar/google/callback?code=x&state=forged');
    expect(res.status).toBe(400);
  });

  it('completes the oauth callback with a valid state and selects the primary calendar', async () => {
    await request(ctx.app)
      .post('/api/calendar/google/credentials')
      .send({ clientId: 'cid-123456789', clientSecret: 'csecret' });
    const { body } = await request(ctx.app).get('/api/calendar/google/auth');
    const state = new URL(body.url).searchParams.get('state')!;
    const cb = await request(ctx.app).get(
      `/api/calendar/google/callback?code=auth-code&state=${state}`
    );
    expect(cb.status).toBe(200);
    const status = await request(ctx.app).get('/api/calendar/status');
    expect(status.body.googleConnected).toBe(true);
    expect(status.body.mode).toBe('google');
    expect(status.body.selectedCalendarIds).toEqual(['primary-cal']);
  });

  it('syncs events into the cache and serves them with the day payload', async () => {
    connect(ctx);
    fake.events.set('interview-1', {
      id: 'interview-1',
      calendarId: 'primary-cal',
      summary: 'Interview with Acme',
      start: { dateTime: `${today}T15:00:00+05:30` },
      end: { dateTime: `${today}T16:00:00+05:30` },
    });
    const sync = await request(ctx.app).post('/api/calendar/sync').send({});
    expect(sync.status).toBe(200);
    expect(sync.body.eventCount).toBe(1);

    const day = await request(ctx.app).get(`/api/day/${today}`);
    expect(day.body.events).toHaveLength(1);
    expect(day.body.events[0].summary).toBe('Interview with Acme');

    // Event deleted on Google disappears after the next sync (full refresh).
    fake.events.delete('interview-1');
    await request(ctx.app).post('/api/calendar/sync').send({});
    const day2 = await request(ctx.app).get(`/api/day/${today}`);
    expect(day2.body.events).toHaveLength(0);
  });

  it('skips cancelled events and handles all-day events', async () => {
    connect(ctx);
    fake.events.set('c1', {
      id: 'c1',
      calendarId: 'primary-cal',
      summary: 'Cancelled thing',
      status: 'cancelled',
      start: { dateTime: `${today}T10:00:00+05:30` },
      end: { dateTime: `${today}T11:00:00+05:30` },
    });
    fake.events.set('a1', {
      id: 'a1',
      calendarId: 'primary-cal',
      summary: 'Assessment day',
      start: { date: today },
      end: { date: today },
    });
    await request(ctx.app).post('/api/calendar/sync').send({});
    const day = await request(ctx.app).get(`/api/day/${today}`);
    expect(day.body.events).toHaveLength(1);
    expect(day.body.events[0].all_day).toBe(1);
  });

  it('pushes a timed task as an event, syncs edits, and unpushes', async () => {
    connect(ctx);
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Mental math test', planned_start: '21:30', planned_minutes: 30 });

    const push = await request(ctx.app).post(`/api/tasks/${task.id}/push`);
    expect(push.status).toBe(200);
    expect(push.body.calendar_event_id).toBe('ev-1');
    const stored = fake.events.get('ev-1');
    expect(stored.summary).toBe('Mental math test');
    expect(stored.start.dateTime).toContain(`${today}T21:30:00`);

    // Editing the title/time re-pushes automatically.
    await request(ctx.app)
      .patch(`/api/tasks/${task.id}`)
      .send({ title: 'Mental math sprint', planned_start: '22:00' });
    const updated = fake.events.get('ev-1');
    expect(updated.summary).toBe('Mental math sprint');
    expect(updated.start.dateTime).toContain('22:00:00');

    const unpush = await request(ctx.app).post(`/api/tasks/${task.id}/unpush`);
    expect(unpush.body.calendar_event_id).toBeNull();
    expect(fake.events.has('ev-1')).toBe(false);
  });

  it('auto-schedules a task created with no time and allows pushing it immediately', async () => {
    connect(ctx);
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'No time given' });
    expect(task.planned_start).toBeTruthy();
    expect(task.planned_minutes).toBeGreaterThan(0);
    const push = await request(ctx.app).post(`/api/tasks/${task.id}/push`);
    expect(push.status).toBe(200);
  });

  it('refuses to push a task the scheduler could not fit anywhere today', async () => {
    connect(ctx);
    // Occupy the entire day so auto-scheduling has nowhere to place a new task.
    ctx.db
      .prepare(
        `INSERT INTO tasks (id, date, title, status, position, planned_start, planned_minutes, auto_time, created_at)
         VALUES ('blocker', ?, 'All-day blocker', 'todo', 5, '00:00', 1440, 0, 'x')`
      )
      .run(today);
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'No room left' });
    expect(task.planned_start).toBeNull();
    const res = await request(ctx.app).post(`/api/tasks/${task.id}/push`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start time/i);
  });

  it('removing the planned time of a pushed task deletes its event', async () => {
    connect(ctx);
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Timed', planned_start: '10:00', planned_minutes: 60 });
    await request(ctx.app).post(`/api/tasks/${task.id}/push`);
    expect(fake.events.size).toBe(1);
    const res = await request(ctx.app).patch(`/api/tasks/${task.id}`).send({ planned_start: null });
    expect(res.body.calendar_event_id).toBeNull();
    expect(fake.events.size).toBe(0);
  });

  it('deleting a task can also delete its calendar event', async () => {
    connect(ctx);
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Push then delete', planned_start: '09:00' });
    await request(ctx.app).post(`/api/tasks/${task.id}/push`);
    await request(ctx.app).delete(`/api/tasks/${task.id}?deleteEvent=1`);
    expect(fake.events.size).toBe(0);
  });

  it('surfaces a revoked refresh token as a sync error and disconnects', async () => {
    connect(ctx);
    setSetting(ctx.db, 'google_refresh_token', 'rt-revoked');
    const res = await request(ctx.app).post('/api/calendar/sync').send({});
    expect(res.status).toBe(502);
    const status = await request(ctx.app).get('/api/calendar/status');
    expect(status.body.googleConnected).toBe(false);
    expect(status.body.syncError).toBeTruthy();
  });

  it('push resolves the "primary" alias to the concrete calendar id', async () => {
    connect(ctx);
    setSetting(ctx.db, 'push_calendar_id', 'primary');
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Aliased push', planned_start: '11:00' });
    const push = await request(ctx.app).post(`/api/tasks/${task.id}/push`);
    // Stored calendar_id must match sync-cache key format (real id, not alias).
    expect(push.body.calendar_id).toBe('primary-cal');
    const status = await request(ctx.app).get('/api/calendar/status');
    expect(status.body.pushCalendarId).toBe('primary-cal');
  });

  it('a failed Google delete keeps the task linked instead of orphaning the event', async () => {
    const failing = fakeGoogle();
    const wrapped = (async (url: any, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE') {
        return new Response(JSON.stringify({ error: { message: 'backend exploded' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return failing.fetchImpl(url, init);
    }) as any;
    const ctx2 = makeApp(wrapped);
    connect(ctx2);
    const { body: task } = await request(ctx2.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Sticky link', planned_start: '12:00' });
    await request(ctx2.app).post(`/api/tasks/${task.id}/push`);
    const res = await request(ctx2.app).post(`/api/tasks/${task.id}/unpush`);
    expect(res.status).toBe(400);
    const day = await request(ctx2.app).get(`/api/day/${today}`);
    const after = day.body.tasks.find((t: any) => t.id === task.id);
    expect(after.calendar_event_id).not.toBeNull();
  });

  it('escapes HTML in the oauth callback page', async () => {
    const res = await request(ctx.app).get(
      '/api/calendar/google/callback?error=<script>alert(1)</script>&state=forged'
    );
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('serves only the active source after a mode switch (no stale cross-source events)', async () => {
    connect(ctx);
    fake.events.set('g1', {
      id: 'g1',
      calendarId: 'primary-cal',
      summary: 'Google event',
      start: { dateTime: `${today}T10:00:00+05:30` },
      end: { dateTime: `${today}T11:00:00+05:30` },
    });
    await request(ctx.app).post('/api/calendar/sync').send({});
    expect((await request(ctx.app).get(`/api/day/${today}`)).body.events).toHaveLength(1);
    // Switch to ics mode (no feed configured) — google's cached rows must not leak through.
    await request(ctx.app).post('/api/calendar/mode').send({ mode: 'ics' });
    expect((await request(ctx.app).get(`/api/day/${today}`)).body.events).toHaveLength(0);
    // Switch back — the cache is still there and serves instantly.
    await request(ctx.app).post('/api/calendar/mode').send({ mode: 'google' });
    expect((await request(ctx.app).get(`/api/day/${today}`)).body.events).toHaveLength(1);
  });

  it('disconnect clears google events and tokens', async () => {
    connect(ctx);
    fake.events.set('e1', {
      id: 'e1',
      calendarId: 'primary-cal',
      summary: 'X',
      start: { dateTime: `${today}T10:00:00+05:30` },
      end: { dateTime: `${today}T11:00:00+05:30` },
    });
    await request(ctx.app).post('/api/calendar/sync').send({});
    await request(ctx.app).post('/api/calendar/google/disconnect');
    const day = await request(ctx.app).get(`/api/day/${today}`);
    expect(day.body.events).toHaveLength(0);
    const status = await request(ctx.app).get('/api/calendar/status');
    expect(status.body.googleConnected).toBe(false);
  });
});
