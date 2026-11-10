import { View } from 'react-native';

import { Text } from './Text';
import { cx } from './cx';
import { useI18n } from '../../i18n';

/** Onboarding part 2, and any short bounded sequence. */
export function StepDots({
  total,
  current,
  className,
}: {
  total: number;
  current: number;
  className?: string;
}) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
      className={cx('w-full flex-row items-center justify-center gap-xxs', className)}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          className={cx(
            'h-[5px] rounded-pill',
            i === current ? 'w-[16px] bg-accent' : 'w-[5px] bg-accent/30',
          )}
        />
      ))}
    </View>
  );
}

/** The intro video, and anything with a real percentage. */
export function ProgressBar({
  value,
  className,
  label,
}: {
  /** 0–1 */
  value: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      className={cx('h-[3px] w-full overflow-hidden rounded-pill bg-accent/20', className)}>
      <View className="h-full rounded-pill bg-accent" style={{ width: `${pct * 100}%` }} />
    </View>
  );
}

/** Segmented stepper: one short bar per step. */
export function StepBar({
  total,
  current,
  className,
}: {
  total: number;
  /** 0-based. */
  current: number;
  className?: string;
}) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
      className={cx('w-full flex-row gap-xs', className)}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          className={cx(
            'h-[3px] flex-1 rounded-pill',
            i <= current ? 'bg-accent' : 'bg-accent/20',
          )}
        />
      ))}
    </View>
  );
}

/**
 * Free replies left. The counter itself lives on the server and is
 * incremented before the AI call; this only displays it.
 */
export function TrialCounter({
  remaining,
  total,
  onPress,
  className,
}: {
  remaining: number;
  total: number;
  onPress?: () => void;
  className?: string;
}) {
  const { t, tp } = useI18n();
  const last = remaining === 1;
  const summary = tp('trial.remaining', remaining, { total });
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={summary}
      className={cx(
        'flex-row items-center gap-xs self-center rounded-pill border px-sm py-xxs',
        last ? 'border-warning-edge bg-warning-bg' : 'border-edge bg-glass/glass-soft',
        className,
      )}>
      <Text variant="micro" tone={last ? 'warning' : 'tertiary'}>
        {last ? t('trial.lastOne') : summary}
      </Text>
    </View>
  );
}
