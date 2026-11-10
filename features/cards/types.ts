/**
 * The SAOHLIN cards as the app sees them. They come from `public.cards`
 * (published only, managed in the admin panel); nothing about them is bundled.
 *
 * The long `meaning` is for CLAUDIA AI on the server and is never read here.
 *
 * Written by hand to match the migrations (`20261106100000_admin_cards.sql`,
 * `20261109100000_card_draws.sql`): the repo has no generated `Database` types
 * yet. Replace with the generated row types once `supabase gen types` runs.
 */

/** The columns the app may read from `public.cards` (the column grant). */
export type CardRow = {
  id: string;
  position: number;
  name: string;
  keywords: string[];
  quote: string | null;
  message: string | null;
  step: string | null;
  mantra: string | null;
  art_path: string | null;
  updated_at: string;
};

export type Card = {
  id: string;
  /** Place in the deck, from 1. */
  position: number;
  name: string;
  /** Usually three; shown in capitals joined by " • ". */
  keywords: string[];
  /** One line under the artwork, stored without quotation marks. */
  quote: string | null;
  /** "Vzkaz pro tebe". */
  message: string | null;
  /** "Tvůj konkrétní krok". */
  step: string | null;
  /** Line breaks are part of the text. Stored without quotation marks. */
  mantra: string | null;
  /** Public URL of the artwork in `card-art`, or null if a card has none. */
  artUrl: string | null;
  updatedAt: string;
};

/** One card of the day (`card_today`, `draw_card`). */
export type CardDraw = {
  id: string;
  /** Null when the card was deleted later; the name stays. */
  cardId: string | null;
  cardName: string;
  /** The Prague day the draw counts for, `YYYY-MM-DD`. */
  drawDay: string;
  drawnAt: string;
  /** False when the user had already drawn today and got that card back. */
  isNew: boolean;
};
