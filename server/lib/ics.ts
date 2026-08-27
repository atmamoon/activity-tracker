import ical from 'node-ical';

export interface NormalizedEvent {
  id: string;
  summary: string;
  start: string; // ISO datetime, or YYYY-MM-DD when all-day
  end: string;
  allDay: boolean;
}

/**
 * Expand parsed ICS data into concrete event instances within [from, to).
 * Handles plain events, recurring events (RRULE) with EXDATEs and
 * per-instance overrides, and applies the standard node-ical DST offset
 * correction for recurrence expansion.
 */
export function expandIcsEvents(data: ical.CalendarResponse, from: Date, to: Date): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];

  for (const key of Object.keys(data)) {
    const item = data[key] as any;
    if (!item || item.type !== 'VEVENT') continue;
    const summary: string = typeof item.summary === 'string' ? item.summary : (item.summary?.val ?? '');
    const isAllDay = item.datetype === 'date';

    if (item.rrule) {
      const durationMs =
        item.end && item.start ? item.end.getTime() - item.start.getTime() : 0;
      // Widen the window so instances starting before `from` but ending inside it are kept.
      const windowStart = new Date(from.getTime() - Math.max(durationMs, 0) - 24 * 3600 * 1000);
      let dates: Date[] = [];
      try {
        dates = item.rrule.between(windowStart, to, true);
      } catch {
        dates = [];
      }
      const exdates = new Set<string>(
        Object.values(item.exdate ?? {}).map((d: any) => new Date(d).toISOString())
      );
      for (const occurrence of dates) {
        let start = new Date(occurrence);
        // node-ical README DST correction: rrule returns dates assuming the
        // dtstart offset; shift by the difference in tz offsets.
        const offsetDiff = start.getTimezoneOffset() - item.start.getTimezoneOffset();
        if (offsetDiff !== 0) start = new Date(start.getTime() + offsetDiff * 60 * 1000);

        const occKeyIso = new Date(occurrence).toISOString();
        if (exdates.has(occKeyIso)) continue;

        // Per-instance override (RECURRENCE-ID)
        let instStart = start;
        let instEnd = new Date(start.getTime() + durationMs);
        let instSummary = summary;
        const overrideKey = occKeyIso.slice(0, 10);
        const override = item.recurrences?.[overrideKey];
        if (override) {
          instStart = new Date(override.start);
          instEnd = new Date(override.end ?? instStart.getTime() + durationMs);
          if (override.summary) {
            instSummary =
              typeof override.summary === 'string' ? override.summary : override.summary.val;
          }
        }
        if (instEnd <= from || instStart >= to) continue;
        out.push(
          normalize(`${item.uid ?? key}:${occKeyIso}`, instSummary, instStart, instEnd, isAllDay)
        );
      }
      // Overrides may move an instance into the window even when the base
      // occurrence is outside it; recurrences were handled above via keys,
      // so also scan any not matched to an occurrence.
      for (const [rkey, override] of Object.entries<any>(item.recurrences ?? {})) {
        const oStart = new Date(override.start);
        const oEnd = new Date(override.end ?? oStart);
        const already = out.some((e) => e.id === `${item.uid ?? key}:${new Date(rkey).toISOString()}`);
        if (already) continue;
        if (oEnd <= from || oStart >= to) continue;
        const oSummary =
          typeof override.summary === 'string' ? override.summary : (override.summary?.val ?? summary);
        out.push(normalize(`${item.uid ?? key}:ovr:${rkey}`, oSummary, oStart, oEnd, isAllDay));
      }
    } else {
      if (!item.start) continue;
      const start = new Date(item.start);
      const end = new Date(item.end ?? item.start);
      if (end <= from || start >= to) continue;
      out.push(normalize(item.uid ?? key, summary, start, end, isAllDay));
    }
  }
  return out;
}

function normalize(id: string, summary: string, start: Date, end: Date, allDay: boolean): NormalizedEvent {
  if (allDay) {
    return {
      id,
      summary,
      start: localDate(start),
      end: localDate(end),
      allDay: true,
    };
  }
  return { id, summary, start: start.toISOString(), end: end.toISOString(), allDay: false };
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export async function fetchIcs(url: string): Promise<ical.CalendarResponse> {
  return ical.async.fromURL(url);
}

export function parseIcsString(text: string): ical.CalendarResponse {
  return ical.sync.parseICS(text);
}
