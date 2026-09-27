# Components

```ts
import { Screen, TextField, LiquidButton } from './components/ui';
```

Everything is themed through `theme/`. Components don't contain hex values, font
names or sizes that aren't tokens.

| Component | Used for |
|---|---|
| `Screen` `Section` `Divider` | every screen: safe area, gutter, pinned footer |
| `Title` `Body` `Caption` `Label` `Micro` … | text; the variant picks the font family |
| `LiquidButton` | the one primary CTA per screen |
| `SecondaryButton` `TextButton` `IconButton` `Chip` | other actions |
| `TextField` `TextArea` `SelectField` `DateField` `SearchField` | inputs |
| `Checkbox` `Radio` `Switch` | consent, profile, settings |
| `GlassCard` `ListRow` `SectionHeader` `JournalRow` | surfaces and lists |
| `Banner` `InlineMessage` `Toast` | messages and confirmations |
| `EmptyState` `ErrorState` `OfflineState` `LoadingState` `UpdateRequiredState` `MaintenanceState` `LimitReachedState` | shared screen states |
| `Skeleton` `SkeletonBubble` `SkeletonList` | loading placeholders |
| `StepDots` `StepBar` `ProgressBar` `TrialCounter` | progress |
| `ChatBubble` `TypingIndicator` `ChatComposer` | chat |
| `GuideCard` `GuideDrawGrid` `GuideGrid` | guide cards |
| `TopBar` | screen header |
| `Sheet` `Dialog` `Scrim` | pickers and confirmations |

## Conventions

- Every component accepts `className` and applies it last.
- `IconButton` requires a `label` for screen readers.
- Interactive components set `accessibilityRole` and `accessibilityState`.
- A limit is not an error: `LimitReachedState` uses a warm tone and no red.
- Chat replies vary a lot in length, and the first reply is often a question.
  Don't lay out the chat around long replies.
- Icons go through `Icon.tsx` (Phosphor). To switch to custom SVGs, keep the
  `IconName` union and swap the implementation.

## Checks

```bash
npm run verify   # theme → contrast → classes → colours → tokens → i18n → typecheck
```

`check:classes` exists because NativeWind silently ignores unknown classes.
