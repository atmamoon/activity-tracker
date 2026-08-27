import type { Express } from 'express';
import { openDb, type DB } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import type { GoogleClient, FetchLike } from '../server/lib/google.ts';

export interface TestContext {
  db: DB;
  app: Express;
  google: GoogleClient;
}

export function makeApp(
  fetchImpl?: FetchLike,
  icsFetcher?: (url: string) => Promise<any>
): TestContext {
  const db = openDb(':memory:');
  const { app, google } = createApp({ db, port: 4820, fetchImpl, icsFetcher });
  return { db, app, google };
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}
