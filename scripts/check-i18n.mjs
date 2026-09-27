/**
 * Dictionary checks TypeScript can't make: empty strings, missing Czech plural
 * forms, placeholders present in one language only, untranslated strings.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Strip the type annotations so the dictionaries can be evaluated without a transpiler.

const strip = (s) =>
  s
    .replace(/^import[^;]+;$/gm, '')
    .replace(/\bexport\b\s+/g, '')
    .replace(/\bas\s+Plural\b/g, '')
    .replace(/type\s+Dictionary\s*=[^;]+;/g, '')
    .replace(/const\s+(cs|en)\s*:\s*Dictionary\s*=/, 'const $1 =')
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const evalDict = (file, name) => {
  const body = strip(readFileSync(resolve(root, file), 'utf8'));
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return ${name};`)();
};

const cs = evalDict('i18n/cs.ts', 'cs');
const en = evalDict('i18n/en.ts', 'en');

const problems = [];
const REQUIRED_CZECH_FORMS = ['one', 'few', 'other'];

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const walk = (a, b, path = '') => {
  for (const key of Object.keys(a)) {
    const p = path ? `${path}.${key}` : key;
    const av = a[key];
    const bv = b?.[key];

    if (typeof av === 'string') {
      if (!av.trim()) problems.push(`${p}: empty in cs`);
      // No em or en dashes in rendered copy.
      for (const [lang, value] of [['cs', av], ['en', bv]]) {
        if (typeof value === 'string' && /[—–]/.test(value)) {
          problems.push(`${p}: em or en dash in ${lang} — use a comma or a colon`);
        }
      }
      if (typeof bv !== 'string' || !bv.trim()) {
        problems.push(`${p}: empty or missing in en`);
      } else if (placeholders(av) !== placeholders(bv)) {
        problems.push(`${p}: placeholders differ — cs {${placeholders(av)}} vs en {${placeholders(bv)}}`);
      }
      continue;
    }

    if (av && typeof av === 'object' && 'other' in av) {
      for (const form of REQUIRED_CZECH_FORMS) {
        if (!av[form]) problems.push(`${p}: Czech plural is missing "${form}" (1 / 2–4 / 5+)`);
      }
      if (!bv || !bv.one || !bv.other) problems.push(`${p}: English plural needs "one" and "other"`);
      continue;
    }

    walk(av, bv ?? {}, p);
  }
};

walk(cs, en);

const count = (o) =>
  Object.values(o).reduce((n, v) => (typeof v === 'string' ? n + 1 : n + count(v)), 0);

if (problems.length) {
  console.error('i18n problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`i18n: ${count(cs)} strings, cs and en agree on keys, plurals and placeholders`);
