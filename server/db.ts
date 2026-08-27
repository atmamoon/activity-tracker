import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  category_id TEXT,
  book_id TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done','skipped')),
  position REAL NOT NULL,
  planned_start TEXT,
  planned_minutes INTEGER,
  calendar_event_id TEXT,
  calendar_id TEXT,
  template_id TEXT,
  carried_from TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'page' CHECK (unit IN ('page','chapter','percent')),
  total REAL,
  current REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('reading','queued','finished')),
  queue_position REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_id TEXT,
  days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  planned_start TEXT,
  planned_minutes INTEGER,
  position REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS day_seeds (
  date TEXT NOT NULL,
  template_id TEXT NOT NULL,
  PRIMARY KEY (date, template_id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('google','ics')),
  calendar_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_start ON calendar_events(start);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const DEFAULT_CATEGORIES: Array<{ name: string; color: string; emoji: string }> = [
  { name: 'RCA Practice', color: '#e05d44', emoji: '🔍' },
  { name: 'Data Questions', color: '#3b82f6', emoji: '📊' },
  { name: 'Mental Math / Quant', color: '#8b5cf6', emoji: '🧮' },
  { name: 'Reading', color: '#10b981', emoji: '📖' },
  { name: 'Job Applications', color: '#f59e0b', emoji: '📨' },
  { name: 'Interview', color: '#ec4899', emoji: '🎤' },
  { name: 'Assessment', color: '#06b6d4', emoji: '📝' },
  { name: 'Other', color: '#64748b', emoji: '⚡' },
];

export function openDb(dbPath: string): DB {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  seedDefaults(db);
  return db;
}

function seedDefaults(db: DB) {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
  if (count === 0) {
    const insert = db.prepare(
      'INSERT INTO categories (id, name, color, emoji, position, archived) VALUES (?, ?, ?, ?, ?, 0)'
    );
    const tx = db.transaction(() => {
      DEFAULT_CATEGORIES.forEach((c, i) => {
        insert.run(randomUUID(), c.name, c.color, c.emoji, (i + 1) * 10);
      });
    });
    tx();
  }
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(db: DB, key: string, value: string | null) {
  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
