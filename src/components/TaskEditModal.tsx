import { useState } from 'react';
import { useStore } from '../state/store';
import Modal from './Modal';
import { formatDuration } from '../utils';

const DURATIONS = [15, 25, 30, 45, 60, 90, 120];

export default function TaskEditModal() {
  const task = useStore((s) => s.editingTask)!;
  const categories = useStore((s) => s.categories);
  const books = useStore((s) => s.books);
  const calendar = useStore((s) => s.calendar);
  const patchTask = useStore((s) => s.patchTask);
  const pushTask = useStore((s) => s.pushTask);
  const setEditingTask = useStore((s) => s.setEditingTask);

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [categoryId, setCategoryId] = useState(task.category_id);
  const [bookId, setBookId] = useState(task.book_id);
  const [date, setDate] = useState(task.date);
  const [start, setStart] = useState(task.planned_start ?? '');
  const [minutes, setMinutes] = useState<number | ''>(task.planned_minutes ?? '');
  const [saving, setSaving] = useState(false);
  const [pushAfter, setPushAfter] = useState(false);

  const close = () => setEditingTask(null);
  const canPush = calendar?.mode === 'google' && calendar.googleConnected;

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    await patchTask(task.id, {
      title: title.trim(),
      notes,
      category_id: categoryId,
      book_id: bookId,
      date,
      planned_start: start || null,
      planned_minutes: minutes === '' ? null : Number(minutes),
    });
    if (pushAfter && start) {
      const fresh = useStore.getState().tasks.find((t) => t.id === task.id);
      if (fresh) await pushTask(fresh);
    }
    setSaving(false);
    close();
  };

  return (
    <Modal title="Edit task" onClose={close}>
      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          autoFocus
        />
      </label>

      <div className="field">
        <span>Category</span>
        <div className="cat-grid">
          {categories
            .filter((c) => !c.archived || c.id === categoryId)
            .map((c) => (
              <button
                key={c.id}
                className={`cat-pick ${categoryId === c.id ? 'active' : ''}`}
                style={{ ['--cat-color' as any]: c.color }}
                onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
              >
                <span>{c.emoji}</span> {c.name}
              </button>
            ))}
        </div>
      </div>

      <label className="field">
        <span>Book (for reading tasks)</span>
        <select value={bookId ?? ''} onChange={(e) => setBookId(e.target.value || null)}>
          <option value="">— none —</option>
          {books
            .filter((b) => b.status !== 'finished' || b.id === bookId)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
        </select>
      </label>

      <div className="field-row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Start time</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>Duration</span>
          <select
            value={minutes === '' ? '' : String(minutes)}
            onChange={(e) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">—</option>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {formatDuration(d)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {canPush && !task.calendar_event_id && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={pushAfter}
            onChange={(e) => setPushAfter(e.target.checked)}
            disabled={!start}
          />
          <span>
            Push to Google Calendar after saving
            {!start && <em className="hint"> — set a start time first</em>}
          </span>
        </label>
      )}
      {task.calendar_event_id && (
        <p className="hint">📅 Linked to a Google Calendar event — time changes sync automatically.</p>
      )}

      <div className="modal-actions">
        <button className="pill-btn subtle" onClick={close}>
          Cancel
        </button>
        <button className="pill-btn accent" onClick={save} disabled={!title.trim() || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
