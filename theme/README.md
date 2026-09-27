# Theme

`palette.json` is the only file that contains colour values. Everything else reads it.

```
palette.json ──▶ scripts/gen-theme-css.mjs ──▶ global.css               (CSS variables)
             │                              └▶ theme/tailwind-colors.js (Tailwind scale)
             └──▶ theme/tokens.ts ──────────▶ useTheme().colors         (Skia, gradients, StatusBar)
```

After editing `palette.json`:

```bash
npm run verify     # regenerates, checks contrast in both themes, typechecks
```

## Usage

Tailwind for JSX:

```tsx
<View className="bg-canvas px-gutter">
  <Text className="font-display text-title text-ink">Vytvořit účet</Text>
  <View className="rounded-input border border-edge-input bg-glass/glass" />
</View>
```

`useTheme()` for places Tailwind can't reach (Skia, gradient stops, status bar,
navigation theme):

```tsx
const { colors, gradients, shadow, space, type } = useTheme();
<LinearGradient colors={[...gradients.content]} />
```

## Naming

| Prefix | What it is |
|---|---|
| `canvas` `surface` `surface-raised` `surface-sunken` `glass` | surfaces, back to front |
| `ink` `ink-secondary` `ink-tertiary` `ink-disabled` `ink-inverse` `link` `on-accent` | text |
| `edge` `edge-subtle` `edge-strong` `edge-input` `edge-focus` | borders (`edge`, so `border-edge` reads well) |
| `brand-*` | brand colours; decorative, don't assume they pass contrast |
| `accent` `accent-strong` `accent-soft` `accent-on` | interactive purple |
| `success` `warning` `error` `info` + `-bg` `-edge` `-solid` `-on` | semantic states |

## Notes

- Brand colours aren't text colours: `brand-purple` is 2.69:1 on the canvas. For
  text use `accent-strong` (5.04:1); `accent` (3.59:1) is for UI elements only.
- Dark mode is defined and contrast-checked but switched off (`LIGHT_ONLY_LAUNCH`
  in `config.ts`). To enable it, flip the flag and set `userInterfaceStyle` in
  `app.json` to `"automatic"`.
- Spacing, radii and shadows in `layout.ts` are working values.
