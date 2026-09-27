/**
 * The first release ships light mode only. The dark palette is defined and
 * contrast-checked but not exposed. To enable it, set this to false and change
 * `userInterfaceStyle` in app.json to "automatic".
 */
export const LIGHT_ONLY_LAUNCH = true;

/** What the app falls back to before the user has chosen, and when locked. */
export const DEFAULT_SCHEME = 'light' as const;
