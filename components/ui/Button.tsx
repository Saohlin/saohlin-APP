import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { MIN_TAP } from '../../theme/layout';
import { useTheme } from '../../theme';
import { GlassFill } from './LiquidSurface';
import { Icon, type IconName, type IconProps } from './Icon';
import { Text } from './Text';
import { cx } from './cx';
import { useT } from '../../i18n';

type Common = {
  title: string;
  onPress?: PressableProps['onPress'];
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  className?: string;
  haptic?: boolean;
};

const useTap = (onPress: PressableProps['onPress'], haptic?: boolean) =>
  useCallback<NonNullable<PressableProps['onPress']>>(
    (e) => {
      if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress?.(e);
    },
    [onPress, haptic],
  );

/**
 * Secondary action: glass in the soft tint. The iridescent capsule is reserved
 * for the single primary CTA on a screen.
 */
export function SecondaryButton({
  title,
  onPress,
  disabled,
  loading,
  icon,
  trailingIcon,
  compact,
  className,
  haptic = true,
}: Common & {
  /** Decorative glyph at the right end; part of the button's own tap target. */
  trailingIcon?: IconName;
  /** Compact variant for use inside a card: shorter capsule, `label` type. */
  compact?: boolean;
}) {
  const t = useT();
  const { colors } = useTheme();
  const tap = useTap(onPress, haptic);
  const off = disabled || loading;
  const h = compact ? 32 : 52;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={tap}
      style={{ height: h }}
      className={cx(
        'flex-row items-center justify-center gap-xs overflow-hidden rounded-pill',
        trailingIcon ? 'px-sm' : compact ? 'px-md' : 'px-lg',
        off ? 'border border-disabled-edge bg-disabled-bg' : 'active:opacity-90',
        className,
      )}>
      {off ? null : <GlassFill variant="soft" />}
      {icon ? <Icon name={icon} size={compact ? 15 : 17} /> : null}
      <Text
        variant={compact ? 'label' : 'button'}
        tone={off ? 'disabled' : 'default'}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        className={trailingIcon ? 'flex-1' : undefined}>
        {loading ? t('common.loading') : title}
      </Text>
      {trailingIcon ? (
        <Icon name={trailingIcon} size={compact ? 13 : 15} color={colors.text} />
      ) : null}
    </Pressable>
  );
}

/** Tertiary, text-only action. */
export function TextButton({
  title,
  onPress,
  disabled,
  icon,
  className,
  tone = 'accent',
}: Omit<Common, 'loading' | 'haptic'> & { tone?: 'accent' | 'secondary' | 'error' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      className={cx('flex-row items-center gap-xxs self-start py-xs active:opacity-60', className)}>
      <Text variant="label" tone={disabled ? 'disabled' : tone}>
        {title}
      </Text>
      {icon ? <Icon name={icon} size={14} /> : null}
    </Pressable>
  );
}

/**
 * Every icon-only control in the app.
 *
 * `size` is the visible bead; the tap target is always at least MIN_TAP via
 * hitSlop, so a 34 pt bead is still a 44 pt target.
 */
export type IconButtonVariant = 'glass' | 'accent' | 'plain';

export function IconButton({
  name,
  onPress,
  label,
  disabled,
  size = 40,
  variant = 'accent',
  iconSize,
  iconColor,
  iconWeight,
  dimWhenDisabled = true,
  className,
}: {
  name: IconName;
  /** Required: an icon with no label is invisible to a screen reader. */
  label: string;
  onPress?: PressableProps['onPress'];
  disabled?: boolean;
  size?: number;
  /**
   * `accent`: flat violet disc with a white glyph (default).
   * `glass`: the pale glass bead (currently unused, kept as an option).
   * `plain`: bare glyph, for controls that sit inside another surface.
   */
  variant?: IconButtonVariant;
  /** Overrides the glyph size. The default is a ratio of `size`. */
  iconSize?: number;
  /** Overrides the glyph colour, e.g. a banner's dismiss taking the banner's tone. */
  iconColor?: string;
  /** Overrides the glyph weight; per-variant defaults are usually right. */
  iconWeight?: IconProps['weight'];
  /**
   * Whether `disabled` also dims the control (default true). The composer's send
   * keeps its colour when disabled; `accessibilityState` still reports it.
   */
  dimWhenDisabled?: boolean;
  className?: string;
}) {
  const { colors, shadow } = useTheme();
  // A bead sits ON the surface, so it casts. A bare glyph is ink on it.
  const bead = variant !== 'plain';
  // A bare glyph has no bead behind it, so it's drawn larger and at regular weight.
  const glyph = iconSize ?? Math.round(size * (bead ? 0.45 : 0.6));
  const slop = Math.max(8, Math.ceil((MIN_TAP - size) / 2));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={slop}
      style={[{ width: size, height: size }, bead ? shadow.xs : null]}
      className={cx(
        'items-center justify-center overflow-hidden rounded-pill active:opacity-80',
        disabled && dimWhenDisabled && 'opacity-45',
        className,
      )}>
      {variant === 'accent' ? (
        /* Flat disc rather than the violet glass material, whose inner strokes read
           as a double border at bead sizes. */
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent }]} />
      ) : bead ? (
        <GlassFill variant="soft" radius={size / 2} />
      ) : null}
      {/* Weight by variant: white on violet needs `bold` to stay legible at small sizes. */}
      <Icon
        name={name}
        size={glyph}
        weight={iconWeight ?? (variant === 'accent' ? 'bold' : bead ? 'light' : 'regular')}
        color={iconColor ?? (variant === 'accent' ? colors.accentOn : colors.text)}
      />
    </Pressable>
  );
}

/**
 * Single- or multi-select option. Deliberately a flat panel rather than glass:
 * a chip is content you pick, not a control that acts.
 */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  className,
}: {
  label: string;
  selected?: boolean;
  onPress?: PressableProps['onPress'];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cx(
        'w-full items-center rounded-input border px-md py-field active:opacity-90',
        selected ? 'border-edge-focus bg-selected' : 'border-edge bg-glass/glass-soft',
        disabled && 'opacity-45',
        className,
      )}>
      <Text variant="label" tone={selected ? 'default' : 'secondary'} center>
        {label}
      </Text>
    </Pressable>
  );
}

/** A row of chips or buttons that should share one baseline. */
export function ButtonRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <View className={cx('flex-row items-center gap-xs', className)}>{children}</View>;
}
