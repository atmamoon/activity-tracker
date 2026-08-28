import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EntryStatus, HistoryPayload, StatsPayload } from '../../shared/types';
import { api, type HistoryQuery } from '../api';
import { useStore } from '../state/store';
import { addDaysStr, formatDuration, formatTime } from '../utils';

const RANGES: Array<{ label: string; days: number }> = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All time', days: 3650 },
];

const STATUSES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' },
  { value: 'missed', label: 'Missed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'planned', label: 'Upcoming' },
];

const STATUS_LABEL: Record<EntryStatus, string> = {
  done: '✓ done',
  skipped: '↷ skipped',
  missed: '✕ missed',
  planned: '· planned',
  removed: '⌫ removed',
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayHeading(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const base = `${DAY_NAMES[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
  if (date === today) return `Today · ${base}`;
  if (date === addDaysStr(today, -1)) return `Yesterday · ${base}`;
  const thisYear = new Date().getFullYear();
  return dt.getFullYear() === thisYear ? base : `${base}, ${y}`;
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${y === new Date().getFullYear() ? '' : `, ${y}`}`;
}

function formatRange(from: string, to: string): string {
  return from === to ? shortDate(to) : `${shortDate(from)} – ${shortDate(to)}`;
}

function endTime(start: string, minutes: number | null): string {
  const [hh, mm] = start.split(':').map(Number);
  const total = hh * 60 + mm + (minutes ?? 0);
  const clamped = Math.min(total, 24 * 60 - 1);
  return formatTime(
    `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
  );
}

export default function History() {
  const categories = useStore((s) => s.categories);
  const today = useStore((s) => s.today);
  const toast = useStore((s) => s.toast);

  const [days, setDays] = useState(30);
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInsights, setShowInsights] = useState(true);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: HistoryQuery = {
      days,
      categoryId: categoryId === 'all' ? undefined : categoryId,
      status,
      q: query || undefined,
    };
    try {
      const [h, s] = await Promise.all([api.history(params), api.stats({ days })]);
      setHistory(h);
      setStats(s);
    } catch (err) {
      toast('error', `Could not load history: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [days, categoryId, status, query, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtering = categoryId !== 'all' || status !== 'all' || query !== '';

  const topActivities = useMemo(
    () => (stats?.activities ?? []).filter((a) => a.plannedDays >= 2).slice(0, 8),
    [stats]
  );

  return (
    <div className="history">
      <div className="history-toolbar">
        <div className="range-pills">
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`range-pill ${days === r.days ? 'active' : ''}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
          <option value="none">Uncategorized</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          className="history-search"
          placeholder="Search activities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {stats && (
        <>
          <div className="range-note">
            Summary for <b>{formatRange(stats.from, stats.to)}</b> — covers everything in the range,
            {filtering ? ' not just the filtered list below.' : ' across all categories.'}
          </div>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-value">{stats.totals.done}</span>
              <span className="stat-label">activities completed</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{formatDuration(stats.totals.doneMinutes)}</span>
              <span className="stat-label">time logged</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{Math.round(stats.totals.completionRate * 100)}%</span>
              <span className="stat-label">
                done vs missed · {stats.totals.missed} missed
                {stats.totals.pending > 0 && `, ${stats.totals.pending} still open`}
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{formatDuration(stats.totals.avgMinutesPerActiveDay)}</span>
              <span className="stat-label">avg per active day · {stats.totals.activeDays} days</span>
            </div>
          </div>

          <div className="insights-panel">
            <button className="insights-toggle" onClick={() => setShowInsights((v) => !v)}>
              <span className={`chevron ${showInsights ? 'open' : ''}`}>▸</span>
              Where the time goes
            </button>
            {showInsights && (
              <div className="insights-body">
                <div className="insight-col">
                  <div className="insight-title">Share of logged time</div>
                  {stats.categories.filter((c) => c.doneMinutes > 0).length === 0 ? (
                    <p className="empty-hint">Nothing completed in this range yet.</p>
                  ) : (
                    stats.categories
                      .filter((c) => c.doneMinutes > 0)
                      .map((c) => (
                        <div key={c.id ?? 'none'} className="share-row">
                          <span className="share-name">
                            {c.emoji} {c.name}
                          </span>
                          <div className="share-track">
                            <div
                              className="share-fill"
                              style={{
                                width: `${Math.round(c.share * 100)}%`,
                                background: c.color ?? 'var(--accent)',
                              }}
                            />
                          </div>
                          <span className="share-value">
                            {Math.round(c.share * 100)}% · {formatDuration(c.doneMinutes)}
                          </span>
                        </div>
                      ))
                  )}
                </div>

                <div className="insight-col">
                  <div className="insight-title">Consistency by activity</div>
                  {topActivities.length === 0 ? (
                    <p className="empty-hint">
                      Repeat an activity across a few days to see consistency here.
                    </p>
                  ) : (
                    <table className="consistency-table">
                      <thead>
                        <tr>
                          <th>Activity</th>
                          <th>Done</th>
                          <th>Rate</th>
                          <th>Streak</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topActivities.map((a) => (
                          <tr key={a.title}>
                            <td className="consistency-name" title={a.title}>
                              {a.title}
                            </td>
                            <td className="mono">
                              {a.doneDays}/{a.plannedDays}
                            </td>
                            <td>
                              <span
                                className={`rate-badge ${
                                  a.completionRate >= 0.8
                                    ? 'good'
                                    : a.completionRate >= 0.5
                                      ? 'mid'
                                      : 'low'
                                }`}
                              >
                                {Math.round(a.completionRate * 100)}%
                              </span>
                            </td>
                            <td className="mono">{a.currentStreak > 0 ? `🔥 ${a.currentStreak}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {loading && !history ? (
        <div className="empty-state">Loading history…</div>
      ) : !history || history.days.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">🗒️</div>
          <p>No activity {filtering ? 'matches these filters' : 'logged in this range yet'}.</p>
          {filtering && (
            <p className="empty-hint">Try widening the date range or clearing the filters.</p>
          )}
        </div>
      ) : (
        <div className="history-days">
          {history.days.map((day) => (
            <div key={day.date} className="history-day">
              <div className="history-day-head">
                <span className="history-date">{formatDayHeading(day.date, today)}</span>
                <span className="history-day-summary">
                  {day.summary.done} done
                  {day.summary.doneMinutes > 0 && ` · ${formatDuration(day.summary.doneMinutes)}`}
                  {day.summary.missed > 0 && ` · ${day.summary.missed} missed`}
                  {day.summary.skipped > 0 && ` · ${day.summary.skipped} skipped`}
                </span>
              </div>
              <div className="history-entries">
                {day.entries.map((e) => (
                  <div key={e.id} className={`history-entry status-${e.status}`}>
                    <span className="entry-slot mono">
                      {e.planned_start
                        ? `${formatTime(e.planned_start)} – ${endTime(e.planned_start, e.planned_minutes)}`
                        : 'no slot'}
                    </span>
                    <span className="entry-title" title={e.title}>
                      {e.title}
                    </span>
                    <span className="entry-meta">
                      {e.category_name && (
                        <span
                          className="chip cat-chip"
                          style={{ ['--cat-color' as any]: e.category_color ?? 'var(--accent)' }}
                        >
                          {e.category_emoji} {e.category_name}
                        </span>
                      )}
                      {e.book_title && <span className="chip book-chip">📕 {e.book_title}</span>}
                      {e.carried_from && e.carried_from !== e.date && (
                        <span className="chip carried-chip">↪ from {e.carried_from.slice(5)}</span>
                      )}
                      {e.removed && <span className="chip">deleted task</span>}
                    </span>
                    <span className="entry-duration mono">
                      {e.planned_minutes ? formatDuration(e.planned_minutes) : '—'}
                    </span>
                    <span
                      className={`entry-status ${e.status}`}
                      title={e.completed_at ? `Completed ${new Date(e.completed_at).toLocaleString()}` : undefined}
                    >
                      {STATUS_LABEL[e.status]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
