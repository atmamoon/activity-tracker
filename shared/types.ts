// Shared domain types between server and client.

export type TaskStatus = 'todo' | 'done' | 'skipped';

export interface Task {
  id: string;
  date: string; // YYYY-MM-DD (local)
  title: string;
  notes: string;
  category_id: string | null;
  book_id: string | null;
  status: TaskStatus;
  position: number;
  planned_start: string | null; // HH:MM (local, 24h)
  planned_minutes: number | null;
  auto_time: 0 | 1; // 1 = system may reschedule it; 0 = user-pinned time
  calendar_event_id: string | null;
  calendar_id: string | null;
  template_id: string | null;
  carried_from: string | null; // original date if carried over
  created_at: string;
  completed_at: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string; // hex
  emoji: string;
  position: number;
  archived: 0 | 1;
}

export type BookStatus = 'reading' | 'queued' | 'finished';
export type BookUnit = 'page' | 'chapter' | 'percent';

export interface Book {
  id: string;
  title: string;
  author: string;
  unit: BookUnit;
  total: number | null;
  current: number;
  status: BookStatus;
  queue_position: number;
  notes: string;
  created_at: string;
  finished_at: string | null;
}

export interface Template {
  id: string;
  title: string;
  category_id: string | null;
  days: number[]; // 0=Sun ... 6=Sat
  planned_start: string | null; // HH:MM
  planned_minutes: number | null;
  position: number;
  active: 0 | 1;
}

export interface CalendarEvent {
  id: string;
  source: 'google' | 'ics';
  calendar_id: string;
  summary: string;
  start: string; // ISO datetime or YYYY-MM-DD for all-day
  end: string;
  all_day: 0 | 1;
  updated_at: string;
}

export interface CalendarStatus {
  mode: 'google' | 'ics' | 'none';
  googleConnected: boolean;
  hasClientCreds: boolean;
  icsUrl: string | null;
  selectedCalendarIds: string[];
  pushCalendarId: string | null;
  lastSync: string | null;
  syncError: string | null;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

export interface DayPayload {
  date: string;
  tasks: Task[];
  events: CalendarEvent[];
}

export type EntryStatus = 'done' | 'skipped' | 'missed' | 'planned' | 'removed';

export interface HistoryEntry {
  id: string;
  task_id: string | null;
  date: string;
  title: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  category_emoji: string | null;
  book_title: string | null;
  planned_start: string | null;
  planned_minutes: number | null;
  status: EntryStatus;
  completed_at: string | null;
  carried_from: string | null;
  removed: boolean;
}

export interface HistoryDay {
  date: string;
  entries: HistoryEntry[];
  summary: {
    done: number;
    skipped: number;
    missed: number;
    planned: number;
    doneMinutes: number;
  };
}

export interface HistoryPayload {
  from: string;
  to: string;
  days: HistoryDay[];
  total: number;
}

export interface CategoryStat {
  id: string | null;
  name: string;
  color: string | null;
  emoji: string | null;
  planned: number;
  done: number;
  skipped: number;
  missed: number;
  doneMinutes: number;
  share: number;
}

export interface ActivityStat {
  title: string;
  category_name: string | null;
  category_color: string | null;
  plannedDays: number;
  doneDays: number;
  missedDays: number;
  skippedDays: number;
  completionRate: number;
  currentStreak: number;
  lastDone: string | null;
  doneMinutes: number;
}

export interface StatsPayload {
  from: string;
  to: string;
  totals: {
    activeDays: number;
    planned: number;
    done: number;
    skipped: number;
    missed: number;
    pending: number;
    doneMinutes: number;
    completionRate: number;
    avgMinutesPerActiveDay: number;
  };
  categories: CategoryStat[];
  activities: ActivityStat[];
}
