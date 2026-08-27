import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useStore } from '../state/store';
import TaskCard from './TaskCard';
import QuickAdd from './QuickAdd';
import CarryoverBanner from './CarryoverBanner';

export default function DayQueue() {
  const tasks = useStore((s) => s.tasks);
  const date = useStore((s) => s.date);
  const today = useStore((s) => s.today);
  const dayLoading = useStore((s) => s.dayLoading);
  const reorderTasks = useStore((s) => s.reorderTasks);
  const [showFinished, setShowFinished] = useState(false);

  const pending = useMemo(() => tasks.filter((t) => t.status === 'todo'), [tasks]);
  const finished = useMemo(() => tasks.filter((t) => t.status !== 'todo'), [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = pending.map((t) => t.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const nextPending = arrayMove(ids, from, to);
    // Keep finished tasks after pending ones in the day ordering.
    reorderTasks([...nextPending, ...finished.map((t) => t.id)]);
  };

  const isPast = date < today;

  return (
    <div className="day-queue">
      <CarryoverBanner />
      <QuickAdd />

      {dayLoading && tasks.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : pending.length === 0 && finished.length === 0 ? (
        <div className="empty-state">
          <div className="empty-emoji">🌤️</div>
          <p>Nothing planned{isPast ? ' on this day' : ' yet'}.</p>
          {!isPast && (
            <p className="empty-hint">
              Add a task above, or set up recurring daily blocks in <b>Settings → Daily blocks</b>.
            </p>
          )}
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="queue-label up-next-label">
              {isPast ? 'Left unfinished' : 'Up next'}
            </div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <div className="task-list" role="list">
                {pending.map((task, i) => (
                  <TaskCard key={task.id} task={task} sortable hero={i === 0 && !isPast} />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {pending.length === 0 && finished.length > 0 && (
            <div className="all-done">
              <div className="empty-emoji">🎉</div>
              <p>All clear — everything on this day is handled.</p>
            </div>
          )}

          {finished.length > 0 && (
            <div className="finished-section">
              <button className="finished-toggle" onClick={() => setShowFinished((v) => !v)}>
                <span className={`chevron ${showFinished ? 'open' : ''}`}>▸</span>
                {finished.filter((t) => t.status === 'done').length} done
                {finished.some((t) => t.status === 'skipped') &&
                  ` · ${finished.filter((t) => t.status === 'skipped').length} skipped`}
              </button>
              {showFinished && (
                <div className="task-list finished" role="list">
                  {finished.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
