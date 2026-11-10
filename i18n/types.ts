import type { PluralCategory } from './plural';

/**
 * A string with plural forms. Czech dictionaries must fill `one`, `few` and
 * `other`; `many` covers decimals and falls back to `other` when absent.
 */
export type Plural = Partial<Record<PluralCategory, string>> & { other: string };

export type Node = string | Plural | { [key: string]: Node };

/** Dotted paths into the dictionary, e.g. 'chat.composerPlaceholder'. */
export type Path<T> = T extends string | Plural
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends Plural
          ? never
          : `${K}.${Path<T[K]>}`;
    }[keyof T & string];

/** Dotted paths that land on a Plural rather than a plain string. */
export type PluralPath<T> = T extends string | Plural
  ? never
  : {
      [K in keyof T & string]: T[K] extends Plural
        ? K
        : T[K] extends string
          ? never
          : `${K}.${PluralPath<T[K]>}`;
    }[keyof T & string];

export type Vars = Record<string, string | number>;
