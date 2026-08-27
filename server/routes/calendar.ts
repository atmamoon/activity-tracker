import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db.ts';
import { getSetting, setSetting } from '../db.ts';
import { GoogleClient } from '../lib/google.ts';
import { syncCalendar, getCalendarMode, getSelectedCalendarIds } from '../lib/sync.ts';
import { pushTaskToCalendar, removeTaskEvent, getPushCalendarId } from '../lib/taskEvents.ts';
import { isValidDateStr, addDaysStr } from '../lib/time.ts';
import { localToday } from '../lib/materialize.ts';

// Default sync window: 7 days back, 45 days forward.
const SYNC_BACK_DAYS = 7;
const SYNC_FORWARD_DAYS = 45;

export function calendarRoutes(db: DB, google: GoogleClient, serverPort: number): Router {
  const router = Router();
  // Short-lived OAuth state tokens (CSRF protection for the loopback flow).
  const pendingStates = new Map<string, number>();
  const redirectUri = () => `http://localhost:${serverPort}/api/calendar/google/callback`;

  const status = () => ({
    mode: getCalendarMode(db),
    googleConnected: google.isConnected(),
    hasClientCreds: google.hasCredentials(),
    icsUrl: getSetting(db, 'ics_url'),
    selectedCalendarIds: getSelectedCalendarIds(db),
    pushCalendarId: getPushCalendarId(db),
    lastSync: getSetting(db, 'last_sync'),
    syncError: getSetting(db, 'sync_error'),
  });

  router.get('/calendar/status', (_req, res) => res.json(status()));

  router.post('/calendar/google/credentials', (req, res) => {
    const schema = z.object({
      clientId: z.string().trim().min(10),
      clientSecret: z.string().trim().min(5),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'clientId and clientSecret are required' });
    }
    setSetting(db, 'google_client_id', parsed.data.clientId);
    setSetting(db, 'google_client_secret', parsed.data.clientSecret);
    res.json(status());
  });

  router.get('/calendar/google/auth', (req, res) => {
    if (!google.hasCredentials()) {
      return res.status(400).json({ error: 'Add your Google OAuth client ID and secret first' });
    }
    const state = randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + 10 * 60 * 1000);
    res.json({ url: google.authUrl(redirectUri(), state) });
  });

  router.get('/calendar/google/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const page = (title: string, body: string, ok: boolean) =>
      `<!doctype html><meta charset="utf-8"><title>${title}</title>
       <body style="font-family:system-ui;display:grid;place-items:center;height:90vh;background:#0f1115;color:#e5e7eb">
       <div style="text-align:center"><div style="font-size:48px">${ok ? '✅' : '⚠️'}</div>
       <h2>${title}</h2><p style="color:#9ca3af">${body}</p></div></body>`;
    const expiry = state ? pendingStates.get(state) : undefined;
    if (state) pendingStates.delete(state);
    if (error) {
      return res.status(400).send(page('Connection cancelled', String(error), false));
    }
    if (!code || !expiry || Date.now() > expiry) {
      return res
        .status(400)
        .send(page('Invalid or expired request', 'Start the connection again from the app.', false));
    }
    try {
      await google.exchangeCode(code, redirectUri());
      setSetting(db, 'calendar_mode', 'google');
      // Default to the primary calendar so sync works immediately.
      if (getSelectedCalendarIds(db).length === 0) {
        try {
          const cals = await google.listCalendars();
          const primary = cals.find((c) => c.primary);
          if (primary) {
            setSetting(db, 'google_calendar_ids', JSON.stringify([primary.id]));
            setSetting(db, 'push_calendar_id', primary.id);
          }
        } catch {
          // Non-fatal: user can pick calendars in settings.
        }
      }
      res.send(
        page('Google Calendar connected', 'You can close this tab and return to the tracker.', true)
      );
    } catch (err) {
      res.status(500).send(page('Connection failed', (err as Error).message, false));
    }
  });

  router.post('/calendar/google/disconnect', (_req, res) => {
    google.disconnect();
    setSetting(db, 'calendar_mode', getSetting(db, 'ics_url') ? 'ics' : 'none');
    db.prepare("DELETE FROM calendar_events WHERE source = 'google'").run();
    res.json(status());
  });

  router.get('/calendar/google/calendars', async (_req, res) => {
    const calendars = await google.listCalendars();
    res.json({ calendars });
  });

  router.post('/calendar/google/select', (req, res) => {
    const schema = z.object({
      calendarIds: z.array(z.string()).min(1).max(50),
      pushCalendarId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'calendarIds must be a non-empty array' });
    setSetting(db, 'google_calendar_ids', JSON.stringify(parsed.data.calendarIds));
    if (parsed.data.pushCalendarId) {
      setSetting(db, 'push_calendar_id', parsed.data.pushCalendarId);
    }
    res.json(status());
  });

  router.post('/calendar/ics', (req, res) => {
    const schema = z.object({ url: z.string().url().max(2000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'A valid ICS URL is required' });
    let url = parsed.data.url;
    // Google shares "webcal://" style links in some UIs.
    url = url.replace(/^webcal:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'URL must be http(s) or webcal' });
    }
    setSetting(db, 'ics_url', url);
    if (getCalendarMode(db) === 'none') setSetting(db, 'calendar_mode', 'ics');
    res.json(status());
  });

  router.delete('/calendar/ics', (_req, res) => {
    setSetting(db, 'ics_url', null);
    db.prepare("DELETE FROM calendar_events WHERE source = 'ics'").run();
    if (getCalendarMode(db) === 'ics') {
      setSetting(db, 'calendar_mode', google.isConnected() ? 'google' : 'none');
    }
    res.json(status());
  });

  router.post('/calendar/mode', (req, res) => {
    const schema = z.object({ mode: z.enum(['google', 'ics', 'none']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid mode' });
    setSetting(db, 'calendar_mode', parsed.data.mode);
    res.json(status());
  });

  router.post('/calendar/sync', async (req, res) => {
    const body = (req.body ?? {}) as { from?: string; to?: string };
    const today = localToday();
    const from = isValidDateStr(body.from) ? body.from : addDaysStr(today, -SYNC_BACK_DAYS);
    const to = isValidDateStr(body.to) ? body.to : addDaysStr(today, SYNC_FORWARD_DAYS);
    try {
      const result = await syncCalendar(db, google, from, to);
      res.json({ ...result, status: status() });
    } catch (err) {
      const message = (err as Error).message;
      setSetting(db, 'sync_error', message);
      res.status(502).json({ error: `Sync failed: ${message}` });
    }
  });

  router.post('/tasks/:id/push', async (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
    if (!task) return res.status(404).json({ error: 'task not found' });
    try {
      const updated = await pushTaskToCalendar(db, google, task);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/tasks/:id/unpush', async (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as any;
    if (!task) return res.status(404).json({ error: 'task not found' });
    try {
      await removeTaskEvent(db, google, task);
      res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
