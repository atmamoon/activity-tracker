import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent, Task } from '../../shared/types';
import { useStore } from '../state/store';
import { eventBlock, formatTime, minutesOfDay, minutesToHhmm, taskBlock } from '../utils';

const START_HOUR = 6;
const END_HOUR = 24;
const PX_PER_HOUR = 52;
const PX_PER_MIN = PX_PER_HOUR / 60;
const SNAP_MINUTES = 15;
const MIN_DURATION = 15;
const DRAG_THRESHOLD_PX = 3;

interface Block {
  key: string;
  kind: 'event' | 'task';
  label: string;
  startMin: number;
  endMin: number;
  color?: string;
  task?: Task;
  lane: number;
  lanes: number;
}

interface DragPreview {
  taskId: string;
  mode: 'move' | 'resize';
  startMin: number;
  durationMin: number;
}

function layoutLanes(blocks: Omit<Block, 'lane' | 'lanes'>[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: Block[] = [];
  let cluster: Block[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneCount = Math.max(1, ...cluster.map((b) => b.lane + 1));
    cluster.forEach((b) => (b.lanes = laneCount));
    placed.push(...cluster);
    cluster = [];
  };
  for (const raw of sorted) {
    if (cluster.length > 0 && raw.startMin >= clusterEnd) flush();
    const laneEnds: number[] = [];
    cluster.forEach((b) => {
      laneEnds[b.lane] = Math.max(laneEnds[b.lane] ?? 0, b.endMin);
    });
    let lane = 0;
    while ((laneEnds[lane] ?? 0) > raw.startMin) lane++;
    cluster.push({ ...raw, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, raw.endMin);
  }
  if (cluster.length > 0) flush();
  return placed;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function Timeline() {
  const events = useStore((s) => s.events);
  const tasks = useStore((s) => s.tasks);
  const date = useStore((s) => s.date);
  const today = useStore((s) => s.today);
  const setEditingTask = useStore((s) => s.setEditingTask);
  const patchTask = useStore((s) => s.patchTask);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowTick, setNowTick] = useState(() => new Date());
  const [drag, setDrag] = useState<DragPreview | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const allDay = useMemo(() => events.filter((e) => e.all_day), [events]);

  const blocks = useMemo(() => {
    const linkedEventIds = new Set(
      tasks
        .filter((t) => t.calendar_event_id)
        .map((t) => `${t.calendar_id}:${t.calendar_event_id}`)
    );
    const raw: Omit<Block, 'lane' | 'lanes'>[] = [];
    for (const ev of events) {
      if (ev.all_day) continue;
      if (linkedEventIds.has(ev.id)) continue; // shown as the task block instead
      const b = eventBlock(ev as CalendarEvent, date);
      if (!b) continue;
      raw.push({
        key: `ev:${ev.id}`,
        kind: 'event',
        label: ev.summary,
        startMin: b.startMin,
        endMin: Math.max(b.endMin, b.startMin + 20),
      });
    }
    for (const t of tasks) {
      if (t.status === 'skipped') continue;
      const b = taskBlock(t);
      if (!b) continue;
      raw.push({
        key: `task:${t.id}`,
        kind: 'task',
        label: t.title,
        startMin: b.startMin,
        endMin: Math.max(b.endMin, b.startMin + 20),
        task: t,
      });
    }
    return layoutLanes(raw);
  }, [events, tasks, date]);

  const categories = useStore((s) => s.categories);
  const startMin = START_HOUR * 60;
  const totalMin = (END_HOUR - START_HOUR) * 60;
  const heightPx = (totalMin / 60) * PX_PER_HOUR;
  const yFor = (min: number) => ((Math.max(min, startMin) - startMin) / 60) * PX_PER_HOUR;

  const isToday = date === today;
  const nowMin = minutesOfDay(nowTick);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = isToday ? yFor(nowMin) - 120 : yFor(9 * 60);
    el.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isToday]);

  // Drag-to-move / drag-to-resize a task block, Google-Calendar style. Uses
  // plain pointer events (not dnd-kit) since this is free-form pixel
  // positioning on an absolutely-positioned grid, not list reordering.
  const startDrag = (e: React.MouseEvent, task: Task, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const block = taskBlock(task);
    if (!block) return;
    const origin = { startMin: block.startMin, durationMin: block.endMin - block.startMin };
    const startClientY = e.clientY;
    let moved = false;
    let preview: DragPreview = { taskId: task.id, mode, ...origin };
    setDrag(preview);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ns-resize';

    const onMove = (ev: MouseEvent) => {
      const deltaY = ev.clientY - startClientY;
      if (Math.abs(deltaY) > DRAG_THRESHOLD_PX) moved = true;
      const deltaMin = Math.round(deltaY / PX_PER_MIN / SNAP_MINUTES) * SNAP_MINUTES;
      if (mode === 'move') {
        const newStart = clamp(origin.startMin + deltaMin, 0, 24 * 60 - origin.durationMin);
        preview = { taskId: task.id, mode, startMin: newStart, durationMin: origin.durationMin };
      } else {
        const newDuration = clamp(origin.durationMin + deltaMin, MIN_DURATION, 24 * 60 - origin.startMin);
        preview = { taskId: task.id, mode, startMin: origin.startMin, durationMin: newDuration };
      }
      setDrag(preview);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setDrag(null);
      if (!moved) {
        if (mode === 'move') setEditingTask(task);
        return;
      }
      if (mode === 'move') {
        patchTask(task.id, { planned_start: minutesToHhmm(preview.startMin) });
      } else {
        patchTask(task.id, { planned_minutes: preview.durationMin });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="timeline">
      <div className="timeline-head">
        <span className="panel-title">Day timeline</span>
        <span className="timeline-sub">calendar + timed tasks · drag to move, edge to resize</span>
      </div>

      {allDay.length > 0 && (
        <div className="all-day-row">
          {allDay.map((e) => (
            <span key={e.id} className="chip all-day-chip" title={e.summary}>
              📅 {e.summary}
            </span>
          ))}
        </div>
      )}

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-grid" style={{ height: heightPx }}>
          {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => {
            const hour = START_HOUR + i;
            return (
              <div key={hour} className="hour-row" style={{ top: yFor(hour * 60) }}>
                <span className="hour-label">{formatTime(minutesToHhmm(hour * 60))}</span>
              </div>
            );
          })}

          {blocks.map((b) => {
            const isDragged = b.task && drag?.taskId === b.task.id;
            const effStart = isDragged ? drag!.startMin : b.startMin;
            const effEnd = isDragged ? drag!.startMin + drag!.durationMin : b.endMin;
            const top = yFor(effStart);
            const height = Math.max(22, yFor(effEnd) - top);
            const width = 100 / b.lanes;
            const cat = b.task ? categories.find((c) => c.id === b.task!.category_id) : undefined;
            const done = b.task?.status === 'done';
            return (
              <div
                key={b.key}
                className={`tl-block ${b.kind} ${done ? 'done' : ''} ${isDragged ? 'dragging' : ''}`}
                style={{
                  top,
                  height,
                  left: `calc(var(--gutter) + (100% - var(--gutter)) * ${(b.lane * width) / 100})`,
                  width: `calc((100% - var(--gutter)) * ${width / 100} - 4px)`,
                  ['--cat-color' as any]: cat?.color ?? 'var(--accent)',
                }}
                title={`${b.label} · ${formatTime(minutesToHhmm(effStart))}–${formatTime(minutesToHhmm(effEnd))}`}
                onMouseDown={
                  b.task && b.task.status === 'todo' ? (e) => startDrag(e, b.task!, 'move') : undefined
                }
                onClick={b.task && b.task.status !== 'todo' ? () => setEditingTask(b.task!) : undefined}
                role={b.task ? 'button' : undefined}
              >
                <span className="tl-block-label">
                  {b.kind === 'event' ? '📅 ' : ''}
                  {done ? '✓ ' : ''}
                  {b.label}
                </span>
                <span className="tl-block-time">
                  {formatTime(minutesToHhmm(effStart))}–{formatTime(minutesToHhmm(effEnd))}
                </span>
                {b.task && b.task.status === 'todo' && (
                  <div
                    className="tl-resize-handle"
                    onMouseDown={(e) => startDrag(e, b.task!, 'resize')}
                    title="Drag to change duration"
                  />
                )}
              </div>
            );
          })}

          {isToday && nowMin >= startMin && nowMin <= END_HOUR * 60 && (
            <div className="now-line" style={{ top: yFor(nowMin) }}>
              <span className="now-dot" />
            </div>
          )}
        </div>
      </div>

      {blocks.length === 0 && allDay.length === 0 && (
        <div className="timeline-empty">
          No calendar events or timed tasks for this day.
          <br />
          <span className="empty-hint">Connect your calendar in Settings to see busy blocks here.</span>
        </div>
      )}
    </div>
  );
}
