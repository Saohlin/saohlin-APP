/**
 * Dates and small pure helpers for the journal screens. An entry's day is a
 * plain `YYYY-MM-DD` string decided by the server (Prague); nothing here
 * converts it through a time zone, so an entry never jumps to another day on
 * a phone set to a different zone.
 *
 * Pure, so it is tested without a device (lib/journal/journal.test.ts).
 */
import type { Cursor, EntrySummary, JournalHome } from '../api/journal';

/** Longest entry the server accepts (journal.body_max_chars; the table ceiling is the same). */
export const MAX_BODY_CHARS = 10000;
/** The counter appears once the entry is this close to the limit. */
export const COUNTER_FROM = 9000;
/** Characters of a shared entry that reach CLAUDIA AI (journal.share_max_chars). */
export const SHARE_MAX_CHARS = 4000;
/** Search needs at least this many characters (the server refuses fewer). */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 80;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDay(s: unknown): s is string {
  return typeof s === 'string' && ISO_DAY.test(s);
}

/** `2026-07-30` -> `30. 07. 2026`, the form on her journal screen. */
export function displayDay(iso: string): string {
  const m = ISO_DAY.exec(iso);
  return m ? `${m[3]}. ${m[2]}. ${m[1]}` : iso;
}

/** `HH:MM` on the phone's clock, for when an entry was written. */
export function displayTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A local Date at midnight for a server day. Only for components that take a Date (the week strip). */
export function dayToDate(iso: string): Date {
  const m = ISO_DAY.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(NaN);
}

/** The reverse of `dayToDate`: the calendar day a local Date shows. */
export function dateToDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day after `iso`, staying in calendar arithmetic (no time zone, no DST). */
export function nextDay(iso: string): string {
  const m = ISO_DAY.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return d.toISOString().slice(0, 10);
}

/**
 * A cursor that starts the list at the newest entry of one day. journal_list
 * returns rows strictly before its cursor, so "before the very start of the
 * next day" is "this day and older".
 */
export function cursorForDay(iso: string): Cursor {
  return { date: nextDay(iso), createdAt: '-infinity', id: '00000000-0000-0000-0000-000000000000' };
}

/** Rows of one day out of a page that starts at that day, and whether older days were reached. */
export function takeDay(items: EntrySummary[], iso: string): { items: EntrySummary[]; reachedOlder: boolean } {
  const mine = items.filter((e) => e.entryDate === iso);
  return { items: mine, reachedOlder: items.some((e) => e.entryDate < iso) };
}

/** What the search field holds, as the server wants it: trimmed, or null when too short to search. */
export function searchTerm(raw: string): string | null {
  const q = raw.trim().slice(0, SEARCH_MAX_CHARS);
  return q.length >= SEARCH_MIN_CHARS ? q : null;
}

/** Appends a page without repeating a row (a refresh can overlap the next page). */
export function appendPage(have: EntrySummary[], page: EntrySummary[]): EntrySummary[] {
  const seen = new Set(have.map((e) => e.id));
  return [...have, ...page.filter((e) => !seen.has(e.id))];
}

const newestFirst = (a: EntrySummary, b: EntrySummary) =>
  a.entryDate !== b.entryDate ? (a.entryDate < b.entryDate ? 1 : -1)
    : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1)
    : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/** A list with one entry added or replaced, kept newest first. */
export function upsertEntry(list: EntrySummary[], e: EntrySummary): EntrySummary[] {
  return [...list.filter((x) => x.id !== e.id), e].sort(newestFirst);
}

/** Home as it will look once the server has the change, so the screen does not wait for a refetch. */
export function homeWithSaved(home: JournalHome, e: EntrySummary, isNew: boolean): JournalHome {
  const bump = (count: number) => (isNew ? count + 1 : count);
  return {
    ...home,
    recent: upsertEntry(home.recent, e).slice(0, 4),
    total: bump(home.total),
    todayCount: e.entryDate === home.today ? bump(home.todayCount) : home.todayCount,
    week: home.week.map((d) => (d.date === e.entryDate ? { ...d, count: bump(d.count) } : d)),
  };
}

export function homeWithout(home: JournalHome, e: Pick<EntrySummary, 'id' | 'entryDate'>): JournalHome {
  if (!home.recent.some((x) => x.id === e.id) && home.total === 0) return home;
  const drop = (count: number) => Math.max(0, count - 1);
  return {
    ...home,
    recent: home.recent.filter((x) => x.id !== e.id),
    total: drop(home.total),
    todayCount: e.entryDate === home.today ? drop(home.todayCount) : home.todayCount,
    week: home.week.map((d) => (d.date === e.entryDate ? { ...d, count: drop(d.count) } : d)),
  };
}

/** Just the list fields of a full entry. */
export function toSummary<T extends EntrySummary>(e: T): EntrySummary {
  return {
    id: e.id, entryDate: e.entryDate, createdAt: e.createdAt, updatedAt: e.updatedAt, title: e.title,
    excerpt: e.excerpt, bodyChars: e.bodyChars, sharedWithAi: e.sharedWithAi, source: e.source,
  };
}

/** Seconds as a wait a person can read: under a minute, minutes, or "tomorrow". */
export function waitKind(seconds: number | undefined): 'moment' | 'minutes' | 'tomorrow' {
  if (!seconds || seconds <= 90) return 'moment';
  return seconds <= 2 * 60 * 60 ? 'minutes' : 'tomorrow';
}
