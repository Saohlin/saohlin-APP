/**
 * Zodiac sign derived from date of birth rather than asked for.
 * Uses the standard tropical sun-sign dates.
 */
export type ZodiacSign =
  | 'aries' | 'taurus' | 'gemini' | 'cancer' | 'leo' | 'virgo'
  | 'libra' | 'scorpio' | 'sagittarius' | 'capricorn' | 'aquarius' | 'pisces';

/** [sign, first month, first day] — the sign runs until the next one starts. */
const STARTS: Array<[ZodiacSign, number, number]> = [
  ['capricorn', 12, 22],
  ['sagittarius', 11, 22],
  ['scorpio', 10, 23],
  ['libra', 9, 23],
  ['virgo', 8, 23],
  ['leo', 7, 23],
  ['cancer', 6, 21],
  ['gemini', 5, 21],
  ['taurus', 4, 20],
  ['aries', 3, 21],
  ['pisces', 2, 19],
  ['aquarius', 1, 20],
];

/** Takes an ISO `YYYY-MM-DD`. Returns undefined for anything it cannot read. */
export function zodiacFor(isoDate: string | undefined): ZodiacSign | undefined {
  if (!isoDate) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return undefined;
  const month = Number(m[2]);
  const day = Number(m[3]);
  for (const [sign, sm, sd] of STARTS) {
    if (month > sm || (month === sm && day >= sd)) return sign;
  }
  return 'capricorn';
}
