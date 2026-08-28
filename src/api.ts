import type {
  Book,
  CalendarEvent,
  CalendarStatus,
  Category,
  DayPayload,
  GoogleCalendarInfo,
  Task,
  Template,
} from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError('Cannot reach the local server — is `npm run dev` running?', 0);
  }
  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  getDay: (date: string) => request<DayPayload>(`/day/${date}`),
  createTask: (body: Partial<Task> & { date: string; title: string }) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  patchTask: (id: string, body: Partial<Task>) =>
    request<Task & { _warning?: string }>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteTask: (id: string, deleteEvent: boolean) =>
    request<{ ok: true; warning?: string }>(
      `/tasks/${id}${deleteEvent ? '?deleteEvent=1' : ''}`,
      { method: 'DELETE' }
    ),
  reorderDay: (date: string, taskIds: string[]) =>
    request<{ tasks: Task[]; warnings?: string[] }>(`/days/${date}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    }),
  carryoverCandidates: (date: string) =>
    request<{ candidates: Task[] }>(`/days/${date}/carryover`),
  carryover: (date: string, taskIds: string[]) =>
    request<{ tasks: Task[]; warnings: string[] }>(`/days/${date}/carryover`, {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    }),

  getBooks: () => request<{ books: Book[] }>('/books'),
  createBook: (body: Partial<Book> & { title: string }) =>
    request<Book>('/books', { method: 'POST', body: JSON.stringify(body) }),
  patchBook: (id: string, body: Partial<Book>) =>
    request<Book>(`/books/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  reorderBooks: (bookIds: string[]) =>
    request<{ books: Book[] }>('/books/reorder', {
      method: 'POST',
      body: JSON.stringify({ bookIds }),
    }),
  deleteBook: (id: string) => request<{ ok: true }>(`/books/${id}`, { method: 'DELETE' }),

  getCategories: () => request<{ categories: Category[] }>('/categories'),
  createCategory: (body: { name: string; color: string; emoji?: string }) =>
    request<Category>('/categories', { method: 'POST', body: JSON.stringify(body) }),
  patchCategory: (id: string, body: Partial<Category>) =>
    request<Category>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getTemplates: () => request<{ templates: Template[] }>('/templates'),
  createTemplate: (body: Partial<Template> & { title: string }) =>
    request<Template>('/templates', { method: 'POST', body: JSON.stringify(body) }),
  patchTemplate: (id: string, body: Partial<Template>) =>
    request<Template>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) =>
    request<{ ok: true }>(`/templates/${id}`, { method: 'DELETE' }),
  reorderTemplates: (templateIds: string[]) =>
    request<{ templates: Template[] }>('/templates/reorder', {
      method: 'POST',
      body: JSON.stringify({ templateIds }),
    }),

  calendarStatus: () => request<CalendarStatus>('/calendar/status'),
  setGoogleCredentials: (clientId: string, clientSecret: string) =>
    request<CalendarStatus>('/calendar/google/credentials', {
      method: 'POST',
      body: JSON.stringify({ clientId, clientSecret }),
    }),
  googleAuthUrl: () => request<{ url: string }>('/calendar/google/auth'),
  googleDisconnect: () =>
    request<CalendarStatus>('/calendar/google/disconnect', { method: 'POST' }),
  googleCalendars: () => request<{ calendars: GoogleCalendarInfo[] }>('/calendar/google/calendars'),
  selectCalendars: (calendarIds: string[], pushCalendarId?: string) =>
    request<CalendarStatus>('/calendar/google/select', {
      method: 'POST',
      body: JSON.stringify({ calendarIds, pushCalendarId }),
    }),
  setIcsUrl: (url: string) =>
    request<CalendarStatus>('/calendar/ics', { method: 'POST', body: JSON.stringify({ url }) }),
  clearIcs: () => request<CalendarStatus>('/calendar/ics', { method: 'DELETE' }),
  setCalendarMode: (mode: 'google' | 'ics' | 'none') =>
    request<CalendarStatus>('/calendar/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  sync: () => request<{ eventCount: number; status: CalendarStatus }>('/calendar/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  }),
  pushTask: (id: string) => request<Task>(`/tasks/${id}/push`, { method: 'POST' }),
  unpushTask: (id: string) => request<Task>(`/tasks/${id}/unpush`, { method: 'POST' }),
};

export type { Book, CalendarEvent, CalendarStatus, Category, Task, Template, GoogleCalendarInfo };
