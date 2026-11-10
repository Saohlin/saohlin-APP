/**
 * Server state for the cards, through TanStack Query. Screens use these hooks
 * only; they never call the API directly.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { CardsError, drawCard, getCard, getTodayDraw, listPublishedCards } from './api';
import type { Card, CardDraw } from './types';

export const cardKeys = {
  deck: ['cards', 'deck'] as const,
  card: (id: string) => ['cards', 'card', id] as const,
  today: ['cards', 'today'] as const,
};

/** Retry network trouble, never a card that is gone or a lost session. */
const retry = (failures: number, error: unknown) =>
  failures < 2 && !(error instanceof CardsError && (error.kind === 'notFound' || error.kind === 'session'));

/**
 * The published deck. Fresh for 10 minutes and refetched when the app comes
 * back to the foreground, so admin edits arrive without a new build.
 */
export function useCards() {
  return useQuery({
    queryKey: cardKeys.deck,
    queryFn: listPublishedCards,
    staleTime: 10 * 60_000,
    retry,
  });
}

/** One card. Starts from the deck already loaded, so opening a card costs no request. */
export function useCard(id: string | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: cardKeys.card(id ?? ''),
    queryFn: () => getCard(id ?? ''),
    enabled: !!id,
    staleTime: 10 * 60_000,
    retry,
    initialData: () => client.getQueryData<Card[]>(cardKeys.deck)?.find((c) => c.id === id),
    initialDataUpdatedAt: () => client.getQueryState(cardKeys.deck)?.dataUpdatedAt,
  });
}

/**
 * Today's card of the day, or null before the draw. Checked again whenever the
 * app returns to the foreground, so the grid comes back after midnight in Prague.
 */
export function useTodayDraw() {
  return useQuery({
    queryKey: cardKeys.today,
    queryFn: getTodayDraw,
    staleTime: 60_000,
    retry,
  });
}

/** Draws today's card. The answer (new, or the one already drawn today) becomes today's draw. */
export function useDrawCard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => drawCard(cardId),
    onSuccess: (draw: CardDraw) => client.setQueryData(cardKeys.today, draw),
  });
}

/** Fisher–Yates over a copy, so the deck keeps its order. */
function shuffle<T>(items: readonly T[]): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * The deck's card ids in a new random order each time the screen gains focus
 * (the drawer keeps screens mounted). The card behind each face-down slot is
 * fixed before the tap.
 */
export function useShuffledIds(cards: readonly Card[] | undefined): string[] {
  const [round, setRound] = useState(0);
  useFocusEffect(useCallback(() => setRound((r) => r + 1), []));
  const key = cards?.map((c) => c.id).join(',') ?? '';
  // `round` and `key` decide when to shuffle again; the shuffle itself is the point.
  return useMemo(() => shuffle(key ? key.split(',') : []), [round, key]);
}
