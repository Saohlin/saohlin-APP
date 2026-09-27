import { Platform, type ViewStyle } from 'react-native';
import { colors, type ColorScheme } from './tokens';

// Spacing, radii and shadows. 8 pt step with a 4 pt half-step.
export const space = {
  /** 4 — hairline gaps only, e.g. between a label and its input */
  xxs: 4,
  /** 8 — the step */
  xs: 8,
  sm: 12,
  /** 16 — the default gap between related controls */
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  /** 26 — horizontal screen inset */
  gutter: 26,
} as const;

export const radius = {
  sm: 8,
  /** week-strip day tile */
  cell: 12,
  /** inputs and chips */
  input: 14,
  /** glass cards, guide cards, chat bubbles */
  card: 20,
  /** bottom sheets and modals */
  sheet: 28,
  /** the primary CTA and anything capsule-shaped */
  pill: 999,
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** Minimum tappable area. Below this, add hitSlop rather than shrinking it. */
export const MIN_TAP = 44;

/**
 * Elevation. iOS reads the shadow object and Android only `elevation`, so both
 * are set. The shadow colour comes from the palette's `borderStrong`.
 */
export const shadow = (scheme: ColorScheme) => {
  const dark = scheme === 'dark';
  const tint = dark ? colors.dark.overlay : colors.light.borderStrong;
  const mk = (opacity: number, radius: number, y: number, elevation: number): ViewStyle => ({
    shadowColor: tint,
    shadowOpacity: dark ? opacity * 2.2 : opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: y },
    ...(Platform.OS === 'android' ? { elevation } : null),
  });
  return {
    none: {} as ViewStyle,
    /** inputs and small glass surfaces */
    xs: mk(0.15, 6, 3, 2),
    /** cards */
    sm: mk(0.15, 12, 6, 4),
    /** the primary CTA */
    cta: mk(0.15, 12, 6, 4),
    /** sheets, drawers, the tab bar */
    lg: mk(0.2, 24, 12, 12),
    /** modals */
    xl: mk(0.28, 40, 20, 24),
  };
};

// Motion. Keep it short, and skip it when reduced motion is on.
export const motion = {
  fast: 90,
  base: 160,
  slow: 240,
  screen: 320,
  /** splash video length */
  splash: 5000,
  easing: { out: [0.16, 1, 0.3, 1], inOut: [0.65, 0, 0.35, 1] },
} as const;

export const z = {
  base: 0,
  sticky: 10,
  header: 20,
  drawer: 30,
  modal: 40,
  toast: 50,
} as const;

/** Opacity values that recur across the glass components. */
export const alpha = {
  glass: 0.62,
  glassSoft: 0.48,
  border: 0.58,
  highlight: 0.88,
  pressed: 0.06,
  disabled: 0.45,
} as const;

/** Convenience for the one-off places that need a colour with an alpha. */
export const withAlpha = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** The scrim behind a modal or drawer, in whichever theme is active. */
export const scrim = (scheme: ColorScheme) =>
  withAlpha(colors[scheme].scrim, scheme === 'dark' ? 0.72 : 0.45);
