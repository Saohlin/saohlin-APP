/**
 * Czech vocative (5. pád), applied in code rather than left to the model.
 * Correct for most Czech given names; foreign or unusual names can be wrong,
 * which is why the stored profile value always takes precedence.
 *
 *   -a                 -> -o        Anna -> Anno, Tereza -> Terezo, Honza -> Honzo
 *   -e -ě -i -í -o -u -y -ý         unchanged: Marie, Alice, Jiří, Hugo
 *   known feminine, consonant-final  unchanged: Dagmar, Ester, Miriam
 *   -ek                -> -ku       Marek -> Marku, Radek -> Radku
 *   -ěk                -> -ku       Zbyněk -> Zbyňku
 *   -el                -> -le       Pavel -> Pavle, Karel -> Karle
 *   consonant + r      -> -ře       Petr -> Petře, Alexandr -> Alexandře
 *   vowel + r          -> -re       Dalibor -> Dalibore, Igor -> Igore
 *   -k -g -h -ch       -> +u        Patrik -> Patriku, Vojtěch -> Vojtěchu
 *   -j -š -č -ř -ž -c -s -z -ď -ť -ň -> +i   Ondřej -> Ondřeji, Tomáš -> Tomáši
 *   any other consonant -> +e       Jan -> Jane, Adam -> Adame, Michal -> Michale
 *
 * Multi-word names are transformed word by word.
 */

/** Consonant-final feminine names that must not take a masculine ending. */
const FEMININE_CONSONANT = new Set([
  'dagmar',
  'ester',
  'miriam',
  'karin',
  'ingrid',
  'sarah',
  'rachel',
  'ruth',
  'nikol',
  'kristin',
  'jasmin',
  'yasmin',
  'carmen',
  'doris',
  'iris',
  'astrid',
  'sigrid',
  'heidi',
]);

/** Endings that are already the vocative. */
const UNCHANGED_FINALS = new Set(['e', 'ě', 'i', 'í', 'o', 'u', 'ú', 'ů', 'y', 'ý', 'é', 'á', 'ó']);

/** -u after a velar; -i after a soft consonant; -e after everything else. */
const VELAR = new Set(['k', 'g', 'h']);
const SOFT = new Set(['j', 'š', 'č', 'ř', 'ž', 'c', 's', 'z', 'ď', 'ť', 'ň']);
const VOWELS = new Set(['a', 'á', 'e', 'é', 'ě', 'i', 'í', 'o', 'ó', 'u', 'ú', 'ů', 'y', 'ý']);

/** n -> ň, t -> ť, d -> ď, when the following ě is dropped. */
const SOFTENED: Record<string, string> = { n: 'ň', t: 'ť', d: 'ď' };

function vocativeWord(word: string): string {
  if (word.length < 2) return word;

  const lower = word.toLowerCase();
  const last = lower.slice(-1);
  const stem = word.slice(0, -1);

  if (last === 'a') return `${stem}o`;
  if (UNCHANGED_FINALS.has(last)) return word;
  if (FEMININE_CONSONANT.has(lower)) return word;

  // Marek -> Marku, Zbyněk -> Zbyňku. The e is a fill vowel and disappears.
  if ((lower.endsWith('ek') || lower.endsWith('ěk')) && word.length > 3) {
    const before = word.slice(0, -2);
    const soft = lower.endsWith('ěk') ? SOFTENED[before.slice(-1).toLowerCase()] : undefined;
    const body = soft ? before.slice(0, -1) + soft : before;
    return `${body}ku`;
  }

  // Pavel -> Pavle, Karel -> Karle. Same fill vowel, different ending.
  if (lower.endsWith('el') && word.length > 3) return `${word.slice(0, -2)}le`;

  // Petr -> Petře but Dalibor -> Dalibore: the r hardens only when it carries
  // the syllable itself, which in practice means a consonant sits before it.
  if (last === 'r') {
    const before = lower.slice(-2, -1);
    return VOWELS.has(before) ? `${word}e` : `${word.slice(0, -1)}ře`;
  }

  if (lower.endsWith('ch')) return `${word}u`;
  if (VELAR.has(last)) return `${word}u`;
  if (SOFT.has(last)) return `${word}i`;
  return `${word}e`;
}

/** Suggested vocative for a name. A best guess, not guaranteed. */
export function czechVocative(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  return clean.split(' ').map(vocativeWord).join(' ');
}
