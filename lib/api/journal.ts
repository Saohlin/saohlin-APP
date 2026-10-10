/**
 * The journal (Deník) functions. Text is encrypted on the server under the
 * user's key; the app never touches the table, only these functions.
 *
 * Always POST (the `supabase.rpc` default). With `{ get: true }` the
 * arguments, a search term included, would travel in the URL.
 *
 * Bad requests are thrown as `JournalError`. Limits and edit conflicts are
 * ordinary answers (`kind: 'limit' | 'conflict'`): the server returns them as
 * data, so a screen never has to tell a limit from a fault.
 */
import { supabase } from '../supabase';

export type JournalSource = 'manual' | 'saved_message' | 'guide';

/** One row of a list. Never carries the body. */
export type EntrySummary = {
  id: string;
  /** The day the entry belongs to, `YYYY-MM-DD` (Prague). */
  entryDate: string;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  /** The first 160 characters on one line. */
  excerpt: string;
  bodyChars: number;
  sharedWithAi: boolean;
  source: JournalSource;
};

export type Entry = EntrySummary & {
  body: string;
  /** Sent back with an edit; a stale version is a conflict, not an overwrite. */
  version: number;
  sharedAt: string | null;
  sourceMessageId: string | null;
  deletedAt: string | null;
  /** The newest conversation the entry was shared into, if it still exists. */
  conversationId: string | null;
};

export type JournalHome = {
  /** Today in Prague, `YYYY-MM-DD`. The week strip is drawn from this, not the phone's clock. */
  today: string;
  weekStart: string;
  week: { date: string; count: number }[];
  todayCount: number;
  recent: EntrySummary[];
  total: number;
};

export type Cursor = { date: string; createdAt: string; id: string };
export type EntryPage = { items: EntrySummary[]; nextCursor: Cursor | null };

export type SearchHit = EntrySummary & { snippet: string | null };
export type SearchResult = { items: SearchHit[]; scanned: number; total: number };

export type LimitCode = 'RATE_LIMITED' | 'LIMIT_REACHED' | 'AI_PAUSED' | 'PAYWALL';
export type Limit = { kind: 'limit'; code: LimitCode; retryAfterSeconds?: number };

export type SaveResult = { kind: 'ok'; entry: Entry } | { kind: 'conflict'; entry: Entry } | Limit;
export type EntryResult = { kind: 'ok'; entry: Entry } | Limit;
export type DeleteResult = { kind: 'ok'; id: string; deletedAt: string } | Limit;
export type ShareResult = { kind: 'ok'; entry: Entry; conversationId: string } | Limit;
export type SearchAnswer = ({ kind: 'ok' } & SearchResult) | Limit;

/**
 * Why a call failed, in terms a screen can act on.
 *   offline   no answer from the server (no connection, or the 10 s timeout)
 *   session   signed out or the token expired
 *   consent   the consent for sensitive data was withdrawn; writing is off
 *   notFound  not this user's entry, deleted, or past the restore window
 *   invalid   the server refused the input (the app validates first, so a bug)
 *   unknown   anything else
 */
export type JournalErrorKind = 'offline' | 'session' | 'consent' | 'notFound' | 'invalid' | 'unknown';

export class JournalError extends Error {
  constructor(readonly kind: JournalErrorKind) {
    super(kind);
    this.name = 'JournalError';
  }
}

type RpcError = { code?: string | null; message?: string | null } | null;

/** Maps a Supabase error (or a thrown fetch failure) to a `JournalErrorKind`. */
export function classify(error: RpcError | unknown): JournalErrorKind {
  const e = (error ?? {}) as { code?: string | null; message?: string | null; name?: string };
  const code = e.code ?? '';
  const message = e.message ?? '';
  if (code === 'P0002') return 'notFound';
  if (code === '22023') return 'invalid';
  if (code === '42501') return message.includes('CONSENT_REQUIRED') ? 'consent' : 'session';
  if (code === 'PGRST301' || code === '401') return 'session';
  // supabase-js reports a failed or aborted fetch with no SQLSTATE.
  if (!code || e.name === 'AbortError' || /network|fetch|abort|timed? ?out/i.test(message)) return 'offline';
  return 'unknown';
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let res: { data: unknown; error: RpcError };
  try {
    res = await supabase.rpc(fn, args);
  } catch (e) {
    throw new JournalError(classify(e));
  }
  if (res.error) throw new JournalError(classify(res.error));
  return res.data as T;
}

/** The Deník screen in one call: the week, today, the four newest entries and the total. */
export function getHome(): Promise<JournalHome> {
  return call<JournalHome>('journal_home');
}

/** The archive, newest first. Pass the previous page's `nextCursor` to continue. */
export async function listEntries(before: Cursor | null = null, opts: { limit?: number; sharedOnly?: boolean } = {}): Promise<EntryPage> {
  const page = await call<Partial<EntryPage>>('journal_list', {
    p_before: before,
    p_limit: opts.limit ?? 30,
    p_shared_only: opts.sharedOnly ?? false,
  });
  return { items: page.items ?? [], nextCursor: page.nextCursor ?? null };
}

/** Which days in a range (at most 62 days) have entries. */
export async function listDays(from: string, to: string): Promise<{ date: string; count: number }[]> {
  return (await call<{ date: string; count: number }[] | null>('journal_days', { p_from: from, p_to: to })) ?? [];
}

export function getEntry(id: string): Promise<Entry> {
  return call<Entry>('journal_get', { p_id: id });
}

/**
 * Creates an entry. `clientEntryId` is made on the phone and reused on a
 * retry, so a save whose answer was lost never becomes two entries.
 */
export function createEntry(input: { clientEntryId: string; body: string; title?: string | null; entryDate?: string | null }): Promise<SaveResult> {
  return call<SaveResult>('journal_save', {
    p_client_entry_id: input.clientEntryId,
    p_body: input.body,
    p_title: input.title ?? null,
    p_entry_date: input.entryDate ?? null,
  });
}

/** Edits an entry. `expectedVersion` is the version the edit started from. */
export function updateEntry(input: { id: string; expectedVersion: number; body: string; title?: string | null; entryDate?: string | null }): Promise<SaveResult> {
  return call<SaveResult>('journal_save', {
    p_client_entry_id: null,
    p_body: input.body,
    p_title: input.title ?? null,
    p_entry_date: input.entryDate ?? null,
    p_id: input.id,
    p_expected_version: input.expectedVersion,
  });
}

/** "Uložit do deníku". The server copies the stored message; the app sends no text. */
export function saveMessage(messageId: string, clientEntryId: string): Promise<EntryResult> {
  return call<EntryResult>('journal_save_message', { p_message_id: messageId, p_client_entry_id: clientEntryId });
}

/** Hides the entry at once. It can be restored for 24 hours. */
export function deleteEntry(id: string): Promise<DeleteResult> {
  return call<DeleteResult>('journal_delete', { p_id: id });
}

export function restoreEntry(id: string): Promise<EntryResult> {
  return call<EntryResult>('journal_restore', { p_id: id });
}

/**
 * Shares an entry with CLAUDIA AI and opens a conversation on it. The entry
 * is read by the server from there on; nothing of it is sent to the chat by
 * the app.
 */
export function shareEntry(id: string): Promise<ShareResult> {
  return call<ShareResult>('journal_share', { p_id: id });
}

export function unshareEntry(id: string): Promise<EntryResult> {
  return call<EntryResult>('journal_unshare', { p_id: id });
}

/** Searches the newest entries, ignoring case and diacritics. 2 to 80 characters. */
export function searchEntries(query: string, limit = 20): Promise<SearchAnswer> {
  return call<SearchAnswer>('journal_search', { p_query: query, p_limit: limit });
}
