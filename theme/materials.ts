/**
 * Glass material colour ramps used by components/ui/LiquidSurface.tsx. The
 * drawing logic stays in the component; only colour data lives here.
 * Light only for now (the first release ships light mode).
 */

export type GlassRamp = {
  wall: readonly string[];
  wallStops: readonly number[];
  base: readonly string[];
  baseStops: readonly number[];
  specular: readonly string[];
  bounce: readonly string[];
  sheen: readonly string[];
  rim: readonly string[];
  caustic: readonly string[];
  innerWall: readonly string[];
  inside: readonly string[];
  contour: readonly string[];
};

export const IRIDESCENT = {
  wall: ['#DCCBEE', '#DFD0EC', '#E2DAEA', '#E6D8E4', '#EDCBE2', '#EFBFDC'],
  wallStops: [0, 0.12, 0.4, 0.7, 0.9, 1],
  base: [
    '#D8C7EE', '#DCCBEC', '#D6C6E6', '#CDBFDC', '#CDC2D7', '#D3CAD9',
    '#D4CBD9', '#D0C7D5', '#D6C8D4', '#E4D0D9', '#EBC6DC', '#EFBBD9',
  ],
  baseStops: [0, 0.09, 0.16, 0.24, 0.34, 0.46, 0.58, 0.7, 0.8, 0.88, 0.93, 1],
  specular: ['#FFFFFF', '#6A5F74', '#191620', '#000000'],
  bounce: ['#FFC6E6', '#6E4A62', '#20161C', '#000000'],
  sheen: ['#000000', '#0E0A12', '#5A5164', '#7C7186', '#191420', '#000000'],
  rim: ['#FFFFFF', '#D8D8D8', '#4D4D4D', '#575757', '#CCCCCC', '#FFFFFF'],
  caustic: ['#000000', '#000000', '#2E2E2E', '#D9D9D9', '#FFFFFF'],
  innerWall: ['#FFFFFF', '#FFFFFF', '#9A80AE', '#BBA6C4', '#EFE4F2'],
  inside: ['#8E76B0FF', '#9B86B49E', '#9B86B433', '#A87FA6A8', '#A87FA6FF'],
  contour: ['#BCA9D6', '#D2C4DE', '#D6A4C6'],
} as const;

/**
 * `soft` tint: the same iridescence as the capsule, paler and translucent so the
 * background shows through. Default for icon buttons.
 */
export const SOFT = {
  wall: ['#EEE9F8C4', '#F3EEFAC4', '#FAF7FAC4', '#FBF2F6C4', '#F9E3ECC4', '#F7DDE9C4'],
  wallStops: [0, 0.12, 0.4, 0.7, 0.9, 1],
  base: [
    '#EDE7F8A8', '#EFEAF9A8', '#F2EDFAA4', '#F5F0FAA4', '#F8F4FAA4', '#FAF6FAA4',
    '#FBF5F8A4', '#FBF3F6A4', '#FCF0F4A4', '#FBEAF0A8', '#F9E3ECA8', '#F8DEE9A8',
  ],
  baseStops: [0, 0.09, 0.16, 0.24, 0.34, 0.46, 0.58, 0.7, 0.8, 0.88, 0.93, 1],
  specular: ['#FFFFFF', '#5A4A70', '#171224', '#000000'],
  bounce: ['#FFD3F4', '#5E3A56', '#170D14', '#000000'],
  sheen: ['#000000', '#0C0812', '#3A3050', '#4A3E62', '#120E1A', '#000000'],
  rim: ['#FFFFFF', '#F6E8F2', '#6A5A86', '#7A6A96', '#EFE2F0', '#FFFFFF'],
  caustic: ['#000000', '#000000', '#2A1F38', '#D9A8E6', '#FDECF8'],
  innerWall: ['#FFFFFF', '#FFFFFF', '#B9A0D2', '#DCCBEA', '#F7F0FA'],
  inside: ['#9970C7D8', '#9D86B8A6', '#9D86B830', '#C978E9A6', '#C978E9D8'],
  contour: ['#C9B4E0', '#DDD2EA', '#E9BEDC'],
} as const;

/**
 * Send-button bead: the glass tinted to the functional purple (#9970C7), with
 * only lightness varying across the stops. Keep in step with `gradients.sendOrb`.
 */
export const VIOLET = {
  wall: ['#DACCEB', '#CBB6E2', '#BBA0DA', '#AB8AD1', '#AB8AD1', '#BBA0DA'],
  wallStops: [0, 0.12, 0.4, 0.7, 0.9, 1],
  base: [
    '#CBB6E2', '#BBA0DA', '#AB8AD1', '#9C74C8', '#9970C7', '#8C5EC0',
    '#824FBA', '#8C5EC0', '#9970C7', '#AB8AD1', '#BBA0DA', '#CBB6E2',
  ],
  baseStops: [0, 0.09, 0.16, 0.24, 0.34, 0.46, 0.58, 0.7, 0.8, 0.88, 0.93, 1],
  specular: ['#FFFFFF', '#7A6E86', '#1E1A26', '#000000'],
  bounce: ['#DACCEB', '#5C3588', '#190F22', '#000000'],
  sheen: ['#000000', '#120C18', '#665A74', '#8A7C9A', '#1C1622', '#000000'],
  rim: ['#FFFFFF', '#DACCEB', '#683C9A', '#7543AC', '#CBB6E2', '#FFFFFF'],
  caustic: ['#000000', '#000000', '#502E75', '#CBB6E2', '#FFFFFF'],
  innerWall: ['#FFFFFF', '#FFFFFF', '#7543AC', '#9970C7', '#DACCEB'],
  inside: ['#5C3588FF', '#683C9A9E', '#683C9A33', '#9970C7A8', '#9970C7FF'],
  contour: ['#9C74C8', '#BBA0DA', '#AB8AD1'],
} as const;

/** Stop positions for the bands above. Geometry of the ramp, not of the shape. */
export const SHEEN_STOPS = [0, 0.055, 0.085, 0.105, 0.145, 0.3];
export const RIM_STOPS = [0, 0.1, 0.35, 0.62, 0.86, 1];
export const CAUSTIC_STOPS = [0, 0.55, 0.74, 0.88, 1];
export const WALL_STOPS = [0, 0.94, 0.963, 0.975, 1];

/** The three tints, by name, so a component never picks a ramp by literal. */
export const glass = { iridescent: IRIDESCENT, soft: SOFT, violet: VIOLET } as const;

/**
 * Lit edge for non-glass surfaces: bright hairline at the top, faint
 * `borderStrong` shade at the bottom. 8-digit hex for consistency.
 */
export const surfaceSheen = ['#FFFFFFB3', '#FFFFFF0F', '#FFFFFF00', '#9D86B80F'] as const;
export const surfaceSheenStops = [0, 0.07, 0.55, 1] as const;

/** Inner white lip of the glass card, fading to the fill over ~12 pt. */
export const cardGlow = { color: '#FFFFFFF2', blur: 12 } as const;

/**
 * Bottom fade for scrolling lists. #C5C7D4 is sampled from the bottom of
 * backdrop.png; the ramp stops at 90% so small mismatches with the image stay invisible.
 */
export const scrollFade = ['#C5C7D400', '#C5C7D4B3', '#C5C7D4E6'] as const;
export const scrollFadeStops = [0, 0.55, 1] as const;
/** Top fade, much lighter than the bottom one. */
export const scrollFadeTop = ['#C5C7D44D', '#C5C7D41F', '#C5C7D400'] as const;
export const scrollFadeTopStops = [0, 0.5, 1] as const;
/** Fade height, about half a card. */
export const SCROLL_FADE_HEIGHT = 76;
