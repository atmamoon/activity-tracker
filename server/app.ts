import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';
import { GoogleClient, type FetchLike } from './lib/google.ts';
import { taskRoutes } from './routes/tasks.ts';
import { bookRoutes } from './routes/books.ts';
import { templateRoutes } from './routes/templates.ts';
import { categoryRoutes } from './routes/categories.ts';
import { calendarRoutes } from './routes/calendar.ts';

export interface AppOptions {
  db: DB;
  port: number;
  fetchImpl?: FetchLike;
}

export function createApp({ db, port, fetchImpl }: AppOptions) {
  const app = express();
  const google = new GoogleClient(db, fetchImpl);

  app.use(express.json({ limit: '1mb' }));

  app.use('/api', taskRoutes(db, google));
  app.use('/api', bookRoutes(db));
  app.use('/api', templateRoutes(db));
  app.use('/api', categoryRoutes(db));
  app.use('/api', calendarRoutes(db, google, port));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Serve the built client in production.
  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Central error handler — JSON errors, no stack leaks to the client.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[api error]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return { app, google };
}
