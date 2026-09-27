import type { ImageSourcePropType } from 'react-native';

import { DRAFT_COPY } from './draft-copy';

/**
 * The 23 Guides and their artwork. (Always "Průvodci", never tarot.)
 *
 * Guide numbers run 00–22 while artwork files run 01–23, so the artwork is
 * index + 1. Images are 900 × 1350 JPEG re-encodes of the 1200 × 1800 originals.
 */
export type Guide = {
  /** Guide number, 00–22. */
  id: number;
  name: string;
  art: ImageSourcePropType;
  /**
   * Short introduction shown beside the artwork. No hard line breaks; it wraps
   * in a narrow column. When absent, `guideById` derives it from `meaning`.
   */
  intro?: string;
  /**
   * Meaning, then guidance. Line breaks are stored in the copy on purpose.
   * Only Slunce has final copy so far.
   */
  meaning?: string;
  guidance?: string;
  /** True when the copy comes from `draft-copy.ts`. Marked on screen in dev builds. */
  draftCopy?: boolean;
};

export const GUIDE_BACK: ImageSourcePropType = require('../assets/cards/back.jpg');

export const GUIDES: Guide[] = [
  { id: 0, name: 'Stvořitel', art: require('../assets/cards/01.jpg') },
  { id: 1, name: 'Boží světlo', art: require('../assets/cards/02.jpg') },
  { id: 2, name: 'Lev', art: require('../assets/cards/03.jpg') },
  { id: 3, name: 'Shiva', art: require('../assets/cards/04.jpg') },
  { id: 4, name: 'Abundancia', art: require('../assets/cards/05.jpg') },
  { id: 5, name: 'Nefertiti', art: require('../assets/cards/06.jpg') },
  { id: 6, name: 'Milarepa', art: require('../assets/cards/07.jpg') },
  { id: 7, name: 'Archanděl Michael', art: require('../assets/cards/08.jpg') },
  { id: 8, name: 'Yuto', art: require('../assets/cards/09.jpg') },
  { id: 9, name: 'Geronimo', art: require('../assets/cards/10.jpg') },
  { id: 10, name: 'Ganesha', art: require('../assets/cards/11.jpg') },
  { id: 11, name: 'Ježíš', art: require('../assets/cards/12.jpg') },
  { id: 12, name: 'Strom života (Baobab)', art: require('../assets/cards/13.jpg') },
  { id: 13, name: 'Karkadan', art: require('../assets/cards/14.jpg') },
  { id: 14, name: 'Orel', art: require('../assets/cards/15.jpg') },
  {
    id: 15,
    name: 'Slunce',
    art: require('../assets/cards/16.jpg'),
    meaning:
      'Slunce přináší radost, úspěch a jasno.\n' +
      'Je to energie vitality, sebevědomí a životní síly.\n' +
      'Vše se vyvíjí správným směrem a ty jsi\n' +
      'na své cestě ve světle.',
    guidance:
      'Otevírej se radosti a vděčnosti.\n' +
      'Důvěřuj životu, podporuje tě.\n' +
      'Tvé světlo má sílu inspirovat ostatní.',
  },
  { id: 16, name: 'Křišťál', art: require('../assets/cards/17.jpg') },
  { id: 17, name: 'Bodhidharma', art: require('../assets/cards/18.jpg') },
  { id: 18, name: 'Paj Mej', art: require('../assets/cards/19.jpg') },
  { id: 19, name: 'Miyamoto Musashi', art: require('../assets/cards/20.jpg') },
  { id: 20, name: 'Čínský drak', art: require('../assets/cards/21.jpg') },
  { id: 21, name: 'Qilin', art: require('../assets/cards/22.jpg') },
  { id: 22, name: 'Quetzalcoatl', art: require('../assets/cards/23.jpg') },
];

/**
 * A guide with its copy, falling back to placeholder text where the final copy
 * isn't in yet. Removing draft-copy.ts and this branch removes all placeholders.
 */
export function guideById(id: number | string | undefined): Guide | undefined {
  const n = typeof id === 'string' ? Number.parseInt(id, 10) : id;
  const guide = Number.isFinite(n) ? GUIDES.find((g) => g.id === n) : undefined;
  if (!guide) return undefined;
  if (guide.meaning) return withIntro(guide);
  const draft = DRAFT_COPY[guide.id];
  return draft ? withIntro({ ...guide, ...draft, draftCopy: true }) : guide;
}

/**
 * Splits two-block copy into intro + meaning: the first two sentences become the
 * intro. Temporary; remove once guides set `intro` directly.
 */
function withIntro(guide: Guide): Guide {
  if (guide.intro || !guide.meaning) return guide;
  const lines = guide.meaning.split('\n');
  if (lines.length < 3) return guide;
  return {
    ...guide,
    intro: lines.slice(0, 2).join(' '),
    meaning: lines.slice(2).join('\n'),
  };
}

/**
 * All 23 guides, shuffled (Fisher–Yates over a copy, so GUIDES keeps its order).
 * The guide behind each card is fixed before the user taps.
 */
export function shuffleGuides(): Guide[] {
  const pool = [...GUIDES];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
