# i18n

The app is Czech. English exists for development only.

```tsx
const t = useT();
t('common.continue')                     // Pokračovat
t('chat.greeting', { name: 'Terezo' })   // Ahoj, Terezo.

const { tp } = useI18n();
tp('trial.remaining', 3)                 // Zbývají ti 3 odpovědi zdarma
```

`cs.ts` is the source of truth and the fallback. `en.ts` is typed as `Dictionary`
(the shape of `cs.ts`), so a key added in Czech fails to compile until English has it.

## Language switcher

`components/dev/LanguageSwitcher` renders only when `LANGUAGE_SWITCH_VISIBLE`
(`__DEV__`) is on, and `setLang` is a no-op in production. The device locale is
ignored on purpose: the app is always Czech.

## Czech plurals

Czech has three forms (1 odpověď · 2 odpovědi · 5 odpovědí), so plural entries
are objects and `check:i18n` fails if a Czech plural is missing `one`, `few` or
`other`. The rule lives in `plural.ts` because Intl support in Hermes is inconsistent.

## Draft copy

Strings marked DRAFT in `cs.ts` (states, validation, membership, consent) are
placeholders pending approved copy. Feature names follow the agreed terminology
and shouldn't be renamed.

## Checks

`npm run check:i18n` catches empty strings, missing plural forms, placeholders
that differ between languages, and dashes (— or –) in copy.
