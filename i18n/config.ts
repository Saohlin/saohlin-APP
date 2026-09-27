/**
 * The app is Czech. English is for development only: the switcher shows in
 * dev builds and is absent from release builds.
 */
export const LANGUAGE_SWITCH_VISIBLE = true;

// Always Czech rather than the device locale.
export const DEFAULT_LANGUAGE = 'cs' as const;

export type Language = 'cs' | 'en';

export const LANGUAGES: ReadonlyArray<{ code: Language; label: string; native: string }> = [
  { code: 'cs', label: 'Czech', native: 'Čeština' },
  { code: 'en', label: 'English', native: 'English' },
];

/**
 * BCP 47 tags for `Intl` and for any native control that localises itself —
 * the iOS date wheel takes one directly.
 */
export const LOCALES: Record<Language, string> = { cs: 'cs-CZ', en: 'en-GB' };
