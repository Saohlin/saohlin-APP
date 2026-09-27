import { Pressable, Switch as RNSwitch, View } from 'react-native';

import { useTheme } from '../../theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { cx } from './cx';

// Consent checkbox. Starts unticked so agreeing is an explicit action.
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  error,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { colors } = useTheme();
  return (
    <View className={cx('w-full gap-xxs', className)}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !!disabled }}
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        className="w-full flex-row items-start gap-sm active:opacity-80">
        <View
          className={cx(
            'mt-[2px] h-[22px] w-[22px] items-center justify-center rounded-sm border',
            checked ? 'border-accent bg-accent' : error ? 'border-error-edge' : 'border-edge-input',
            disabled && 'opacity-45',
          )}>
          {checked ? <Icon name="check" size={14} color={colors.accentOn} /> : null}
        </View>
        <View className="flex-1 gap-xxs">
          <Text variant="caption" tone={disabled ? 'disabled' : 'default'}>
            {label}
          </Text>
          {description ? (
            <Text variant="micro" tone="tertiary">
              {description}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {error ? (
        <Text variant="micro" tone="error" className="pl-[34px]">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Switch({
  value,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { colors } = useTheme();
  return (
    <View className={cx('w-full flex-row items-center justify-between gap-md py-sm', className)}>
      <View className="flex-1 gap-xxs">
        <Text variant="body" tone={disabled ? 'disabled' : 'default'}>
          {label}
        </Text>
        {description ? (
          <Text variant="micro" tone="tertiary">
            {description}
          </Text>
        ) : null}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: colors.disabledBg, true: colors.accent }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.disabledBg}
      />
    </View>
  );
}

export function Radio({
  selected,
  onPress,
  label,
  disabled,
  className,
}: {
  selected: boolean;
  onPress: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cx('w-full flex-row items-center gap-sm py-sm active:opacity-80', className)}>
      <View
        className={cx(
          'h-[22px] w-[22px] items-center justify-center rounded-pill border',
          selected ? 'border-accent' : 'border-edge-input',
          disabled && 'opacity-45',
        )}>
        {selected ? <View className="h-[11px] w-[11px] rounded-pill bg-accent" /> : null}
      </View>
      <Text variant="body" tone={disabled ? 'disabled' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}
