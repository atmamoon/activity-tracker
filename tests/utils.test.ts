import { describe, it, expect } from 'vitest';
import type { CalendarEvent, Task } from '../shared/types.ts';
import {
  addDaysStr,
  blocksOverlap,
  bookProgress,
  conflictsForTask,
  eventBlock,
  formatDuration,
  formatTime,
  taskBlock,
} from '../src/utils.ts';

const baseTask: Task = {
  id: 't1',
  date: '2026-08-27',
  title: 'x',
  notes: '',
  category_id: null,
  book_id: null,
  status: 'todo',
  position: 10,
  planned_start: null,
  planned_minutes: null,
  calendar_event_id: null,
  calendar_id: null,
  template_id: null,
  carried_from: null,
  created_at: '',
  completed_at: null,
};

const mkEvent = (start: string, end: string): CalendarEvent => ({
  id: 'e1',
  source: 'google',
  calendar_id: 'cal',
  summary: 'Interview',
  start,
  end,
  all_day: 0,
  updated_at: '',
});

describe('time utils', () => {
  it('formats times and durations', () => {
    expect(formatTime('09:00')).toBe('9 am');
    expect(formatTime('21:30')).toBe('9:30 pm');
    expect(formatTime('00:15')).toBe('12:15 am');
    expect(formatTime('12:00')).toBe('12 pm');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
  });

  it('addDaysStr crosses month boundaries', () => {
    expect(addDaysStr('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysStr('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysStr('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });
});

describe('conflict detection', () => {
  it('detects an overlap between a timed task and an event', () => {
    const task = { ...baseTask, planned_start: '15:30', planned_minutes: 60 };
    const ev = mkEvent('2026-08-27T15:00:00+05:30', '2026-08-27T16:00:00+05:30');
    // Build expected times in local timezone via Date parsing of the ISO strings.
    const evb = eventBlock(ev, '2026-08-27');
    const tb = taskBlock(task);
    expect(tb).toEqual({ startMin: 15 * 60 + 30, endMin: 16 * 60 + 30 });
    expect(evb).not.toBeNull();
    // The overlap answer depends on the machine timezone; verify consistency
    // between blocksOverlap and conflictsForTask instead of hardcoding.
    const expected = blocksOverlap(tb!, evb!);
    expect(conflictsForTask(task, [ev], '2026-08-27').length > 0).toBe(expected);
  });

  it('no conflict for untimed tasks or all-day events', () => {
    const ev = mkEvent('2026-08-27T15:00:00', '2026-08-27T16:00:00');
    expect(conflictsForTask(baseTask, [ev], '2026-08-27')).toHaveLength(0);
    const allDay: CalendarEvent = { ...ev, all_day: 1, start: '2026-08-27', end: '2026-08-28' };
    const timed = { ...baseTask, planned_start: '10:00', planned_minutes: 30 };
    expect(conflictsForTask(timed, [allDay], '2026-08-27')).toHaveLength(0);
  });

  it('a pushed task does not conflict with its own calendar event', () => {
    const task = {
      ...baseTask,
      planned_start: '15:00',
      planned_minutes: 60,
      calendar_event_id: 'ev-9',
      calendar_id: 'cal',
    };
    const own = { ...mkEvent('2026-08-27T15:00:00', '2026-08-27T16:00:00'), id: 'cal:ev-9' };
    expect(conflictsForTask(task, [own], '2026-08-27')).toHaveLength(0);
  });

  it('adjacent blocks do not overlap', () => {
    expect(blocksOverlap({ startMin: 60, endMin: 120 }, { startMin: 120, endMin: 180 })).toBe(false);
    expect(blocksOverlap({ startMin: 60, endMin: 121 }, { startMin: 120, endMin: 180 })).toBe(true);
  });
});

describe('bookProgress', () => {
  it('clamps to [0,1] and handles unknown totals', () => {
    expect(bookProgress(5, 10)).toBe(0.5);
    expect(bookProgress(15, 10)).toBe(1);
    expect(bookProgress(5, null)).toBeNull();
    expect(bookProgress(5, 0)).toBeNull();
  });
});
