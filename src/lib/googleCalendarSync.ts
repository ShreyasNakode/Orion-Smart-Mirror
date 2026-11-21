import localforage from 'localforage';

export interface OrionCalendarEvent {
  id: string;
  googleEventId?: string;
  calendarId?: string;
  calendarSummary?: string;
  day: number;
  month: number;
  year: number;
  title: string;
  type?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  recurringEventId?: string;
  htmlLink?: string;
  status?: string;
  readOnly?: boolean;
}

interface GoogleCalendarMeta {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  selected?: boolean;
  deleted?: boolean;
  backgroundColor?: string;
}

interface CalendarSyncState {
  version: 2;
  events: OrionCalendarEvent[];
  eventSyncTokens: Record<string, string>;
  calendars: GoogleCalendarMeta[];
  lastSyncedAt?: string;
}

interface SyncGoogleCalendarOptions {
  token: string;
  userKey: string;
  forceFull?: boolean;
}

const API_ROOT = 'https://www.googleapis.com/calendar/v3';
const MAX_RESULTS = '2500';
const SYNC_PAST_MONTHS = 18;
const SYNC_FUTURE_MONTHS = 48;

const EVENT_TYPE_COLORS: Record<string, string> = {
  birthday: '4',
  meeting: '1',
  anniversary: '3',
  reminder: '5',
  deadline: '11',
};

const REVERSE_COLORS: Record<string, string> = {
  '4': 'birthday',
  '1': 'meeting',
  '3': 'anniversary',
  '5': 'reminder',
  '11': 'deadline',
};

const emptyState = (): CalendarSyncState => ({
  version: 2,
  events: [],
  eventSyncTokens: {},
  calendars: [],
});

const stateKey = (userKey: string) => `orion_google_calendar_sync_v2_${userKey}`;

export const getCalendarStateKey = stateKey;

export async function loadCachedGoogleCalendarEvents(userKey: string): Promise<OrionCalendarEvent[]> {
  const state = await localforage.getItem<CalendarSyncState>(stateKey(userKey));
  return Array.isArray(state?.events) ? state.events : [];
}

export async function clearGoogleCalendarSyncState(userKey: string) {
  await localforage.removeItem(stateKey(userKey));
}

export function getEventTypeColor(type: string) {
  return EVENT_TYPE_COLORS[type.toLowerCase()] || '1';
}

export function parseSyncedEventId(id: string) {
  const [calendarId, ...rest] = id.split('::');
  return {
    calendarId: rest.length > 0 ? calendarId : 'primary',
    eventId: rest.length > 0 ? rest.join('::') : id,
  };
}

async function googleFetch<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error?.message || body?.error || `Google Calendar API returned HTTP ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  return res.json() as Promise<T>;
}

async function listCalendars(token: string): Promise<GoogleCalendarMeta[]> {
  const calendars: GoogleCalendarMeta[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: '250',
      showDeleted: 'false',
      showHidden: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await googleFetch<{ items?: GoogleCalendarMeta[]; nextPageToken?: string }>(
      token,
      `${API_ROOT}/users/me/calendarList?${params.toString()}`
    );

    calendars.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return calendars.filter(calendar => {
    if (!calendar.id || calendar.deleted) return false;
    if (calendar.accessRole === 'freeBusyReader') return false;
    return calendar.selected !== false || calendar.primary || /holiday|birthday/i.test(calendar.summary || '');
  });
}

function syncWindow() {
  const now = new Date();
  const min = new Date(now.getFullYear(), now.getMonth() - SYNC_PAST_MONTHS, 1);
  const max = new Date(now.getFullYear(), now.getMonth() + SYNC_FUTURE_MONTHS + 1, 0, 23, 59, 59);
  return {
    timeMin: min.toISOString(),
    timeMax: max.toISOString(),
  };
}

function parseGoogleDate(value?: string) {
  if (!value) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function inferType(item: any, calendar: GoogleCalendarMeta) {
  const summary = String(item.summary || '');
  const calendarName = String(calendar.summary || '');

  if (item.colorId && REVERSE_COLORS[item.colorId]) return REVERSE_COLORS[item.colorId];

  const bracketMatch = summary.match(/^\[(.*?)\]/);
  if (bracketMatch) {
    const bracketType = bracketMatch[1].toLowerCase();
    if (['birthday', 'meeting', 'anniversary', 'reminder', 'deadline'].includes(bracketType)) return bracketType;
  }

  const combined = `${summary} ${calendarName} ${item.eventType || ''}`.toLowerCase();
  if (combined.includes('birthday')) return 'birthday';
  if (combined.includes('holiday')) return 'holiday';
  if (combined.includes('festival')) return 'festival';
  if (combined.includes('anniversary')) return 'anniversary';
  if (combined.includes('deadline')) return 'deadline';
  if (combined.includes('reminder')) return 'reminder';
  return 'event';
}

function normalizeEvent(item: any, calendar: GoogleCalendarMeta): OrionCalendarEvent | null {
  if (!item?.id || item.status === 'cancelled') return null;

  const rawStart = item.start?.dateTime || item.start?.date;
  const rawEnd = item.end?.dateTime || item.end?.date;
  const startDate = parseGoogleDate(rawStart);
  let title = item.summary || (item.transparency === 'transparent' ? 'Available' : 'Busy');
  title = String(title).replace(/^\[.*?\]\s*/, '').trim() || 'Untitled event';

  return {
    id: `${calendar.id}::${item.id}`,
    googleEventId: item.id,
    calendarId: calendar.id,
    calendarSummary: calendar.summary,
    day: startDate.getDate(),
    month: startDate.getMonth(),
    year: startDate.getFullYear(),
    title,
    type: inferType(item, calendar),
    start: rawStart,
    end: rawEnd,
    allDay: Boolean(item.start?.date),
    recurringEventId: item.recurringEventId,
    htmlLink: item.htmlLink,
    status: item.status,
    readOnly: !['owner', 'writer'].includes(calendar.accessRole || ''),
  };
}

async function syncCalendarEvents(
  token: string,
  calendar: GoogleCalendarMeta,
  previousEvents: OrionCalendarEvent[],
  previousToken?: string,
  forceFull?: boolean
) {
  const nextEventsById = new Map(previousEvents.map(event => [event.id, event]));
  const queryBase = new URLSearchParams({
    maxResults: MAX_RESULTS,
    singleEvents: 'true',
    showDeleted: 'true',
  });

  if (!previousToken || forceFull) {
    const window = syncWindow();
    queryBase.set('timeMin', window.timeMin);
    queryBase.set('timeMax', window.timeMax);
    queryBase.set('orderBy', 'startTime');
  } else {
    queryBase.set('syncToken', previousToken);
  }

  let pageToken: string | undefined;
  let nextSyncToken = previousToken;

  do {
    const params = new URLSearchParams(queryBase);
    if (pageToken) params.set('pageToken', pageToken);

    const data = await googleFetch<{ items?: any[]; nextPageToken?: string; nextSyncToken?: string }>(
      token,
      `${API_ROOT}/calendars/${encodeURIComponent(calendar.id)}/events?${params.toString()}`
    );

    for (const item of data.items || []) {
      const eventKey = `${calendar.id}::${item.id}`;
      if (item.status === 'cancelled') {
        nextEventsById.delete(eventKey);
        continue;
      }

      const normalized = normalizeEvent(item, calendar);
      if (normalized) nextEventsById.set(normalized.id, normalized);
    }

    pageToken = data.nextPageToken;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);

  return {
    events: Array.from(nextEventsById.values()),
    syncToken: nextSyncToken,
  };
}

export async function syncGoogleCalendars(options: SyncGoogleCalendarOptions): Promise<OrionCalendarEvent[]> {
  const stored = await localforage.getItem<CalendarSyncState>(stateKey(options.userKey));
  let state = stored?.version === 2 ? stored : emptyState();

  if (options.forceFull) state = emptyState();

  const calendars = await listCalendars(options.token);
  const activeCalendarIds = new Set(calendars.map(calendar => calendar.id));
  let nextEvents = state.events.filter(event => event.calendarId && activeCalendarIds.has(event.calendarId));
  const nextTokens: Record<string, string> = {};

  for (const calendar of calendars) {
    const calendarEvents = nextEvents.filter(event => event.calendarId === calendar.id);
    const previousToken = state.eventSyncTokens[calendar.id];

    try {
      const result = await syncCalendarEvents(options.token, calendar, calendarEvents, previousToken, options.forceFull);
      nextEvents = [
        ...nextEvents.filter(event => event.calendarId !== calendar.id),
        ...result.events,
      ];
      if (result.syncToken) nextTokens[calendar.id] = result.syncToken;
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 410 || status === 400) {
        const result = await syncCalendarEvents(options.token, calendar, [], undefined, true);
        nextEvents = [
          ...nextEvents.filter(event => event.calendarId !== calendar.id),
          ...result.events,
        ];
        if (result.syncToken) nextTokens[calendar.id] = result.syncToken;
      } else {
        throw error;
      }
    }
  }

  const sorted = nextEvents.sort((a, b) => {
    const aTime = new Date(a.start || new Date(a.year, a.month, a.day)).getTime();
    const bTime = new Date(b.start || new Date(b.year, b.month, b.day)).getTime();
    return aTime - bTime || a.title.localeCompare(b.title);
  });

  await localforage.setItem<CalendarSyncState>(stateKey(options.userKey), {
    version: 2,
    events: sorted,
    eventSyncTokens: nextTokens,
    calendars,
    lastSyncedAt: new Date().toISOString(),
  });

  return sorted;
}
