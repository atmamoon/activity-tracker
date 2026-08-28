import { create } from 'zustand';
import { api, ApiError } from '../api';
import type { Book, CalendarEvent, CalendarStatus, Category, Task, Template } from '../../shared/types';
import { localDateStr, addDaysStr } from '../utils';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export type AppView = 'planner' | 'history';

interface StoreState {
  view: AppView;
  setView(view: AppView): void;
  today: string;
  date: string;
  tasks: Task[];
  events: CalendarEvent[];
  books: Book[];
  categories: Category[];
  templates: Template[];
  calendar: CalendarStatus | null;
  carryoverCandidates: Task[];
  dayLoading: boolean;
  syncing: boolean;
  toasts: Toast[];
  editingTask: Task | null;
  editingBook: Book | 'new' | null;
  settingsOpen: boolean;

  toast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;

  init(): Promise<void>;
  refreshToday(): void;
  loadDay(date: string): Promise<void>;
  goTo(date: string): void;
  goToday(): void;
  shiftDay(delta: number): void;

  addTask(input: { title: string; category_id?: string | null; book_id?: string | null }): Promise<void>;
  patchTask(id: string, body: Partial<Task>): Promise<void>;
  toggleTask(task: Task): Promise<void>;
  skipTask(task: Task): Promise<void>;
  deleteTask(task: Task, deleteEvent?: boolean): Promise<void>;
  reorderTasks(orderedIds: string[]): Promise<void>;
  moveTaskToDate(task: Task, date: string): Promise<void>;
  loadCarryover(): Promise<void>;
  carryover(taskIds: string[]): Promise<void>;
  pushTask(task: Task): Promise<void>;
  unpushTask(task: Task): Promise<void>;

  loadBooks(): Promise<void>;
  saveBook(id: string | null, body: Partial<Book> & { title?: string }): Promise<void>;
  bumpBookProgress(book: Book, amount: number): Promise<void>;
  reorderBooks(orderedIds: string[]): Promise<void>;
  deleteBook(id: string): Promise<void>;

  loadMeta(): Promise<void>;
  loadTemplates(): Promise<void>;

  loadCalendarStatus(): Promise<void>;
  syncNow(silent?: boolean): Promise<void>;

  setEditingTask(task: Task | null): void;
  setEditingBook(book: Book | 'new' | null): void;
  setSettingsOpen(open: boolean): void;
}

let toastSeq = 1;

export const useStore = create<StoreState>((set, get) => {
  const errText = (err: unknown) =>
    err instanceof ApiError ? err.message : (err as Error)?.message || 'Something went wrong';

  const handleError = (err: unknown, prefix?: string) => {
    console.error(err);
    get().toast('error', prefix ? `${prefix}: ${errText(err)}` : errText(err));
  };

  const applyTask = (task: Task & { _warning?: string }) => {
    const { _warning, ...clean } = task;
    if (_warning) get().toast('info', _warning);
    set((s) => ({
      tasks: s.tasks
        .map((t) => (t.id === clean.id ? (clean as Task) : t))
        .filter((t) => t.date === s.date),
    }));
  };

  return {
    view: 'planner',
    setView(view) {
      set({ view });
    },
    today: localDateStr(),
    date: localDateStr(),
    tasks: [],
    events: [],
    books: [],
    categories: [],
    templates: [],
    calendar: null,
    carryoverCandidates: [],
    dayLoading: false,
    syncing: false,
    toasts: [],
    editingTask: null,
    editingBook: null,
    settingsOpen: false,

    toast(kind, message) {
      const id = toastSeq++;
      set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
      window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    async init() {
      await Promise.all([get().loadMeta(), get().loadBooks(), get().loadCalendarStatus()]);
      await get().loadDay(get().date);
      const cal = get().calendar;
      if (cal && (cal.googleConnected || cal.icsUrl) && cal.mode !== 'none') {
        get().syncNow(true);
      }
    },

    refreshToday() {
      const now = localDateStr();
      if (now !== get().today) set({ today: now });
    },

    async loadDay(date) {
      // Commit the target date synchronously so rapid prev/next presses
      // compound correctly, and drop responses that arrive after another
      // navigation superseded them.
      set({ dayLoading: true, date });
      try {
        const payload = await api.getDay(date);
        if (get().date !== date) return;
        set({ tasks: payload.tasks, events: payload.events, dayLoading: false });
        get().loadCarryover();
      } catch (err) {
        if (get().date === date) set({ dayLoading: false });
        handleError(err, 'Could not load the day');
      }
    },

    goTo(date) {
      get().loadDay(date);
    },
    goToday() {
      get().refreshToday();
      get().loadDay(get().today);
    },
    shiftDay(delta) {
      get().loadDay(addDaysStr(get().date, delta));
    },

    async addTask(input) {
      try {
        const task = await api.createTask({ date: get().date, ...input, title: input.title });
        // Guard against the user switching days while the request was in flight.
        set((s) => (s.date === task.date ? { tasks: [...s.tasks, task] } : {}));
      } catch (err) {
        handleError(err, 'Could not add task');
      }
    },

    async patchTask(id, body) {
      try {
        const updated = await api.patchTask(id, body);
        applyTask(updated);
      } catch (err) {
        handleError(err, 'Could not save task');
      }
    },

    async toggleTask(task) {
      const next = task.status === 'done' ? 'todo' : 'done';
      // Optimistic flip for a snappy checkbox.
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, status: next } : t)),
      }));
      try {
        const updated = await api.patchTask(task.id, { status: next });
        applyTask(updated);
      } catch (err) {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)),
        }));
        handleError(err, 'Could not update task');
      }
    },

    async skipTask(task) {
      const next = task.status === 'skipped' ? 'todo' : 'skipped';
      try {
        const updated = await api.patchTask(task.id, { status: next });
        applyTask(updated);
      } catch (err) {
        handleError(err, 'Could not update task');
      }
    },

    async deleteTask(task, deleteEvent = false) {
      const prev = get().tasks;
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) }));
      try {
        const res = await api.deleteTask(task.id, deleteEvent);
        if (res.warning) get().toast('info', res.warning);
      } catch (err) {
        set({ tasks: prev });
        handleError(err, 'Could not delete task');
      }
    },

    async reorderTasks(orderedIds) {
      const date = get().date;
      const byId = new Map(get().tasks.map((t) => [t.id, t]));
      const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Task[];
      const rest = get().tasks.filter((t) => !orderedIds.includes(t.id));
      set({ tasks: [...reordered, ...rest] });
      try {
        const res = await api.reorderDay(date, orderedIds);
        // Reordering can auto-reschedule times to match the new order —
        // pick up the fresh times, but only if the user hasn't navigated away.
        set((s) => (s.date === date ? { tasks: res.tasks } : {}));
        (res.warnings ?? []).forEach((w) => get().toast('info', w));
      } catch (err) {
        handleError(err, 'Could not save the new order');
        get().loadDay(get().date);
      }
    },

    async moveTaskToDate(task, date) {
      const prev = get().tasks;
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) }));
      try {
        const updated = await api.patchTask(task.id, { date });
        if ((updated as any)._warning) get().toast('info', (updated as any)._warning);
        get().toast('success', `Moved to ${date === addDaysStr(get().today, 1) ? 'tomorrow' : date}`);
      } catch (err) {
        set({ tasks: prev });
        handleError(err, 'Could not move task');
      }
    },

    async loadCarryover() {
      const { date, today } = get();
      if (date < today) {
        set({ carryoverCandidates: [] });
        return;
      }
      try {
        const res = await api.carryoverCandidates(date);
        set({ carryoverCandidates: res.candidates });
      } catch {
        // Non-critical; ignore.
      }
    },

    async carryover(taskIds) {
      try {
        const res = await api.carryover(get().date, taskIds);
        set({ tasks: res.tasks, carryoverCandidates: [] });
        res.warnings.forEach((w) => get().toast('info', w));
        get().toast('success', `Brought ${taskIds.length} task${taskIds.length > 1 ? 's' : ''} to this day`);
      } catch (err) {
        handleError(err, 'Could not carry tasks over');
      }
    },

    async pushTask(task) {
      try {
        const updated = await api.pushTask(task.id);
        applyTask(updated);
        get().toast('success', 'Pushed to Google Calendar');
        get().syncNow(true);
      } catch (err) {
        handleError(err);
      }
    },

    async unpushTask(task) {
      try {
        const updated = await api.unpushTask(task.id);
        applyTask(updated);
        get().toast('success', 'Removed from Google Calendar');
        set((s) => ({
          events: s.events.filter((e) => e.id !== `${task.calendar_id}:${task.calendar_event_id}`),
        }));
      } catch (err) {
        handleError(err);
      }
    },

    async loadBooks() {
      try {
        const res = await api.getBooks();
        set({ books: res.books });
      } catch (err) {
        handleError(err, 'Could not load books');
      }
    },

    async saveBook(id, body) {
      try {
        if (id) {
          await api.patchBook(id, body);
        } else {
          await api.createBook(body as Book & { title: string });
        }
        await get().loadBooks();
      } catch (err) {
        handleError(err, 'Could not save book');
        throw err;
      }
    },

    async bumpBookProgress(book, amount) {
      const total = book.total;
      const next = Math.max(0, total != null ? Math.min(book.current + amount, total) : book.current + amount);
      set((s) => ({
        books: s.books.map((b) => (b.id === book.id ? { ...b, current: next } : b)),
      }));
      try {
        const updated = await api.patchBook(book.id, { current: next });
        set((s) => ({ books: s.books.map((b) => (b.id === book.id ? updated : b)) }));
      } catch (err) {
        get().loadBooks();
        handleError(err, 'Could not update progress');
      }
    },

    async reorderBooks(orderedIds) {
      const byId = new Map(get().books.map((b) => [b.id, b]));
      set({ books: orderedIds.map((id) => byId.get(id)).filter(Boolean) as Book[] });
      try {
        const res = await api.reorderBooks(orderedIds);
        set({ books: res.books });
      } catch (err) {
        get().loadBooks();
        handleError(err, 'Could not save book order');
      }
    },

    async deleteBook(id) {
      try {
        await api.deleteBook(id);
        set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
      } catch (err) {
        handleError(err, 'Could not delete book');
      }
    },

    async loadMeta() {
      try {
        const [cats, temps] = await Promise.all([api.getCategories(), api.getTemplates()]);
        set({ categories: cats.categories, templates: temps.templates });
      } catch (err) {
        handleError(err, 'Could not load configuration');
      }
    },

    async loadTemplates() {
      try {
        const res = await api.getTemplates();
        set({ templates: res.templates });
      } catch (err) {
        handleError(err, 'Could not load daily blocks');
      }
    },

    async loadCalendarStatus() {
      try {
        const status = await api.calendarStatus();
        set({ calendar: status });
      } catch {
        // Server not ready — non-fatal.
      }
    },

    async syncNow(silent = false) {
      const cal = get().calendar;
      if (!cal || cal.mode === 'none') {
        if (!silent) get().toast('info', 'Connect a calendar in Settings first');
        return;
      }
      set({ syncing: true });
      try {
        const res = await api.sync();
        set({ calendar: res.status, syncing: false });
        const payload = await api.getDay(get().date);
        set((s) => (s.date === payload.date ? { events: payload.events, tasks: payload.tasks } : {}));
        if (!silent) get().toast('success', `Calendar synced — ${res.eventCount} events in window`);
      } catch (err) {
        set({ syncing: false });
        await get().loadCalendarStatus();
        if (!silent) handleError(err);
      }
    },

    setEditingTask(task) {
      set({ editingTask: task });
    },
    setEditingBook(book) {
      set({ editingBook: book });
    },
    setSettingsOpen(open) {
      set({ settingsOpen: open });
      if (!open) {
        // Templates/categories may have changed; refresh the day so new
        // daily blocks materialize.
        get().loadMeta().then(() => get().loadDay(get().date));
        get().loadCalendarStatus();
      }
    },
  };
});
