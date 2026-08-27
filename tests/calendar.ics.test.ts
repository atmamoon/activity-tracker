import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, localToday, addDays, type TestContext } from './helpers.ts';
import { expandIcsEvents, parseIcsString } from '../server/lib/ics.ts';

const today = localToday();

const fixture = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', body, 'END:VCALENDAR'].join('\r\n');

const ymd = (date: string) => date.replaceAll('-', '');

describe('expandIcsEvents', () => {
  it('includes simple events inside the window and excludes ones outside', () => {
    const data = parseIcsString(
      fixture(
        [
          'BEGIN:VEVENT',
          'UID:inside@test',
          `DTSTART:${ymd(today)}T090000Z`,
          `DTEND:${ymd(today)}T100000Z`,
          'SUMMARY:Inside window',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:outside@test',
          `DTSTART:${ymd(addDays(today, 30))}T090000Z`,
          `DTEND:${ymd(addDays(today, 30))}T100000Z`,
          'SUMMARY:Far future',
          'END:VEVENT',
        ].join('\r\n')
      )
    );
    const from = new Date(`${today}T00:00:00`);
    const to = new Date(`${addDays(today, 7)}T00:00:00`);
    const events = expandIcsEvents(data, from, to);
    expect(events.map((e) => e.summary)).toEqual(['Inside window']);
    expect(events[0].allDay).toBe(false);
  });

  it('expands recurring events and honors EXDATE', () => {
    const start = addDays(today, -1);
    const data = parseIcsString(
      fixture(
        [
          'BEGIN:VEVENT',
          'UID:recur@test',
          `DTSTART:${ymd(start)}T070000Z`,
          `DTEND:${ymd(start)}T080000Z`,
          'RRULE:FREQ=DAILY;COUNT=5',
          `EXDATE:${ymd(addDays(start, 2))}T070000Z`,
          'SUMMARY:Morning practice',
          'END:VEVENT',
        ].join('\r\n')
      )
    );
    const from = new Date(`${addDays(today, -2)}T00:00:00`);
    const to = new Date(`${addDays(today, 7)}T00:00:00`);
    const events = expandIcsEvents(data, from, to);
    // 5 daily occurrences minus 1 excluded = 4
    expect(events).toHaveLength(4);
    expect(new Set(events.map((e) => e.summary))).toEqual(new Set(['Morning practice']));
  });

  it('handles all-day events', () => {
    const data = parseIcsString(
      fixture(
        [
          'BEGIN:VEVENT',
          'UID:allday@test',
          `DTSTART;VALUE=DATE:${ymd(today)}`,
          `DTEND;VALUE=DATE:${ymd(addDays(today, 1))}`,
          'SUMMARY:Assessment day',
          'END:VEVENT',
        ].join('\r\n')
      )
    );
    const from = new Date(`${today}T00:00:00`);
    const to = new Date(`${addDays(today, 1)}T00:00:00`);
    const events = expandIcsEvents(data, from, to);
    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
    expect(events[0].start).toBe(today);
  });
});

describe('ICS via API', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const icsFetcher = async () =>
      parseIcsString(
        fixture(
          [
            'BEGIN:VEVENT',
            'UID:meeting@test',
            `DTSTART:${ymd(today)}T140000Z`,
            `DTEND:${ymd(today)}T150000Z`,
            'SUMMARY:Interview loop',
            'END:VEVENT',
          ].join('\r\n')
        )
      );
    ctx = makeApp(undefined, icsFetcher);
  });

  it('saves an ICS url (normalizing webcal://), syncs, and serves events', async () => {
    const set = await request(ctx.app)
      .post('/api/calendar/ics')
      .send({ url: 'webcal://calendar.google.com/calendar/ical/x/basic.ics' });
    expect(set.status).toBe(200);
    expect(set.body.mode).toBe('ics');
    expect(set.body.icsUrl).toMatch(/^https:\/\//);

    const sync = await request(ctx.app).post('/api/calendar/sync').send({});
    expect(sync.status).toBe(200);
    expect(sync.body.eventCount).toBe(1);

    const day = await request(ctx.app).get(`/api/day/${today}`);
    expect(day.body.events.map((e: any) => e.summary)).toEqual(['Interview loop']);
  });

  it('push is refused in ICS mode with a clear message', async () => {
    await request(ctx.app).post('/api/calendar/ics').send({ url: 'https://example.com/cal.ics' });
    const { body: task } = await request(ctx.app)
      .post('/api/tasks')
      .send({ date: today, title: 'Timed task', planned_start: '10:00' });
    const res = await request(ctx.app).post(`/api/tasks/${task.id}/push`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/google/i);
  });

  it('removing the ICS feed clears its cached events', async () => {
    await request(ctx.app).post('/api/calendar/ics').send({ url: 'https://example.com/cal.ics' });
    await request(ctx.app).post('/api/calendar/sync').send({});
    await request(ctx.app).delete('/api/calendar/ics');
    const day = await request(ctx.app).get(`/api/day/${today}`);
    expect(day.body.events).toHaveLength(0);
    const status = await request(ctx.app).get('/api/calendar/status');
    expect(status.body.mode).toBe('none');
  });

  it('rejects invalid urls', async () => {
    expect(
      (await request(ctx.app).post('/api/calendar/ics').send({ url: 'not a url' })).status
    ).toBe(400);
  });
});
