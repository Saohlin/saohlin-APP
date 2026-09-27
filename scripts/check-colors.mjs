/**
 * Colours live under theme/ only (palette.json, tokens.ts, materials.ts).
 * Fails on any colour literal elsewhere. Comments are stripped before scanning.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', '.expo', 'ios', 'android', 'theme', '_to_delete', 'dist']);
const EXT = /\.(ts|tsx)$/;

/** Hex, rgb()/rgba(), hsl()/hsla() — anything that names a colour directly. */
const COLOUR = /(['"`])#[0-9A-Fa-f]{3,8}\1|\b(?:rgba?|hsla?)\(\s*[\d.]/g;

/** Strip block and line comments so documented measurements are not findings. */
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
  const lines = code(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(COLOUR)) {
      findings.push({ file: relative(ROOT, file), line: i + 1, text: m[0].trim() });
    }
  });
}

if (findings.length === 0) {
  console.log('check:colors  ok — every colour is defined under theme/');
  process.exit(0);
}

console.error(`check:colors  ${findings.length} colour literal(s) outside theme/\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`);
console.error(
  '\nAdd the value to theme/palette.json (semantic) or theme/materials.ts (a material\n' +
  'ramp), run `npm run theme`, and read it from there. If it genuinely belongs to one\n' +
  'component, it is still a colour and it still belongs in the theme.',
);
process.exit(1);
