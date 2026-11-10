/**
 * Corner radii and type sizes must come from tokens (theme/layout.ts,
 * theme/typography.ts), not be restated in components. Comments are stripped first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', '.expo', 'ios', 'android', 'theme', '_to_delete', 'dist', '.venv-seed']);
const EXT = /\.(ts|tsx)$/;

const RULES = [
  { re: /\brounded-\[[^\]]+\]/g,          why: 'arbitrary corner radius — add one to `radius` in theme/layout.ts and its Tailwind mirror' },
  { re: /\bborderRadius:\s*[0-9]/g,        why: 'raw corner radius — use `radius` from the theme' },
  { re: /\btext-\[[^\]]+\]/g,              why: 'arbitrary type size — use a `type` token' },
  { re: /\bfontSize:\s*[0-9]/g,            why: 'raw type size — use a `type` token' },
  { re: /\bletterSpacing:\s*[0-9]/g,       why: 'raw tracking — it belongs to a `type` token' },
  { re: /\bfontFamily:\s*['"]/g,           why: 'raw font family — use a `type` token' },
];

// Hand-written radii are allowed where the shape is the value (circles, capsules).
const ALLOW = /radius \?\?|r = radius|size \/ 2|height \/ 2|h \/ 2/;

function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, ' '));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXT.test(name)) yield full;
  }
}

const findings = [];
for (const file of walk(ROOT)) {
  code(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
    if (ALLOW.test(line)) return;
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        findings.push({ file: relative(ROOT, file), line: i + 1, text: m[0].trim(), why: rule.why });
      }
    }
  });
}

if (findings.length === 0) {
  console.log('check:tokens  ok — radii and type come from the theme');
  process.exit(0);
}

console.error(`check:tokens  ${findings.length} value(s) set outside the theme\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}\n      ${f.why}`);
process.exit(1);
