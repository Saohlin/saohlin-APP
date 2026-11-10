import { useEffect } from 'react';
import { Pressable, View } from 'react-native';

import { useT, type Dictionary, type Path } from '../../i18n';
import { useTheme } from '../../theme';
import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { cx } from './cx';

export type Tone = 'success' | 'warning' | 'error' | 'info';

const TONE: Record<Tone, { box: string; icon: IconName; label: Path<Dictionary> }> = {
  success: { box: 'border-success-edge bg-success-bg', icon: 'check', label: 'tone.success' },
  warning: { box: 'border-warning-edge bg-warning-bg', icon: 'alert', label: 'tone.warning' },
  error: { box: 'border-error-edge bg-error-bg', icon: 'alert', label: 'tone.error' },
  info: { box: 'border-info-edge bg-info-bg', icon: 'info', label: 'tone.info' },
};

const toneColor = (tone: Tone, c: ReturnType<typeof useTheme>['colors']) =>
  ({ success: c.successFg, warning: c.warningFg, error: c.errorFg, info: c.infoFg })[tone];

/**
 * Inline message for a region (failed save, grace period, notice). Field
 * validation belongs under the field instead. Limits use `warning`, not error styling.
 */
export function Banner({
  tone = 'info',
  title,
  message,
  actionLabel,
  onAction,
  onDismiss,
  className,
}: {
  tone?: Tone;
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const { colors } = useTheme();
  const t = useT();
  const style = TONE[tone];
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${t(style.label)}. ${title ? title + '. ' : ''}${message}`}
      className={cx('w-full flex-row gap-sm rounded-card border p-sm', style.box, className)}>
      <View className="pt-[2px]">
        <Icon name={style.icon} size={16} color={toneColor(tone, colors)} />
      </View>
      <View className="flex-1 gap-xxs">
        {title ? (
          <Text variant="caption" tone={tone} className="font-sans-medium">
            {title}
          </Text>
        ) : null}
        <Text variant="caption" tone={tone}>
          {message}
        </Text>
        {actionLabel ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction} className="pt-xxs">
            <Text variant="label" tone={tone}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {onDismiss ? (
        <IconButton
          variant="plain"
          size={26}
          iconSize={15}
          iconColor={toneColor(tone, colors)}
          name="close"
          label={t('a11y.close')}
          onPress={onDismiss}
        />
      ) : null}
    </View>
  );
}

/** Field-level validation. Keep it to one line and say how to fix it. */
export function InlineMessage({
  tone = 'error',
  message,
  className,
}: {
  tone?: Tone;
  message: string;
  className?: string;
}) {
  const { colors } = useTheme();
  return (
    <View className={cx('flex-row items-center gap-xxs', className)}>
      <Icon name={TONE[tone].icon} size={12} color={toneColor(tone, colors)} />
      <Text variant="micro" tone={tone}>
        {message}
      </Text>
    </View>
  );
}

/** Transient confirmation. Auto-dismisses; pass `duration={0}` to keep it. */
export function Toast({
  tone = 'success',
  message,
  visible,
  onHide,
  duration = 3000,
  className,
}: {
  tone?: Tone;
  message: string;
  visible: boolean;
  onHide: () => void;
  duration?: number;
  className?: string;
}) {
  const { colors, shadow } = useTheme();
  useEffect(() => {
    if (!visible || duration <= 0) return;
    const t = setTimeout(onHide, duration);
    return () => clearTimeout(t);
  }, [visible, duration, onHide]);

  if (!visible) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={shadow.lg}
      className={cx('w-full flex-row items-center gap-sm rounded-card border border-edge bg-surface p-sm', className)}>
      <Icon name={TONE[tone].icon} size={16} color={toneColor(tone, colors)} />
      <Text variant="caption" className="flex-1">
        {message}
      </Text>
    </View>
  );
}
