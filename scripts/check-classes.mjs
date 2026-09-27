/**
 * Fails on Tailwind classes that don't exist. NativeWind silently ignores
 * unknown classes, so typos otherwise render unstyled with no warning.
 * Scans className attributes and centralised class-map strings.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every .tsx under these roots, including expo-router's nested groups. */
const walkDir = (dir) => {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkDir(full));
    else if (e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
};

const files = ['components', 'app', 'auth', 'theme', 'i18n'].flatMap((d) => walkDir(join(root, d)));

const UTILITY = new RegExp(
  '^(' +
    ['flex', 'grid', 'block', 'hidden', 'absolute', 'relative', 'inset', 'items', 'justify',
     'self', 'gap', 'space', 'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt',
     'mb', 'ml', 'mr', 'w', 'h', 'min', 'max', 'size', 'rounded', 'border', 'bg', 'text',
     'font', 'leading', 'tracking', 'uppercase', 'lowercase', 'capitalize', 'opacity',
     'shadow', 'overflow', 'z', 'grow', 'shrink', 'basis', 'active', 'disabled', 'dark',
     'aspect', 'object', 'top', 'bottom', 'left', 'right', 'transform', 'scale', 'rotate',
    ].join('|') +
    ')(-|:|$)',
);

const looksLikeClass = (t) => UTILITY.test(t);

/** Extract the balanced {...} or "..." that follows a className prop. */
function classNameRegions(src) {
  const out = [];
  const re = /className\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      const end = src.indexOf(q, i + 1);
      if (end > -1) out.push(src.slice(i + 1, end));
      continue;
    }
    if (src[i] !== '{') continue;
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

const found = new Set();
const add = (s) => {
  for (const t of s.split(/\s+/)) if (t && looksLikeClass(t)) found.add(t);
};

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const region of classNameRegions(src)) {
    for (const q of region.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`$\n]*)`/g)) {
      add(q[1] ?? q[2] ?? q[3] ?? '');
    }
    if (!region.startsWith('{')) add(region);
  }
  // Centralised class maps: multi-token strings that are mostly utilities.
  for (const q of src.matchAll(/'([^'\n]* [^'\n]*)'/g)) {
    const tokens = q[1].split(/\s+/).filter(Boolean);
    const hits = tokens.filter(looksLikeClass).length;
    if (tokens.length > 1 && hits / tokens.length >= 0.6) add(q[1]);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'saohlin-classes-'));
const safelist = join(dir, 'safelist.txt');
const out = join(dir, 'out.css');
writeFileSync(safelist, [...found].join(' '));
execSync(`npx tailwindcss -i ./global.css -o ${out} --content ${JSON.stringify(safelist)}`, {
  cwd: root,
  stdio: 'pipe',
});
const css = readFileSync(out, 'utf8');

/** Tailwind escapes everything outside [A-Za-z0-9_-] with a backslash. */
const selector = (c) => '.' + c.replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
const missing = [...found].filter((c) => !css.includes(selector(c)));

if (missing.length) {
  console.error('Unknown Tailwind classes — these render as nothing:\n  ' + missing.sort().join('\n  '));
  process.exit(1);
}
console.log(`classes: ${found.size} scanned across ${files.length} files, all resolve`);
