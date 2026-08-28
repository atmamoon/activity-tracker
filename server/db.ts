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
  auto_time INTEGER NOT NULL DEFAULT 1,
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

-- Append-only audit trail of what actually happened, with snapshots of the
-- task's details at that moment so history survives renames, category
-- changes, and task deletion.
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT,
  category_name TEXT,
  book_id TEXT,
  event TEXT NOT NULL CHECK (event IN ('done','skipped','reopened','deleted')),
  planned_start TEXT,
  planned_minutes INTEGER,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_date ON activity_log(date);
CREATE INDEX IF NOT EXISTS idx_log_task ON activity_log(task_id);
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
  migrate(db);
  seedDefaults(db);
  return db;
}

/** One-time upgrades for databases created before a schema addition. */
function migrate(db: DB) {
  const cols = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'auto_time')) {
    db.exec('ALTER TABLE tasks ADD COLUMN auto_time INTEGER NOT NULL DEFAULT 1');
    // Tasks that already had an explicit time before auto-scheduling existed
    // are treated as pinned, so they are never silently moved by a reflow.
    db.exec('UPDATE tasks SET auto_time = 0 WHERE planned_start IS NOT NULL');
  }

  // Seed the log from tasks completed before the log existed, so history is
  // complete from day one. Only runs while the log is still empty.
  const logged = (db.prepare('SELECT COUNT(*) AS c FROM activity_log').get() as { c: number }).c;
  if (logged === 0) {
    db.exec(`
      INSERT INTO activity_log (id, task_id, date, title, category_id, category_name,
        book_id, event, planned_start, planned_minutes, at)
      SELECT lower(hex(randomblob(16))), t.id, t.date, t.title, t.category_id, c.name,
        t.book_id, 'done', t.planned_start, t.planned_minutes, t.completed_at
      FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.status = 'done' AND t.completed_at IS NOT NULL
    `);
  }
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
