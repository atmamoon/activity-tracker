import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../../shared/types';
import { useStore } from '../state/store';
import { addDaysStr, conflictsForTask, formatDuration, formatTime } from '../utils';

interface Props {
  task: Task;
  sortable?: boolean;
  hero?: boolean;
}

export default function TaskCard({ task, sortable = false, hero = false }: Props) {
  const categories = useStore((s) => s.categories);
  const books = useStore((s) => s.books);
  const events = useStore((s) => s.events);
  const date = useStore((s) => s.date);
  const today = useStore((s) => s.today);
  const calendar = useStore((s) => s.calendar);
  const toggleTask = useStore((s) => s.toggleTask);
  const skipTask = useStore((s) => s.skipTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const moveTaskToDate = useStore((s) => s.moveTaskToDate);
  const pushTask = useStore((s) => s.pushTask);
  const unpushTask = useStore((s) => s.unpushTask);
  const setEditingTask = useStore((s) => s.setEditingTask);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !sortable,
  });

  const category = categories.find((c) => c.id === task.category_id);
  const book = books.find((b) => b.id === task.book_id);
  const conflicts = conflictsForTask(task, events, date);
  const pushed = Boolean(task.calendar_event_id);
  const canPush = calendar?.mode === 'google' && calendar.googleConnected;
  const finished = task.status !== 'todo';

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ['--cat-color' as any]: category?.color ?? 'var(--border-strong)',
  };

  const menuItem = (label: string, action: () => void, danger = false) => (
    <button
      className={`menu-item ${danger ? 'danger' : ''}`}
      onClick={() => {
        setMenuOpen(false);
        action();
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'task-card',
        hero ? 'hero' : '',
        finished ? `is-${task.status}` : '',
        isDragging ? 'dragging' : '',
        conflicts.length > 0 ? 'has-conflict' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="listitem"
    >
      {sortable && (
        <button
          className="drag-handle"
          {...attributes}
          {...listeners}
          title="Drag to reorder (or focus + space, then arrows)"
          aria-label={`Reorder ${task.title}`}
        >
          ⠿
        </button>
      )}

      <button
        className={`check ${task.status === 'done' ? 'checked' : ''} ${task.status === 'skipped' ? 'skipped' : ''}`}
        onClick={() => (task.status === 'skipped' ? skipTask(task) : toggleTask(task))}
        title={task.status === 'done' ? 'Mark as not done' : task.status === 'skipped' ? 'Restore' : 'Mark done'}
        aria-label={`Toggle ${task.title}`}
      >
        {task.status === 'done' ? '✓' : task.status === 'skipped' ? '↺' : ''}
      </button>

      <div className="task-body" onClick={() => setEditingTask(task)}>
        <div className="task-title-row">
          {hero && <span className="up-next-tag">NOW</span>}
          <span className="task-title">{task.title}</span>
        </div>
        <div className="task-meta">
          {category && (
            <span className="chip cat-chip">
              <span className="chip-emoji">{category.emoji}</span>
              {category.name}
            </span>
          )}
          {book && <span className="chip book-chip">📕 {book.title}</span>}
          {task.planned_start && (
            <span className="chip time-chip">
              🕒 {formatTime(task.planned_start)}
              {task.planned_minutes ? ` · ${formatDuration(task.planned_minutes)}` : ''}
            </span>
          )}
          {pushed && (
            <span className="chip pushed-chip" title="On your Google Calendar">
              📅 on calendar
            </span>
          )}
          {task.carried_from && task.carried_from !== task.date && (
            <span className="chip carried-chip" title={`Carried over from ${task.carried_from}`}>
              ↪ from {task.carried_from.slice(5)}
            </span>
          )}
          {conflicts.length > 0 && (
            <span
              className="chip conflict-chip"
              title={`Overlaps: ${conflicts.map((c) => c.summary).join(', ')}`}
            >
              ⚠ overlaps “{conflicts[0].summary}”
            </span>
          )}
          {task.notes && <span className="chip notes-chip" title={task.notes}>📝</span>}
        </div>
      </div>

      <div className="task-actions" ref={menuRef}>
        <button
          className="icon-btn kebab"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Task actions"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="menu">
            {menuItem('Edit…', () => setEditingTask(task))}
            {task.status === 'todo' &&
              menuItem(
                date === today ? 'Move to tomorrow' : 'Move to next day',
                () => moveTaskToDate(task, addDaysStr(date, 1))
              )}
            {task.status === 'todo' && menuItem('Skip today', () => skipTask(task))}
            {canPush &&
              task.status === 'todo' &&
              (pushed
                ? menuItem('Remove from calendar', () => unpushTask(task))
                : menuItem(
                    task.planned_start ? 'Push to calendar' : 'Push to calendar (needs a time)',
                    () =>
                      task.planned_start
                        ? pushTask(task)
                        : setEditingTask(task)
                  ))}
            {menuItem(
              pushed ? 'Delete (keep calendar event)' : 'Delete',
              () => deleteTask(task, false),
              true
            )}
            {pushed && menuItem('Delete + remove event', () => deleteTask(task, true), true)}
          </div>
        )}
      </div>
    </div>
  );
}
