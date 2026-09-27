import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Pressable, View, type ViewProps } from 'react-native';

import { cardGlow, radius } from '../../theme';
import { useTheme } from '../../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { cx } from './cx';
import { SHEEN, SHEEN_STOPS } from './glass';

/**
 * Glass card: a light gradient fill, an accent edge at 80% alpha (so the
 * background tints it), and an inset white lip that gives the edge thickness.
 */
export function GlassCard({
  className,
  elevated = true,
  padding,
  children,
  ...rest
}: ViewProps & {
  className?: string;
  elevated?: boolean;
  /**
   * Classes for the inner box. Replaces the default padding rather than
   * overriding it: NativeWind resolves conflicting utilities by stylesheet
   * order, not className order.
   */
  padding?: string;
}) {
  const { gradients, shadow } = useTheme();
  return (
    <View
      style={elevated ? shadow.sm : undefined}
      className={cx('w-full overflow-hidden rounded-card border border-accent/80', className)}
      {...rest}>
      {/* Gradient and lit top edge, shared with the chat bubble. Absolute, so they don't affect size. */}
      <LinearGradient
        colors={gradients.cardGlass as [string, string, ...string[]]}
        locations={gradients.bubbleStops as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={SHEEN as unknown as [string, string, ...string[]]}
        locations={SHEEN_STOPS as unknown as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Inset white glow on its own layer (the card already carries an outer shadow).
         Inset boxShadow needs RN 0.76+ / New Architecture. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius.card,
            boxShadow: [
              { offsetX: 0, offsetY: 0, blurRadius: cardGlow.blur, color: cardGlow.color, inset: true },
            ],
          },
        ]}
      />
      <View className={padding ?? 'p-md'}>{children}</View>
    </View>
  );
}

/** Settings, the drawer, the legal group. */
export function ListRow({
  title,
  subtitle,
  icon,
  value,
  onPress,
  destructive,
  disabled,
  showChevron = true,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
  className?: string;
}) {
  const { colors } = useTheme();
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cx(
        'w-full flex-row items-center gap-sm py-sm',
        onPress && 'active:opacity-70',
        disabled && 'opacity-45',
        className,
      )}>
      {icon ? (
        <Icon name={icon} size={19} color={destructive ? colors.errorFg : colors.textSecondary} />
      ) : null}
      <View className="flex-1 gap-xxs">
        <Text variant="body" tone={destructive ? 'error' : 'default'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="micro" tone="tertiary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" tone="tertiary">
          {value}
        </Text>
      ) : null}
      {onPress && showChevron ? <Icon name="chevron-right" size={17} /> : null}
    </Wrapper>
  );
}

export function SectionHeader({
  title,
  action,
  onActionPress,
  className,
}: {
  title: string;
  action?: string;
  onActionPress?: () => void;
  className?: string;
}) {
  const { colors } = useTheme();
  return (
    <View className={cx('w-full flex-row items-center justify-between pb-xs pt-md', className)}>
      <Text variant="section" tone="secondary">
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onActionPress}
          className="flex-row items-center gap-xxs active:opacity-70">
          <Text variant="section" tone="accent">
            {action}
          </Text>
          <Icon name="chevron-right" size={13} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Softer glass surface used on the journal screen. Classes live here so the
 * pressable row and the plain card can't drift apart.
 */
const SOFT_SURFACE =
  'w-full overflow-hidden rounded-card border border-edge bg-glass/glass-soft';

/** `SOFT_SURFACE` as a container. The non-pressable half of `JournalRow`. */
export function SoftCard({
  className,
  padding,
  children,
  ...rest
}: ViewProps & { className?: string; padding?: string }) {
  const { gradients, shadow } = useTheme();
  return (
    <View style={shadow.sm} className={cx(SOFT_SURFACE, className)} {...rest}>
      <LinearGradient
        colors={gradients.bubble as [string, string, ...string[]]}
        locations={gradients.bubbleStops as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={SHEEN as unknown as [string, string, ...string[]]}
        locations={SHEEN_STOPS as unknown as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View className={padding ?? 'p-md'}>{children}</View>
    </View>
  );
}

export function JournalRow({
  date,
  excerpt,
  time,
  locked = true,
  onPress,
  className,
}: {
  date: string;
  excerpt: string;
  time?: string;
  locked?: boolean;
  onPress?: () => void;
  className?: string;
}) {
  const { colors, gradients, shadow } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${date}. ${excerpt}`}
      onPress={onPress}
      style={shadow.sm}
      className={cx(SOFT_SURFACE, 'flex-row items-center gap-sm px-sm py-xs active:opacity-85', className)}>
      {/* Absolute, so they sit under the row without joining it. */}
      <LinearGradient
        colors={gradients.bubble as [string, string, ...string[]]}
        locations={gradients.bubbleStops as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={SHEEN as unknown as [string, string, ...string[]]}
        locations={SHEEN_STOPS as unknown as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View className="flex-1 gap-xxs">
        <Text variant="micro" tone="tertiary">
          {date}
        </Text>
        {/* Smaller line height so the rows fit above the CTA. */}
        <Text variant="caption" numberOfLines={2} className="leading-[17px]">
          {excerpt}
        </Text>
      </View>
      {locked ? <Icon name="lock" size={15} color={colors.accent} /> : null}
      {time ? (
        <Text variant="micro" tone="tertiary">
          {time}
        </Text>
      ) : null}
      <Icon name="chevron-right" size={15} />
    </Pressable>
  );
}
