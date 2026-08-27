import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskCard from '../../src/components/TaskCard.tsx';
import QuickAdd from '../../src/components/QuickAdd.tsx';
import { useStore } from '../../src/state/store.ts';
import type { CalendarEvent, Category, Task } from '../../shared/types.ts';

const category: Category = {
  id: 'cat1',
  name: 'Data Questions',
  color: '#3b82f6',
  emoji: '📊',
  position: 10,
  archived: 0,
};

const task: Task = {
  id: 't1',
  date: '2026-08-27',
  title: 'Practice SQL window functions',
  notes: '',
  category_id: 'cat1',
  book_id: null,
  status: 'todo',
  position: 10,
  planned_start: '15:30',
  planned_minutes: 60,
  calendar_event_id: null,
  calendar_id: null,
  template_id: null,
  carried_from: null,
  created_at: '2026-08-27T10:00:00Z',
  completed_at: null,
};

const overlappingEvent: CalendarEvent = {
  id: 'g:ev1',
  source: 'google',
  calendar_id: 'g',
  summary: 'Acme interview',
  start: '2026-08-27T15:00:00',
  end: '2026-08-27T16:00:00',
  all_day: 0,
  updated_at: '',
};

beforeEach(() => {
  useStore.setState({
    date: '2026-08-27',
    today: '2026-08-27',
    tasks: [task],
    events: [],
    categories: [category],
    books: [],
    calendar: null,
    toasts: [],
  });
  vi.restoreAllMocks();
});

describe('TaskCard', () => {
  it('renders title, category chip, and time chip', () => {
    render(<TaskCard task={task} />);
    expect(screen.getByText('Practice SQL window functions')).toBeInTheDocument();
    expect(screen.getByText('Data Questions')).toBeInTheDocument();
    expect(screen.getByText(/3:30 pm/)).toBeInTheDocument();
  });

  it('shows a conflict chip when the planned time overlaps a calendar event', () => {
    useStore.setState({ events: [overlappingEvent] });
    render(<TaskCard task={task} />);
    expect(screen.getByText(/overlaps/)).toBeInTheDocument();
    expect(screen.getByText(/Acme interview/)).toBeInTheDocument();
  });

  it('shows the NOW tag for the hero card and strike-through when done', () => {
    const { rerender } = render(<TaskCard task={task} hero />);
    expect(screen.getByText('NOW')).toBeInTheDocument();
    rerender(<TaskCard task={{ ...task, status: 'done' }} />);
    expect(screen.queryByText('NOW')).not.toBeInTheDocument();
  });

  it('toggles the task when the checkbox is clicked (optimistic)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ...task, status: 'done' }), { status: 200 }) as any
    );
    render(<TaskCard task={task} />);
    fireEvent.click(screen.getByTitle('Mark done'));
    // Optimistic update happens synchronously.
    expect(useStore.getState().tasks[0].status).toBe('done');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/t1',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('opens the actions menu with move/skip/delete', () => {
    render(<TaskCard task={task} />);
    fireEvent.click(screen.getByLabelText('Task actions'));
    expect(screen.getByText('Move to tomorrow')).toBeInTheDocument();
    expect(screen.getByText('Skip today')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('QuickAdd', () => {
  it('adds a task with the selected category on Enter', async () => {
    const created = { ...task, id: 't2', title: 'New drill', planned_start: null };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(created), { status: 201 }) as any
    );
    render(<QuickAdd />);
    fireEvent.click(screen.getByText('Data Questions'));
    const input = screen.getByPlaceholderText(/Add a task/);
    fireEvent.change(input, { target: { value: 'New drill' } });
    fireEvent.submit(input.closest('form')!);
    await vi.waitFor(() => {
      expect(useStore.getState().tasks.some((t) => t.id === 't2')).toBe(true);
    });
    const bodyArg = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(bodyArg).toMatchObject({ title: 'New drill', category_id: 'cat1', date: '2026-08-27' });
    // Input clears after submit.
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('does not submit empty titles', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}') as any);
    render(<QuickAdd />);
    const input = screen.getByPlaceholderText(/Add a task/);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
