import { useEffect, useState } from 'react';
import type { GoogleCalendarInfo, Template } from '../../shared/types';
import { api } from '../api';
import { useStore } from '../state/store';
import Modal from './Modal';

type Tab = 'calendar' | 'blocks' | 'categories';
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function SettingsModal() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<Tab>('calendar');

  return (
    <Modal title="Settings" onClose={() => setSettingsOpen(false)} wide>
      <div className="tabs">
        {(
          [
            ['calendar', '📅 Calendar'],
            ['blocks', '🔁 Daily blocks'],
            ['categories', '🏷 Categories'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'categories' && <CategoriesTab />}
    </Modal>
  );
}

/* ---------- Calendar ---------- */

function CalendarTab() {
  const calendar = useStore((s) => s.calendar);
  const loadCalendarStatus = useStore((s) => s.loadCalendarStatus);
  const syncNow = useStore((s) => s.syncNow);
  const toast = useStore((s) => s.toast);

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [icsUrl, setIcsUrl] = useState(calendar?.icsUrl ?? '');
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[] | null>(null);
  const [selected, setSelected] = useState<string[]>(calendar?.selectedCalendarIds ?? []);
  const [pushCal, setPushCal] = useState(calendar?.pushCalendarId ?? 'primary');
  const [busy, setBusy] = useState(false);
  const [waitingAuth, setWaitingAuth] = useState(false);

  const connected = calendar?.googleConnected;

  useEffect(() => {
    if (connected) {
      api
        .googleCalendars()
        .then((r) => setCalendars(r.calendars))
        .catch(() => setCalendars(null));
      // Re-seed local selection from the server status — connecting happens
      // while this tab is mounted, and the callback auto-selects the primary
      // calendar; stale local state would otherwise clobber it on first click.
      const cal = useStore.getState().calendar;
      setSelected(cal?.selectedCalendarIds ?? []);
      setPushCal(cal?.pushCalendarId ?? 'primary');
    }
  }, [connected]);

  // While the auth tab is open, poll status until connected.
  useEffect(() => {
    if (!waitingAuth) return;
    const t = window.setInterval(async () => {
      await loadCalendarStatus();
      const cal = useStore.getState().calendar;
      if (cal?.googleConnected) {
        setWaitingAuth(false);
        toast('success', 'Google Calendar connected');
        syncNow(true);
      }
    }, 1500);
    const stop = window.setTimeout(() => setWaitingAuth(false), 3 * 60 * 1000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, [waitingAuth, loadCalendarStatus, syncNow, toast]);

  const saveCreds = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true);
    try {
      await api.setGoogleCredentials(clientId.trim(), clientSecret.trim());
      await loadCalendarStatus();
      toast('success', 'Credentials saved — now connect your account');
      setClientId('');
      setClientSecret('');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    try {
      const { url } = await api.googleAuthUrl();
      window.open(url, '_blank', 'noopener');
      setWaitingAuth(true);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const saveSelection = async (ids: string[], push: string) => {
    if (ids.length === 0) {
      toast('error', 'Select at least one calendar');
      return;
    }
    try {
      await api.selectCalendars(ids, push);
      await loadCalendarStatus();
      syncNow(true);
      toast('success', 'Calendar selection saved');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const saveIcs = async () => {
    if (!icsUrl.trim()) return;
    setBusy(true);
    try {
      await api.setIcsUrl(icsUrl.trim());
      await loadCalendarStatus();
      await syncNow(false);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <h3>Google Calendar (two-way: pull events + push tasks)</h3>
      {!calendar?.hasClientCreds && (
        <div className="setup-note">
          <p>One-time setup (your data stays on your machine):</p>
          <ol>
            <li>
              Open{' '}
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                Google Cloud Console → Credentials
              </a>{' '}
              and create an <b>OAuth client ID</b> of type <b>Web application</b>.
            </li>
            <li>
              Add <code>http://localhost:4820/api/calendar/google/callback</code> as an authorized
              redirect URI.
            </li>
            <li>
              Enable the <b>Google Calendar API</b> for the project, then paste the client ID and
              secret below.
            </li>
          </ol>
        </div>
      )}
      {!connected ? (
        <>
          <div className="field-row">
            <label className="field grow">
              <span>OAuth client ID</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={calendar?.hasClientCreds ? '(saved)' : 'xxxx.apps.googleusercontent.com'}
              />
            </label>
            <label className="field grow">
              <span>Client secret</span>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={calendar?.hasClientCreds ? '(saved)' : 'GOCSPX-…'}
              />
            </label>
          </div>
          <div className="modal-actions left">
            {(clientId || clientSecret) && (
              <button className="pill-btn" onClick={saveCreds} disabled={busy}>
                Save credentials
              </button>
            )}
            {calendar?.hasClientCreds && (
              <button className="pill-btn accent" onClick={connect} disabled={waitingAuth}>
                {waitingAuth ? 'Waiting for Google…' : 'Connect Google account'}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="ok-note">✅ Connected. Tasks with a start time can be pushed as events.</p>
          {calendars && (
            <div className="field">
              <span>Calendars to show (busy blocks)</span>
              <div className="cal-list">
                {calendars.map((c) => (
                  <label key={c.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...selected, c.id]
                          : selected.filter((x) => x !== c.id);
                        setSelected(ids);
                        saveSelection(ids, pushCal);
                      }}
                    />
                    <span
                      className="cal-dot"
                      style={{ background: c.backgroundColor ?? 'var(--accent)' }}
                    />
                    <span>
                      {c.summary}
                      {c.primary ? ' (primary)' : ''}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {calendars && (
            <label className="field">
              <span>Push new events to</span>
              <select
                value={pushCal}
                onChange={(e) => {
                  setPushCal(e.target.value);
                  saveSelection(selected, e.target.value);
                }}
              >
                {calendars
                  .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <div className="modal-actions left">
            <button
              className="pill-btn subtle danger-text"
              onClick={async () => {
                await api.googleDisconnect();
                await loadCalendarStatus();
                setCalendars(null);
                toast('info', 'Google Calendar disconnected');
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      )}

      <hr className="sep" />

      <h3>Or: read-only ICS feed (no Google Cloud setup)</h3>
      <p className="hint">
        In Google Calendar → Settings → your calendar → <i>Integrate calendar</i>, copy the{' '}
        <b>Secret address in iCal format</b>. Events pull in, but tasks can't be pushed in this
        mode.
      </p>
      <div className="field-row">
        <label className="field grow">
          <span>ICS URL</span>
          <input
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          />
        </label>
      </div>
      <div className="modal-actions left">
        <button className="pill-btn" onClick={saveIcs} disabled={busy || !icsUrl.trim()}>
          Save & sync
        </button>
        {calendar?.icsUrl && (
          <button
            className="pill-btn subtle danger-text"
            onClick={async () => {
              await api.clearIcs();
              await loadCalendarStatus();
              setIcsUrl('');
              toast('info', 'ICS feed removed');
            }}
          >
            Remove feed
          </button>
        )}
      </div>

      {calendar && calendar.googleConnected && calendar.icsUrl && (
        <>
          <hr className="sep" />
          <label className="field">
            <span>Active source</span>
            <select
              value={calendar.mode}
              onChange={async (e) => {
                await api.setCalendarMode(e.target.value as 'google' | 'ics');
                await loadCalendarStatus();
                syncNow(true);
              }}
            >
              <option value="google">Google (two-way)</option>
              <option value="ics">ICS feed (read-only)</option>
            </select>
          </label>
        </>
      )}
      {calendar?.syncError && <p className="error-note">Last sync error: {calendar.syncError}</p>}
    </div>
  );
}

/* ---------- Daily blocks (templates) ---------- */

function BlocksTab() {
  const templates = useStore((s) => s.templates);
  const categories = useStore((s) => s.categories);
  const loadTemplates = useStore((s) => s.loadTemplates);
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<Partial<Template> | null>(null);

  const saveDraft = async () => {
    if (!draft?.title?.trim()) return;
    try {
      if (draft.id) {
        await api.patchTemplate(draft.id, draft);
      } else {
        await api.createTemplate(draft as Template & { title: string });
      }
      setDraft(null);
      await loadTemplates();
      toast('success', 'Daily block saved — it appears on matching days from today onward');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <div className="settings-section">
      <p className="hint">
        Daily blocks are your fixed routine (practice, reading…). They auto-appear in the day's
        queue on the weekdays you pick.
      </p>
      <div className="template-list">
        {templates.map((t) => {
          const cat = categories.find((c) => c.id === t.category_id);
          return (
            <div key={t.id} className={`template-row ${t.active ? '' : 'inactive'}`}>
              <label className="switch" title={t.active ? 'Active' : 'Paused'}>
                <input
                  type="checkbox"
                  checked={Boolean(t.active)}
                  onChange={async (e) => {
                    await api.patchTemplate(t.id, { active: e.target.checked ? 1 : 0 });
                    loadTemplates();
                  }}
                />
                <span className="slider" />
              </label>
              <div className="template-main" onClick={() => setDraft({ ...t })}>
                <span className="template-title">
                  {cat && <span style={{ marginRight: 6 }}>{cat.emoji}</span>}
                  {t.title}
                </span>
                <span className="template-days">
                  {t.days.length === 7
                    ? 'every day'
                    : t.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' ')}
                  {t.planned_start ? ` · ${t.planned_start}` : ''}
                </span>
              </div>
              <button
                className="icon-btn"
                title="Delete block"
                onClick={async () => {
                  await api.deleteTemplate(t.id);
                  loadTemplates();
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        {templates.length === 0 && !draft && (
          <div className="books-empty">No daily blocks yet — add your routine below.</div>
        )}
      </div>

      {draft ? (
        <div className="template-editor">
          <div className="field-row">
            <label className="field grow">
              <span>Title</span>
              <input
                value={draft.title ?? ''}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Morning reading"
                autoFocus
              />
            </label>
            <label className="field">
              <span>Category</span>
              <select
                value={draft.category_id ?? ''}
                onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
              >
                <option value="">—</option>
                {categories
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <div className="field">
              <span>Days</span>
              <div className="day-picker">
                {WEEKDAYS.map((label, d) => {
                  const days = draft.days ?? [0, 1, 2, 3, 4, 5, 6];
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      className={`day-dot ${on ? 'on' : ''}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          days: on ? days.filter((x) => x !== d) : [...days, d].sort(),
                        })
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="field">
              <span>Start (optional)</span>
              <input
                type="time"
                value={draft.planned_start ?? ''}
                onChange={(e) => setDraft({ ...draft, planned_start: e.target.value || null })}
              />
            </label>
            <label className="field">
              <span>Minutes</span>
              <input
                type="number"
                min={5}
                step={5}
                value={draft.planned_minutes ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    planned_minutes: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
          </div>
          <div className="modal-actions left">
            <button className="pill-btn accent" onClick={saveDraft} disabled={!draft.title?.trim()}>
              {draft.id ? 'Save block' : 'Add block'}
            </button>
            <button className="pill-btn subtle" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="pill-btn" onClick={() => setDraft({ days: [1, 2, 3, 4, 5] })}>
          ＋ Add daily block
        </button>
      )}
    </div>
  );
}

/* ---------- Categories ---------- */

function CategoriesTab() {
  const categories = useStore((s) => s.categories);
  const loadMeta = useStore((s) => s.loadMeta);
  const toast = useStore((s) => s.toast);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [newEmoji, setNewEmoji] = useState('✳️');

  return (
    <div className="settings-section">
      <div className="cat-settings-list">
        {categories.map((c) => (
          <div key={c.id} className={`cat-settings-row ${c.archived ? 'inactive' : ''}`}>
            <input
              type="color"
              value={c.color}
              onChange={async (e) => {
                await api.patchCategory(c.id, { color: e.target.value });
                loadMeta();
              }}
              title="Color"
            />
            <input
              className="emoji-input"
              defaultValue={c.emoji}
              maxLength={4}
              onBlur={async (e) => {
                if (e.target.value !== c.emoji) {
                  await api.patchCategory(c.id, { emoji: e.target.value });
                  loadMeta();
                }
              }}
              title="Emoji"
            />
            <input
              className="grow"
              defaultValue={c.name}
              onBlur={async (e) => {
                const name = e.target.value.trim();
                if (name && name !== c.name) {
                  await api.patchCategory(c.id, { name });
                  loadMeta();
                }
              }}
            />
            <button
              className="pill-btn subtle"
              onClick={async () => {
                await api.patchCategory(c.id, { archived: c.archived ? 0 : 1 });
                loadMeta();
              }}
            >
              {c.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        ))}
      </div>
      <div className="cat-settings-row add">
        <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
        <input
          className="emoji-input"
          value={newEmoji}
          maxLength={4}
          onChange={(e) => setNewEmoji(e.target.value)}
        />
        <input
          className="grow"
          placeholder="New category name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && newName.trim()) {
              await api.createCategory({ name: newName.trim(), color: newColor, emoji: newEmoji });
              setNewName('');
              loadMeta();
              toast('success', 'Category added');
            }
          }}
        />
        <button
          className="pill-btn"
          disabled={!newName.trim()}
          onClick={async () => {
            await api.createCategory({ name: newName.trim(), color: newColor, emoji: newEmoji });
            setNewName('');
            loadMeta();
            toast('success', 'Category added');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
