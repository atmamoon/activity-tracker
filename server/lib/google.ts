import type { DB } from '../db.ts';
import { getSetting, setSetting } from '../db.ts';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export type FetchLike = typeof fetch;

export class GoogleAuthError extends Error {}

export class GoogleClient {
  private accessToken: string | null = null;
  private accessTokenExpiry = 0;

  constructor(
    private db: DB,
    private fetchImpl: FetchLike = fetch
  ) {}

  get clientId() {
    return getSetting(this.db, 'google_client_id');
  }
  get clientSecret() {
    return getSetting(this.db, 'google_client_secret');
  }
  get refreshToken() {
    return getSetting(this.db, 'google_refresh_token');
  }

  hasCredentials(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }
  isConnected(): boolean {
    return Boolean(this.hasCredentials() && this.refreshToken);
  }

  authUrl(redirectUri: string, state: string): string {
    if (!this.clientId) throw new GoogleAuthError('Google client credentials not configured');
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_BASE}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<void> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId ?? '',
      client_secret: this.clientSecret ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      throw new GoogleAuthError(
        `Token exchange failed: ${data.error ?? res.status} ${data.error_description ?? ''}`.trim()
      );
    }
    if (data.refresh_token) {
      setSetting(this.db, 'google_refresh_token', data.refresh_token);
    }
    this.accessToken = data.access_token;
    this.accessTokenExpiry = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  }

  disconnect() {
    setSetting(this.db, 'google_refresh_token', null);
    this.accessToken = null;
    this.accessTokenExpiry = 0;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry) return this.accessToken;
    const refreshToken = this.refreshToken;
    if (!refreshToken) throw new GoogleAuthError('Not connected to Google Calendar');
    const body = new URLSearchParams({
      client_id: this.clientId ?? '',
      client_secret: this.clientSecret ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      if (data.error === 'invalid_grant') {
        // Refresh token revoked/expired — force a reconnect.
        this.disconnect();
      }
      throw new GoogleAuthError(`Token refresh failed: ${data.error ?? res.status}`);
    }
    this.accessToken = data.access_token;
    this.accessTokenExpiry = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
    return this.accessToken;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const message = data?.error?.message ?? `Google API error ${res.status}`;
      throw new GoogleAuthError(message);
    }
    return data as T;
  }

  async listCalendars(): Promise<
    Array<{ id: string; summary: string; primary?: boolean; backgroundColor?: string; accessRole?: string }>
  > {
    const data = await this.api<{ items?: any[] }>('/users/me/calendarList?maxResults=100');
    return (data.items ?? []).map((c) => ({
      id: c.id,
      summary: c.summaryOverride ?? c.summary ?? c.id,
      primary: Boolean(c.primary),
      backgroundColor: c.backgroundColor,
      accessRole: c.accessRole,
    }));
  }

  async listEvents(
    calendarId: string,
    timeMinIso: string,
    timeMaxIso: string
  ): Promise<any[]> {
    const items: any[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await this.api<{ items?: any[]; nextPageToken?: string }>(
        `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
      );
      items.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }

  async insertEvent(calendarId: string, event: object): Promise<{ id: string }> {
    return this.api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  async patchEvent(calendarId: string, eventId: string, event: object): Promise<{ id: string }> {
    return this.api(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(event) }
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.api(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' }
      );
    } catch (err) {
      // Deleting an already-deleted event should not fail the operation.
      if (err instanceof GoogleAuthError && /404|410|not found|deleted/i.test(err.message)) return;
      throw err;
    }
  }
}
