/**
 * Reads the cards and the card of the day. Cards are read straight from
 * `public.cards` (row rules show published cards only); the daily draw goes
 * through `card_today` / `draw_card`, which keep it to one card per Prague day.
 *
 * Failures are thrown as `CardsError`, with a kind a screen can act on.
 */
import { supabase } from '../../lib/supabase';
import type { Card, CardDraw, CardRow } from './types';

const CARD_COLUMNS = 'id, position, name, keywords, quote, message, step, mantra, art_path, updated_at';

/**
 *   offline   no answer from the server (no connection, or the 10 s timeout)
 *   session   signed out or the token expired
 *   notFound  the card is not published (any more)
 *   unknown   anything else
 */
export type CardsErrorKind = 'offline' | 'session' | 'notFound' | 'unknown';

export class CardsError extends Error {
  constructor(readonly kind: CardsErrorKind) {
    super(kind);
    this.name = 'CardsError';
  }
}

type SupabaseError = { code?: string | null; message?: string | null; name?: string } | null;

export function classify(error: SupabaseError | unknown): CardsErrorKind {
  const e = (error ?? {}) as { code?: string | null; message?: string | null; name?: string };
  const code = e.code ?? '';
  const message = e.message ?? '';
  if (code === 'P0002') return 'notFound';
  if (code === '42501' || code === 'PGRST301' || code === '401') return 'session';
  // supabase-js reports a failed or aborted fetch with no SQLSTATE.
  if (!code || e.name === 'AbortError' || /network|fetch|abort|timed? ?out/i.test(message)) return 'offline';
  return 'unknown';
}

/** Public URL of an artwork path. Every upload has a new file name, so a URL never changes content. */
export function artUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from('card-art').getPublicUrl(path).data.publicUrl;
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    keywords: row.keywords ?? [],
    quote: row.quote,
    message: row.message,
    step: row.step,
    mantra: row.mantra,
    artUrl: artUrl(row.art_path),
    updatedAt: row.updated_at,
  };
}

async function run<T>(request: () => PromiseLike<{ data: unknown; error: SupabaseError }>): Promise<T> {
  let res: { data: unknown; error: SupabaseError };
  try {
    res = await request();
  } catch (e) {
    throw new CardsError(classify(e));
  }
  if (res.error) throw new CardsError(classify(res.error));
  return res.data as T;
}

/** The whole published deck, in deck order. */
export async function listPublishedCards(): Promise<Card[]> {
  const rows = await run<CardRow[] | null>(() =>
    supabase.from('cards').select(CARD_COLUMNS).eq('status', 'published').order('position'),
  );
  return (rows ?? []).map(toCard);
}

/** One published card. Throws `notFound` when it is a draft, deleted or unknown. */
export async function getCard(id: string): Promise<Card> {
  const row = await run<CardRow | null>(() =>
    supabase.from('cards').select(CARD_COLUMNS).eq('id', id).eq('status', 'published').maybeSingle(),
  );
  if (!row) throw new CardsError('notFound');
  return toCard(row);
}

/** Today's draw, or null when the user has not drawn yet today. */
export async function getTodayDraw(): Promise<CardDraw | null> {
  return (await run<CardDraw | null>(() => supabase.rpc('card_today'))) ?? null;
}

/**
 * Draws a card for today. If the user already drew today, that draw comes back
 * (`isNew: false`) whichever card was tapped.
 */
export function drawCard(cardId: string): Promise<CardDraw> {
  return run<CardDraw>(() => supabase.rpc('draw_card', { p_card_id: cardId }));
}
