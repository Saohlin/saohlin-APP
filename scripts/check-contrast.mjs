// Fails if any text/surface pair in theme/palette.json drops below WCAG AA.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = JSON.parse(readFileSync(resolve(root, 'theme/palette.json'), 'utf8'));

const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground, background, minimum, what it is] — 4.5 for text, 3.0 for UI edges. */
const PAIRS = [
  ['text', 'canvas', 4.5, 'primary text'],
  ['text', 'surface', 4.5, 'primary text on a card'],
  ['textSecondary', 'canvas', 4.5, 'secondary text'],
  ['textSecondary', 'surface', 4.5, 'secondary text on a card'],
  ['textTertiary', 'canvas', 4.5, 'tertiary text'],
  ['textDisabled', 'canvas', 3.0, 'disabled text'],
  ['textLink', 'surface', 4.5, 'link'],
  ['accent', 'canvas', 3.0, 'accent as a UI mark'],
  ['accentStrong', 'canvas', 4.5, 'accent as text'],
  ['brandViolet', 'canvas', 4.5, 'brand violet as text'],
  ['brandViolet', 'surface', 4.5, 'brand violet on a card'],
  ['borderStrong', 'canvas', 3.0, 'strong edge'],
  ['borderInput', 'canvas', 3.0, 'input edge'],
  ['borderFocus', 'canvas', 3.0, 'focus ring'],
  ['tabActive', 'tabBar', 3.0, 'active tab'],
  ['tabInactive', 'tabBar', 4.5, 'inactive tab label'],
  ...['success', 'warning', 'error', 'info'].flatMap((s) => [
    [`${s}Fg`, `${s}Bg`, 4.5, `${s} text on its own tint`],
    [`${s}Fg`, 'canvas', 4.5, `${s} text on the canvas`],
    [`${s}On`, `${s}Solid`, 4.5, `${s} label on its solid fill`],
  ]),
];

let failed = 0;
for (const mode of ['light', 'dark']) {
  for (const [fg, bg, min, what] of PAIRS) {
    const a = p[mode][fg];
    const b = p[mode][bg];
    if (!a || !b) throw new Error(`Unknown token in ${mode}: ${fg} / ${bg}`);
    const r = ratio(a, b);
    if (r < min) {
      failed++;
      console.error(
        `FAIL  ${mode.padEnd(5)} ${what.padEnd(30)} ${fg} ${a} on ${bg} ${b} = ` +
          `${r.toFixed(2)}:1, needs ${min}:1`,
      );
    }
  }
}

if (failed) {
  console.error(`\n${failed} contrast failure(s). Fix theme/palette.json.`);
  process.exit(1);
}
console.log(`contrast: ${PAIRS.length * 2} pairs checked across both themes, all pass`);
