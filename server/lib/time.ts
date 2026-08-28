/** Time helpers. All user-facing times are local; the DB stores ISO strings. */

/** Parse YYYY-MM-DD into a local-midnight Date. */
export function dateAtLocalMidnight(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Local Date for a YYYY-MM-DD date + HH:MM time. */
export function dateAtTime(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

/** RFC3339 with local offset, e.g. 2026-08-27T21:30:00+05:30 */
export function toRfc3339Local(d: Date): string {
  const pad = (n: number, len = 2) => String(Math.trunc(Math.abs(n))).padStart(len, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offAbs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(offAbs / 60))}:${pad(offAbs % 60)}`
  );
}

/** YYYY-MM-DD of a Date, in local time. */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Add days to a YYYY-MM-DD string. */
export function addDaysStr(date: string, days: number): string {
  const d = dateAtLocalMidnight(date);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = dateAtLocalMidnight(s);
  return !Number.isNaN(d.getTime()) && localDateStr(d) === s;
}

export function isValidTimeStr(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{2}:\d{2}$/.test(s)) return false;
  const [hh, mm] = s.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/** Local date as YYYY-MM-DD. */
export function localToday(): string {
  return localDateStr(new Date());
}

export function hhmmToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number);
  return hh * 60 + mm;
}

export function minutesToHhmm(mins: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
