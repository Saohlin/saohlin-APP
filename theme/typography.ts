import { Platform, type TextStyle } from 'react-native';

/**
 * Michroma for brand text (titles, buttons, labels), Inter for everything that's
 * read. The two never swap roles. Both include latin-ext for Czech diacritics;
 * check háčky on capitals before tightening any lineHeight.
 */
/**
 * Body font switch, used to compare Inter, Manrope and DM Sans in the app.
 * Once the choice is final, keep the winner in `fonts` and remove the switch.
 */
export const BODY_FONT: 'inter' | 'manrope' | 'dmsans' = 'inter';

const BODY_FACES = {
  inter: {
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_500Medium',
    bodySemibold: 'Inter_600SemiBold',
  },
  manrope: {
    body: 'Manrope_400Regular',
    bodyMedium: 'Manrope_500Medium',
    bodySemibold: 'Manrope_600SemiBold',
  },
  dmsans: {
    body: 'DMSans_400Regular',
    bodyMedium: 'DMSans_500Medium',
    bodySemibold: 'DMSans_600SemiBold',
  },
} as const;

export const fonts = {
  display: 'Michroma_400Regular',
  ...BODY_FACES[BODY_FONT],
} as const;

const michroma = (
  fontSize: number,
  lineHeight: number,
  letterSpacing: number,
): TextStyle => ({
  fontFamily: fonts.display,
  fontSize,
  lineHeight,
  letterSpacing,
  textTransform: 'uppercase',
  ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
});

const inter = (
  fontSize: number,
  lineHeight: number,
  fontFamily: string = fonts.body,
): TextStyle => ({
  fontFamily,
  fontSize,
  lineHeight,
  ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
});

export const type = {
  /**
   * Guide name on the card detail screen. Long names wrap to two lines and
   * shrink to fit the column.
   */
  display: michroma(34, 40, 1.6),
  /** Screen titles: VYTVOŘIT ÚČET, POJĎME O KROK DÁL */
  titleLg: michroma(22, 31, 2.2),
  /** Chat greeting ("Ahoj, Terezo."). The only Michroma token that isn't uppercase. */
  greeting: { ...michroma(18.5, 26, 0.3), textTransform: 'none' as const },
  /** Section titles and the chat header */
  title: michroma(15, 23, 1.8),
  /**
   * Primary and secondary button labels.
   *
   * Michroma ships a single weight, so `fontWeight` synthesises the bold.
   * Check Android after any change here: on some RN versions a fontWeight next
   * to a custom fontFamily drops the family and falls back to the system font.
   * If that happens, remove the weight.
   */
  button: { ...michroma(10, 15, 1.1), fontWeight: '700' as const },
  /** Section heading inside a screen (e.g. the journal archive). */
  section: michroma(11, 16, 1.3),
  /** Field labels above an Inter input, and short UI captions */
  label: michroma(9, 12, 1.35),
  /** Navigation drawer labels. Smaller than `title` so long labels fit on one line. */
  navItem: michroma(13.5, 20, 1.2),
  /** Long-form reading */
  body: inter(15, 24),
  /** Subtitle under the wordmark on the welcome screen. Must fit on one line. */
  tagline: inter(20, 28),
  /** Lead paragraphs on the welcome screen. */
  lead: inter(13, 23),
  bodyMedium: inter(15, 24, fonts.bodyMedium),
  /** CLAUDIA AI replies and user messages */
  chat: inter(13.5, 21),
  /** Supporting copy, metadata, helper text. Generous line height on purpose. */
  caption: inter(12, 21),  // == tailwind.config.js `caption`. Keep in step.
  /** Timestamps, counters, the smallest metadata */
  micro: inter(10, 14),
} as const;

export type TypeToken = keyof typeof type;
