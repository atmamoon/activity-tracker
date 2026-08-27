import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const PORT = Number(process.env.API_PORT ?? 4820);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? path.join(root, 'data', 'tracker.db');

const db = openDb(dbPath);
const { app } = createApp({ db, port: PORT });

app.listen(PORT, () => {
  console.log(`Activity Tracker API listening on http://localhost:${PORT}`);
  console.log(`Database: ${dbPath}`);
});
