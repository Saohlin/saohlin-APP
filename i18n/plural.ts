/**
 * Czech has three plural forms (1 odpověď · 2 odpovědi · 5 odpovědí).
 * Implemented by hand because Intl support in Hermes is inconsistent; categories follow CLDR.
 */
export type PluralCategory = 'one' | 'few' | 'many' | 'other';

/** Czech: one (1), few (2–4), many (decimals), other (0, 5+). */
export function czechPlural(n: number): PluralCategory {
  if (!Number.isInteger(n)) return 'many';
  if (n === 1) return 'one';
  if (n >= 2 && n <= 4) return 'few';
  return 'other';
}

/** English: one (1), other (everything else). */
export function englishPlural(n: number): PluralCategory {
  return Number.isInteger(n) && n === 1 ? 'one' : 'other';
}

export const pluralFor = (lang: 'cs' | 'en') => (lang === 'cs' ? czechPlural : englishPlural);
