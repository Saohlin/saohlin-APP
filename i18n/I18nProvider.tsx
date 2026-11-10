import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { cs, type Dictionary } from './cs';
import { en } from './en';
import { DEFAULT_LANGUAGE, LANGUAGE_SWITCH_VISIBLE, LOCALES, type Language } from './config';
import { pluralFor } from './plural';
import type { Path, Plural, PluralPath, Vars } from './types';

const DICTS: Record<Language, Dictionary> = { cs, en };
type I18n = {
  lang: Language;
  setLang: (l: Language) => void;
  canSwitchLanguage: boolean;
  /** A plain string. `t('chat.greeting', { name: 'Terezo' })` */
  t: (path: Path<Dictionary>, vars?: Vars) => string;
  /** A counted string. `tp('trial.remaining', 3)` */
  tp: (path: PluralPath<Dictionary>, count: number, vars?: Vars) => string;
  formatDate: (d: Date | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
};

const I18nContext = createContext<I18n | null>(null);

const walk = (dict: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, dict);

const interpolate = (template: string, vars?: Vars) =>
  vars
    ? template.replace(/\{(\w+)\}/g, (whole, key: string) =>
        key in vars ? String(vars[key]) : whole,
      )
    : template;

export function I18nProvider({
  children,
  language,
}: {
  children: ReactNode;
  language?: Language;
}) {
  const [lang, setLangState] = useState<Language>(language ?? DEFAULT_LANGUAGE);

  const setLang = useCallback((next: Language) => {
    if (!LANGUAGE_SWITCH_VISIBLE) {
      if (__DEV__) {
        console.warn(
          '[i18n] Ignoring setLang: the app ships in Czech. Flip ' +
            'LANGUAGE_SWITCH_VISIBLE in i18n/config.ts once English is a reviewed ' +
            'product language rather than a developer aid.',
        );
      }
      return;
    }
    setLangState(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];

    /** Czech is the source language and the fallback. */
    const lookup = (path: string): unknown => walk(dict, path) ?? walk(cs, path);

    const t: I18n['t'] = (path, vars) => {
      const found = lookup(path);
      if (typeof found !== 'string') {
        if (__DEV__) console.warn(`[i18n] Missing string: ${path}`);
        return path;
      }
      return interpolate(found, vars);
    };

    const tp: I18n['tp'] = (path, count, vars) => {
      const found = lookup(path) as Plural | undefined;
      if (!found || typeof found !== 'object' || !('other' in found)) {
        if (__DEV__) console.warn(`[i18n] Missing plural: ${path}`);
        return path;
      }
      const category = pluralFor(lang)(count);
      const template = found[category] ?? found.other;
      return interpolate(template, { count, ...vars });
    };

    return {
      lang,
      setLang,
      canSwitchLanguage: LANGUAGE_SWITCH_VISIBLE,
      t,
      tp,
      formatDate: (d, opts) =>
        new Intl.DateTimeFormat(LOCALES[lang], opts ?? { day: '2-digit', month: '2-digit', year: 'numeric' })
          .format(typeof d === 'number' ? new Date(d) : d),
      formatNumber: (n, opts) => new Intl.NumberFormat(LOCALES[lang], opts).format(n),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>.');
  return ctx;
}

/** The common case. `const t = useT(); t('common.continue')` */
export function useT(): I18n['t'] {
  return useI18n().t;
}
