import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cx } from './cx';

type Variant =
  | 'display'
  | 'titleLg'
  | 'title'
  | 'greeting'
  | 'button'
  | 'section'
  | 'label'
  | 'navItem'
  | 'body'
  | 'bodyMedium'
  | 'tagline'
  | 'lead'
  | 'chat'
  | 'caption'
  | 'micro';

/**
 * Variants pick the font family (Michroma or Inter), so there is no font prop.
 * Michroma variants are uppercase.
 */
const VARIANTS: Record<Variant, string> = {
  display: 'font-display text-display uppercase',
  titleLg: 'font-display text-title-lg uppercase',
  // The only Michroma variant without `uppercase`.
  greeting: 'font-display text-greeting',
  title: 'font-display text-title uppercase',
  button: 'font-display text-button uppercase',
  section: 'font-display text-section uppercase',
  label: 'font-display text-label uppercase',
  navItem: 'font-display text-nav-item uppercase',
  body: 'font-sans text-body',
  bodyMedium: 'font-sans-medium text-body',
  tagline: 'font-sans text-tagline',
  lead: 'font-sans text-lead',
  chat: 'font-sans text-chat',
  caption: 'font-sans text-caption',
  micro: 'font-sans text-micro',
};

/**
 * Default colour per variant, kept separate from VARIANTS so only one text
 * colour class is ever emitted. NativeWind resolves conflicting utilities by
 * stylesheet order, not className order.
 */
const VARIANT_TONE: Record<Variant, NonNullable<TextProps['tone']>> = {
  display: 'strong',
  titleLg: 'strong',
  greeting: 'strong',
  title: 'strong',
  button: 'default',
  section: 'secondary',
  label: 'secondary',
  navItem: 'default',
  body: 'default',
  bodyMedium: 'default',
  tagline: 'brand',
  lead: 'default',
  chat: 'default',
  caption: 'secondary',
  micro: 'tertiary',
};

export type TextProps = RNTextProps & {
  variant?: Variant;
  className?: string;
  /** Centre without reaching for a wrapper View. */
  center?: boolean;
  /** Semantic tone. Use for validation and status copy, not for emphasis. */
  tone?:
    | 'default'
    | 'secondary'
    | 'tertiary'
    | 'disabled'
    | 'placeholder'
    | 'strong'
    | 'accent'
    /** Brand violet: wordmark, subtitle, benefit icons. */
    | 'brand'
    /**
     * Functional purple (#9970C7), 3.59:1 on the canvas: passes for UI components
     * and large text, not body copy. Use for labels, glyphs and states only.
     */
    | 'purple'
    | 'success'
    | 'warning'
    | 'error'
    | 'info';
};

const TONES: Record<NonNullable<TextProps['tone']>, string> = {
  default: 'text-ink',
  secondary: 'text-ink-secondary',
  tertiary: 'text-ink-tertiary',
  strong: 'text-ink-strong',
  disabled: 'text-ink-disabled',
  placeholder: 'text-ink-placeholder',
  accent: 'text-accent-strong',
  brand: 'text-brand-violet',
  purple: 'text-brand-purple-fn',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
};

export function Text({
  variant = 'body',
  tone,
  center,
  className,
  ...rest
}: TextProps) {
  return (
    <RNText
      className={cx(
        VARIANTS[variant],
        TONES[tone ?? VARIANT_TONE[variant]],
        center && 'text-center',
        className,
      )}
      {...rest}
    />
  );
}

/** Named shorthands, so screens read like the design. */
export const Title = (p: Omit<TextProps, 'variant'>) => <Text variant="titleLg" {...p} />;
export const SectionTitle = (p: Omit<TextProps, 'variant'>) => <Text variant="title" {...p} />;
export const Greeting = (p: Omit<TextProps, 'variant'>) => <Text variant="greeting" {...p} />;
export const Label = (p: Omit<TextProps, 'variant'>) => <Text variant="label" {...p} />;
export const Body = (p: Omit<TextProps, 'variant'>) => <Text variant="body" {...p} />;
export const Caption = (p: Omit<TextProps, 'variant'>) => <Text variant="caption" {...p} />;
export const Lead = (p: Omit<TextProps, 'variant'>) => <Text variant="lead" {...p} />;
export const Micro = (p: Omit<TextProps, 'variant'>) => <Text variant="micro" {...p} />;
