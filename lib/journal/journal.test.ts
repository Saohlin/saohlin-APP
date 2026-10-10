/**
 * The journal screens' logic without a device: dates that never cross a time
 * zone, paging helpers, the optimistic home, and which sentence a failure gets.
 *
 *   deno test --unstable-sloppy-imports lib/journal/
 */
import { deepStrictEqual as eq, ok } from 'node:assert';

import type { EntrySummary, JournalHome } from '../api/journal';
import { actionFaultCopy, isShareNotice, limitCopy, saveFaultCopy, shareNoticeCopy, shareNoticeOf } from './copy';
import {
  appendPage, cursorForDay, dateToDay, dayToDate, displayDay, homeWithSaved, homeWithout, isIsoDay, nextDay,
  searchTerm, takeDay, toSummary, upsertEntry, waitKind,
} from './format';

const entry = (id: string, entryDate: string, createdAt = `${entryDate}T10:00:00Z`, extra: Partial<EntrySummary> = {}): EntrySummary => ({
  id, entryDate, createdAt, updatedAt: createdAt, title: null, excerpt: `e${id}`, bodyChars: 2, sharedWithAi: false,
  source: 'manual', ...extra,
});

const home = (): JournalHome => ({
  today: '2026-10-10',
  weekStart: '2026-10-05',
  week: ['05', '06', '07', '08', '09', '10', '11'].map((d) => ({ date: `2026-10-${d}`, count: d === '09' ? 1 : 0 })),
  todayCount: 0,
  recent: [entry('a', '2026-10-09'), entry('b', '2026-10-01'), entry('c', '2026-09-30'), entry('d', '2026-09-29')],
  total: 4,
});

Deno.test('a day is shown as written, whatever the phone clock says', () => {
  eq(displayDay('2026-07-30'), '30. 07. 2026');
  eq(displayDay('not a day'), 'not a day');
  ok(isIsoDay('2026-01-01') && !isIsoDay('2026-1-1') && !isIsoDay(undefined));
});

Deno.test('day and Date convert both ways without moving the day', () => {
  for (const d of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29']) eq(dateToDay(dayToDate(d)), d);
});

Deno.test('the next day crosses months, years, leap days and clock changes', () => {
  eq(nextDay('2026-10-10'), '2026-10-11');
  eq(nextDay('2026-10-31'), '2026-11-01');
  eq(nextDay('2026-12-31'), '2027-01-01');
  eq(nextDay('2028-02-28'), '2028-02-29');
  eq(nextDay('2026-03-28'), '2026-03-29');
  eq(nextDay('2026-10-24'), '2026-10-25');
});

Deno.test('one day out of the archive: a cursor before the next day, and a stop at older rows', () => {
  eq(cursorForDay('2026-10-09'), { date: '2026-10-10', createdAt: '-infinity', id: '00000000-0000-0000-0000-000000000000' });
  const page = [entry('1', '2026-10-09'), entry('2', '2026-10-09'), entry('3', '2026-10-08')];
  eq(takeDay(page, '2026-10-09'), { items: page.slice(0, 2), reachedOlder: true });
  eq(takeDay(page.slice(0, 2), '2026-10-09').reachedOlder, false);
});

Deno.test('a search term is trimmed, capped, and refused when too short', () => {
  eq(searchTerm('  a '), null);
  eq(searchTerm(' klid '), 'klid');
  eq(searchTerm('x'.repeat(200))?.length, 80);
});

Deno.test('pages never repeat a row', () => {
  const a = [entry('1', '2026-10-09'), entry('2', '2026-10-08')];
  eq(appendPage(a, [entry('2', '2026-10-08'), entry('3', '2026-10-07')]).map((e) => e.id), ['1', '2', '3']);
});

Deno.test('a list stays newest first: day, then time, then id', () => {
  const list = [entry('b', '2026-10-09', '2026-10-09T08:00:00Z'), entry('a', '2026-10-01')];
  eq(upsertEntry(list, entry('c', '2026-10-09', '2026-10-09T09:00:00Z')).map((e) => e.id), ['c', 'b', 'a']);
  eq(upsertEntry(list, entry('a', '2026-10-10')).map((e) => e.id), ['a', 'b']);
});

Deno.test('a new entry shows on the home screen before the server is asked again', () => {
  const h = homeWithSaved(home(), entry('n', '2026-10-10'), true);
  eq([h.total, h.todayCount, h.week[5].count, h.recent.length, h.recent[0].id], [5, 1, 1, 4, 'n']);
  // A past day in this week counts for that day, not for today.
  const p = homeWithSaved(home(), entry('p', '2026-10-06'), true);
  eq([p.total, p.todayCount, p.week[1].count], [5, 0, 1]);
});

Deno.test('an edit changes the row and no count', () => {
  const h = homeWithSaved(home(), entry('a', '2026-10-09', '2026-10-09T10:00:00Z', { excerpt: 'new' }), false);
  eq([h.total, h.week[4].count, h.recent[0].excerpt, h.recent.length], [4, 1, 'new', 4]);
});

Deno.test('a delete leaves at once, and counts never go below zero', () => {
  const h = homeWithout(home(), { id: 'a', entryDate: '2026-10-09' });
  eq([h.total, h.week[4].count, h.recent.map((e) => e.id)], [3, 0, ['b', 'c', 'd']]);
  const empty = { ...home(), recent: [], total: 0 };
  eq(homeWithout(empty, { id: 'x', entryDate: '2026-10-10' }), empty);
});

Deno.test('a summary carries no body', () => {
  const full = { ...entry('a', '2026-10-09'), body: 'secret', version: 3 };
  ok(!('body' in toSummary(full)) && !('version' in toSummary(full)));
});

Deno.test('a wait is said in words a person can use', () => {
  eq([waitKind(undefined), waitKind(5), waitKind(600), waitKind(40000)], ['moment', 'moment', 'minutes', 'tomorrow']);
});

Deno.test('limits and failures each get their own sentence', () => {
  eq(limitCopy({ kind: 'limit', code: 'LIMIT_REACHED' }), 'journal.full');
  eq(limitCopy({ kind: 'limit', code: 'RATE_LIMITED', retryAfterSeconds: 3 }), 'journal.waitMoment');
  eq(limitCopy({ kind: 'limit', code: 'RATE_LIMITED', retryAfterSeconds: 50000 }), 'journal.waitTomorrow');
  eq(saveFaultCopy('offline'), 'journal.saveOffline');
  eq(saveFaultCopy('consent'), 'journal.consentRequired');
  eq(saveFaultCopy('unknown'), 'journal.saveFailed');
  eq(actionFaultCopy('offline'), 'journal.actionOffline');
  eq(actionFaultCopy('unknown', 'journal.shareFailed'), 'journal.shareFailed');
});

Deno.test('a share that did not happen survives a route parameter', () => {
  eq(shareNoticeOf({ kind: 'limit', code: 'PAYWALL' }), 'PAYWALL');
  eq(shareNoticeOf({ kind: 'limit', code: 'AI_PAUSED' }), 'AI_PAUSED');
  eq(shareNoticeOf({ kind: 'limit', code: 'RATE_LIMITED', retryAfterSeconds: 30 }), 'WAIT');
  eq(shareNoticeOf({ kind: 'limit', code: 'RATE_LIMITED', retryAfterSeconds: 30000 }), 'RATE_LIMITED');
  eq(shareNoticeOf('offline'), 'OFFLINE');
  eq(shareNoticeOf('unknown'), 'FAILED');
  ok(isShareNotice('PAYWALL') && !isShareNotice('paywall') && !isShareNotice(undefined));
  eq(shareNoticeCopy('RATE_LIMITED'), 'journal.shareLimit');
});
