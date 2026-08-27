import type { CalendarEvent, Task } from '../shared/types';

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localDateStr(dt);
}

export function dateAtTime(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateHeading(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const label = `${DAY_NAMES[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
  if (date === today) return `Today · ${label}`;
  if (date === addDaysStr(today, 1)) return `Tomorrow · ${label}`;
  if (date === addDaysStr(today, -1)) return `Yesterday · ${label}`;
  return `${label}${dt.getFullYear() !== new Date().getFullYear() ? `, ${y}` : ''}`;
}

/** "21:30" → "9:30 pm" */
export function formatTime(hhmm: string): string {
  const [hh, mm] = hhmm.split(':').map(Number);
  const suffix = hh >= 12 ? 'pm' : 'am';
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 ? `${h} ${suffix}` : `${h}:${String(mm).padStart(2, '0')} ${suffix}`;
}

export function formatTimeOfDate(iso: string): string {
  const d = new Date(iso);
  return formatTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function hhmmToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number);
  return hh * 60 + mm;
}

export function minutesToHhmm(mins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function relativeTimeFrom(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface TimedBlock {
  startMin: number; // minutes from local midnight of the viewed day
  endMin: number;
}

/** Timed block for a task with a planned time, in the viewed day's minutes. */
export function taskBlock(task: Task): TimedBlock | null {
  if (!task.planned_start) return null;
  const startMin = hhmmToMinutes(task.planned_start);
  return { startMin, endMin: startMin + (task.planned_minutes ?? 60) };
}

/** Timed block for a calendar event relative to the viewed date; null for all-day. */
export function eventBlock(ev: CalendarEvent, date: string): TimedBlock | null {
  if (ev.all_day) return null;
  const dayStart = dateAtTime(date, '00:00').getTime();
  const s = new Date(ev.start).getTime();
  const e = new Date(ev.end).getTime();
  const startMin = Math.max(0, (s - dayStart) / 60000);
  const endMin = Math.min(24 * 60, (e - dayStart) / 60000);
  if (endMin <= 0 || startMin >= 24 * 60) return null;
  return { startMin, endMin };
}

export function blocksOverlap(a: TimedBlock, b: TimedBlock): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** Events (excluding those that are the task's own pushed event) conflicting with a task. */
export function conflictsForTask(task: Task, events: CalendarEvent[], date: string): CalendarEvent[] {
  const block = taskBlock(task);
  if (!block) return [];
  return events.filter((ev) => {
    if (task.calendar_event_id && ev.id === `${task.calendar_id}:${task.calendar_event_id}`) {
      return false;
    }
    const eb = eventBlock(ev, date);
    return eb !== null && blocksOverlap(block, eb);
  });
}

/** Book progress in [0, 1], or null if the total is unknown. */
export function bookProgress(current: number, total: number | null): number | null {
  if (total == null || total <= 0) return null;
  return Math.max(0, Math.min(1, current / total));
}
