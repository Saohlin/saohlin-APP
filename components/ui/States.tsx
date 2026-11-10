import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, View } from 'react-native';

import { useT } from '../../i18n';
import { useTheme } from '../../theme';
import { LiquidButton } from './LiquidButton';
import { SecondaryButton, TextButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { cx } from './cx';

/**
 * Shared screen states: loading, empty, error with retry, offline, update
 * required, maintenance, and the daily limit (which is not an error).
 * Copy: say what happened and what to do. Default strings are drafts.
 */

function Frame({
  icon,
  title,
  message,
  children,
  compact,
  className,
}: {
  icon?: IconName | null;
  title: string;
  message?: string;
  children?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="summary"
      className={cx('w-full items-center justify-center gap-sm', compact ? 'py-lg' : 'flex-1 py-xl', className)}>
      {icon ? (
        <View className="mb-xxs h-[52px] w-[52px] items-center justify-center rounded-pill border border-edge bg-glass/glass-soft">
          <Icon name={icon} size={22} color={colors.textTertiary} />
        </View>
      ) : null}
      <Text variant="title" center>
        {title}
      </Text>
      {message ? (
        <Text variant="caption" center className="max-w-[280px]">
          {message}
        </Text>
      ) : null}
      {children ? <View className="w-full items-center gap-xs pt-xs">{children}</View> : null}
    </View>
  );
}

/** Nothing here yet, and that is normal. Never dress this as a failure. */
export function EmptyState({
  icon = 'journal',
  title,
  message,
  actionLabel,
  onAction,
  compact,
  className,
}: {
  /** Pass `null` for no icon. */
  icon?: IconName | null;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Frame icon={icon} title={title} message={message} compact={compact} className={className}>
      {actionLabel ? <LiquidButton title={actionLabel} onPress={onAction} /> : null}
    </Frame>
  );
}

/** Something failed and retrying is the fix. */
export function ErrorState({
  title,
  message,
  onRetry,
  onSecondary,
  secondaryLabel,
  compact,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  onSecondary?: () => void;
  secondaryLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <Frame
      icon="alert"
      title={title ?? t('states.errorTitle')}
      message={message ?? t('states.errorMessage')}
      compact={compact}
      className={className}>
      {onRetry ? <SecondaryButton title={t('common.tryAgain')} icon="refresh" onPress={onRetry} /> : null}
      {onSecondary ? (
        <TextButton title={secondaryLabel ?? t('nav.writeToMe')} onPress={onSecondary} className="self-center" />
      ) : null}
    </Frame>
  );
}

/** Distinct from ErrorState: the fix is the user's connection, not a retry. */
export function OfflineState({
  onRetry,
  compact,
  className,
}: {
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <Frame
      icon="wifi-off"
      title={t('states.offlineTitle')}
      message={t('states.offlineMessage')}
      compact={compact}
      className={className}>
      {onRetry ? <SecondaryButton title={t('common.tryAgain')} icon="refresh" onPress={onRetry} /> : null}
    </Frame>
  );
}

/** Full-screen, blocking. The store link is the only way forward. */
export function UpdateRequiredState({ onUpdate, className }: { onUpdate?: () => void; className?: string }) {
  const t = useT();
  return (
    <Frame icon="download" title={t('states.updateTitle')} message={t('states.updateMessage')} className={className}>
      <LiquidButton title={t('states.update')} onPress={onUpdate} />
    </Frame>
  );
}

/** Planned downtime. Give a time if there is one — silence reads as broken. */
export function MaintenanceState({ until, className }: { until?: string; className?: string }) {
  const t = useT();
  return (
    <Frame
      icon="clock"
      title={t('states.maintenanceTitle')}
      message={until ? t('states.maintenanceUntil', { until }) : t('states.maintenanceMessage')}
      className={className}
    />
  );
}

const LAUNCH_LOGO = require('../../assets/brand/launch-logo.png');
const LAUNCH_LOGO_ASPECT = 6052 / 1376;
/** Same width as the native splash (`imageWidth` in app.json), so the hand-off doesn't jump. */
const LAUNCH_LOGO_WIDTH = 190;
const BREATH_MS = 1200;

/** The launch logo, breathing: scales and fades gently until the wait is over. */
function LogoLoader({ label }: { label: string }) {
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: BREATH_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: BREATH_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);

  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} className="w-full flex-1 items-center justify-center">
      <Animated.Image
        source={LAUNCH_LOGO}
        resizeMode="contain"
        style={{
          width: LAUNCH_LOGO_WIDTH,
          height: LAUNCH_LOGO_WIDTH / LAUNCH_LOGO_ASPECT,
          opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
          transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
        }}
      />
    </View>
  );
}

/**
 * Use only when the shape of the result is unknown; otherwise use a Skeleton.
 *
 * A full-screen wait (session restore, auth hand-offs) shows the breathing
 * logo. A wait inside a screen passes `spinner`, `compact` or a `label` and
 * gets the small indicator instead.
 */
export function LoadingState({
  label,
  compact,
  spinner,
  className,
}: {
  label?: string;
  compact?: boolean;
  /** Keep the small indicator even at full height, for waits inside a screen. */
  spinner?: boolean;
  className?: string;
}) {
  const { colors } = useTheme();
  const t = useT();
  if (!label && !compact && !spinner) return <LogoLoader label={t('common.loading')} />;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('common.loading')}
      className={cx('w-full items-center justify-center gap-sm', compact ? 'py-lg' : 'flex-1', className)}>
      <ActivityIndicator color={colors.accent} />
      {label ? (
        <Text variant="caption" center>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Daily fair-use limit. Warm tone, no error styling. */
export function LimitReachedState({
  message,
  onSecondary,
  className,
}: {
  message?: string;
  onSecondary?: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <Frame
      icon="heart"
      title={t('states.limitTitle')}
      message={message ?? t('states.limitMessage')}
      className={className}>
      {onSecondary ? <TextButton title={t('common.back')} onPress={onSecondary} className="self-center" /> : null}
    </Frame>
  );
}
