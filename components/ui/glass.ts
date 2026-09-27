import { colors } from '../../theme';
import { surfaceSheen, surfaceSheenStops } from '../../theme/materials';

/** Kept as the component-side name; the values live in theme/materials.ts. */
export const SHEEN = surfaceSheen;
export const SHEEN_STOPS = surfaceSheenStops;

/**
 * Glass edge: a bright hairline at the top and a faint violet shade at the
 * bottom, so surfaces read as glass on the mesh rather than flat fills.
 * The first stop must fall off quickly or it washes out the gradient.
 */

export const GLASS_EDGE = { borderWidth: 1, borderColor: colors.light.border } as const;
