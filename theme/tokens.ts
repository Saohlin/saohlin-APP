import palette from './palette.json';

export type ColorToken = keyof typeof palette.light;
export type ColorScheme = 'light' | 'dark';
export type Palette = Record<ColorToken, string>;

/**
 * Token values as plain strings, for places Tailwind can't reach (Skia,
 * gradients, StatusBar, navigation theme). Don't hard-code colours elsewhere;
 * add them to palette.json and run `npm run theme`.
 */
export const colors: Record<ColorScheme, Palette> = {
  light: palette.light as Palette,
  dark: palette.dark as Palette,
};

/** Gradient stop arrays for expo-linear-gradient and Skia. */
export type GradientSet = {
  master: readonly string[];
  /** Forms, questions, results, chat. 135deg. */
  content: readonly string[];
  contentStops: readonly number[];
  /** Splash, intro and hero surfaces only, never a page background. */
  hero: readonly string[];
  /**
   * Chat bubble diagonal: Pearl Base → Soft Lavender → Lavender Shadow. Same on
   * both senders; alignment tells them apart.
   */
  bubble: readonly string[];
  bubbleStops: readonly number[];
  /**
   * Glass card fill: the bubble hues at 20% alpha. This is the card's only fill,
   * so the background shows through.
   */
  cardGlass: readonly string[];
  /** Violet orb inside the send control (the plate is LiquidSurface `soft`). */
  sendOrb: readonly string[];
};

export const gradients: Record<ColorScheme, GradientSet> = {
  light: {
    master: ['#F9E3EC', '#FAF7FA', '#EEE9F8', '#EDE9F4'],
    content: ['#F7E4EB', '#FAF9FC', '#E9E7F6', '#F4ECF7'],
    contentStops: [0, 0.38, 0.72, 1],
    hero: ['#F3C7CF', '#F8F5F8', '#DDDCEC', '#C6B8D0'],
    bubble: ['#FAF7FA', '#EEE9F8', '#EDE9F4'],
    bubbleStops: [0, 0.52, 1],
    cardGlass: ['#FAF7FA33', '#EEE9F833', '#EDE9F433'],
    sendOrb: ['#CBB6E2', '#9970C7', '#7543AC'],
  },
  dark: {
    master: ['#1A1422', '#100D14', '#161226', '#12101A'],
    content: ['#181322', '#100D14', '#141127', '#181425'],
    contentStops: [0, 0.38, 0.72, 1],
    hero: ['#2A1E30', '#161220', '#1C1830', '#0E0B14'],
    bubble: ['#1E1A2A', '#1A1625', '#15121F'],
    bubbleStops: [0, 0.52, 1],
    cardGlass: ['#1E1A2A33', '#1A162533', '#15121F33'],
    sendOrb: ['#BBA0DA', '#8C5EC0', '#5C3588'],
  },
};

/** Primary CTA glass material. See components/ui/LiquidButton.tsx. */
export const capsule = {
  aspect: 4.92,
  height: 56,
  wallRatio: 0.062,
  base: ['#D8C7EE', '#DCCBEC', '#D6C6E6', '#CDBFDC', '#CDC2D7', '#D3CAD9',
         '#D4CBD9', '#D0C7D5', '#D6C8D4', '#E4D0D9', '#EBC6DC', '#EFBBD9'],
  baseStops: [0, 0.09, 0.16, 0.24, 0.34, 0.46, 0.58, 0.7, 0.8, 0.88, 0.93, 1],
  capLeft: '#FFFFFF',
  capRight: '#FFC6E6',
  innerWall: ['#8E76B0', '#9B86B4', '#A87FA6'],
  outerContour: ['#BCA9D6', '#D2C4DE', '#D6A4C6'],
  /** Capsule label colour; same token as screen titles. */
  label: palette.light.textStrong,
} as const;

/**
 * Mesh backdrop spec. Light mode paints assets/brand/backdrop.png (see
 * MeshBackdrop) and only uses `base` here while the image decodes. Dark mode
 * still draws the blurred colour blobs.
 */
export type MeshSpec = {
  base: string;
  blur: number;
  /** x, y and r are fractions of the screen: x and r of width, y of height. */
  blobs: ReadonlyArray<{ x: number; y: number; r: number; color: string }>;
  /** Diagonal sheen laid over the blobs. */
  sheen: readonly [string, string, string];
};

export const mesh: Record<ColorScheme, MeshSpec> = {
  light: {
    // Colour under the backdrop image while it decodes (average of the image).
    base: '#D5CCD3',
    blur: 70,
    // Intentionally empty: light mode paints the backdrop image.
    blobs: [],
    sheen: ['#FFFFFF10', '#FFFFFF00', '#00000008'],
  },
  dark: {
    base: '#100D14',
    blur: 70,
    blobs: [
      { x: 0.06, y: 0.1, r: 0.62, color: '#3A2A20' },
      { x: 0.55, y: 0.02, r: 0.45, color: '#3A2230' },
      { x: 1.02, y: 0.3, r: 0.55, color: '#2E2440' },
      { x: 0.85, y: 0.75, r: 0.6, color: '#1E2838' },
      { x: 0.15, y: 0.7, r: 0.55, color: '#2C2138' },
      { x: 0.02, y: 1.02, r: 0.5, color: '#1C2A2A' },
      { x: 0.7, y: 1.0, r: 0.5, color: '#332920' },
    ],
    sheen: ['#FFFFFF08', '#FFFFFF00', '#00000020'],
  },
};
