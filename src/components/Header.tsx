import { useStore } from '../state/store';
import { formatDateHeading, relativeTimeFrom } from '../utils';

export default function Header() {
  const date = useStore((s) => s.date);
  const today = useStore((s) => s.today);
  const shiftDay = useStore((s) => s.shiftDay);
  const goToday = useStore((s) => s.goToday);
  const syncing = useStore((s) => s.syncing);
  const syncNow = useStore((s) => s.syncNow);
  const calendar = useStore((s) => s.calendar);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const connected = calendar && calendar.mode !== 'none' && (calendar.googleConnected || Boolean(calendar.icsUrl));

  return (
    <header className="header">
      <div className="header-brand">
        <span className="brand-mark">🎯</span>
        <span className="brand-name">Activity Tracker</span>
      </div>

      <div className="header-date">
        <button className="icon-btn" onClick={() => shiftDay(-1)} title="Previous day (←)" aria-label="Previous day">
          ‹
        </button>
        <button
          className={`date-heading ${date === today ? 'is-today' : ''}`}
          onClick={goToday}
          title="Jump to today (t)"
        >
          {formatDateHeading(date, today)}
        </button>
        <button className="icon-btn" onClick={() => shiftDay(1)} title="Next day (→)" aria-label="Next day">
          ›
        </button>
        {date !== today && (
          <button className="pill-btn subtle" onClick={goToday}>
            Back to today
          </button>
        )}
      </div>

      <div className="header-actions">
        {connected ? (
          <button
            className={`pill-btn ${syncing ? 'is-syncing' : ''}`}
            onClick={() => syncNow(false)}
            disabled={syncing}
            title={calendar?.lastSync ? `Last synced ${relativeTimeFrom(calendar.lastSync)}` : 'Sync calendar'}
          >
            <span className={`sync-icon ${syncing ? 'spin' : ''}`}>⟳</span>
            {syncing ? 'Syncing…' : calendar?.lastSync ? `Synced ${relativeTimeFrom(calendar.lastSync)}` : 'Sync'}
          </button>
        ) : (
          <button className="pill-btn accent" onClick={() => setSettingsOpen(true)}>
            Connect calendar
          </button>
        )}
        {calendar?.syncError && (
          <span className="sync-error-dot" title={`Last sync error: ${calendar.syncError}`}>
            ⚠️
          </span>
        )}
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
          ⚙
        </button>
      </div>
    </header>
  );
}
