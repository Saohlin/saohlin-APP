import { useState } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useTheme } from '../../theme';
import { fonts, type } from '../../theme/typography';
import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { cx } from './cx';
import { useT } from '../../i18n';

type FieldShell = {
  label?: string;
  /** Shown under the field in normal state. Replaced by `error` when set. */
  hint?: string;
  /** Any non-empty string puts the field in its error state. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

function Shell({
  label,
  hint,
  error,
  required,
  children,
  className,
}: FieldShell & { children: React.ReactNode }) {
  return (
    <View className={cx('w-full gap-xxs', className)}>
      {label ? (
        <Text variant="label" tone={error ? 'error' : 'default'}>
          {label}
          {required ? ' *' : ''}
        </Text>
      ) : null}
      {children}
      {error ? (
        <View className="flex-row items-center gap-xxs pt-xxs">
          <Icon name="alert" size={12} />
          <Text variant="micro" tone="error">
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="micro" tone="tertiary" className="pt-xxs">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Input edge uses borderInput (3:1 against the background); errors use the semantic edge. */
const box = (state: { error?: boolean; focused?: boolean; disabled?: boolean }) =>
  cx(
    'w-full rounded-input border px-md',
    state.disabled
      ? 'border-disabled-edge bg-disabled-bg'
      : state.error
        ? 'border-error-edge bg-error-bg/40'
        : state.focused
          ? 'border-edge-focus bg-glass/glass'
          : 'border-edge-input bg-glass/glass',
  );

/**
 * Single-line input type set here rather than via `text-body`: a line height
 * pushes the glyph below centre in RN inputs. The rest are the usual Android
 * centring fixes (font padding, vertical padding, textAlignVertical).
 */
const INPUT_TYPE = {
  fontFamily: fonts.body,
  fontSize: type.body.fontSize,
  includeFontPadding: false,
  paddingVertical: 0,
  textAlignVertical: 'center' as const,
};

export type TextFieldProps = FieldShell &
  Omit<TextInputProps, 'className'> & {
    /** Adds a reveal control and starts obscured. */
    password?: boolean;
    leading?: IconName;
    trailing?: IconName;
    onTrailingPress?: () => void;
  };

export function TextField({
  label,
  hint,
  error,
  required,
  disabled,
  password,
  leading,
  trailing,
  onTrailingPress,
  className,
  ...input
}: TextFieldProps) {
  const { colors } = useTheme();
  const t = useT();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!password);

  return (
    <Shell label={label} hint={hint} error={error} required={required} className={className}>
      <View className={cx(box({ error: !!error, focused, disabled }), 'h-[64px] flex-row items-center gap-xs')}>
        {leading ? <Icon name={leading} size={17} /> : null}
        <TextInput
          editable={!disabled}
          secureTextEntry={hidden}
          placeholderTextColor={colors.textPlaceholder}
          selectionColor={colors.accent}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          className="flex-1 text-ink"
          {...input}
          style={[INPUT_TYPE, input.style]}
        />
        {password ? (
          <IconButton
            variant="plain"
            size={28}
            iconSize={17}
            name={hidden ? 'eye' : 'eye-off'}
            label={t(hidden ? 'auth.showPassword' : 'auth.hidePassword')}
            onPress={() => setHidden((h) => !h)}
          />
        ) : trailing ? (
          <IconButton
            variant="plain"
            size={28}
            iconSize={17}
            name={trailing}
            label={t('a11y.action')}
            onPress={onTrailingPress}
          />
        ) : null}
      </View>
    </Shell>
  );
}

/** Journal entries and the four onboarding answers. */
export function TextArea({
  label,
  hint,
  error,
  required,
  disabled,
  className,
  minHeight = 124,
  bare,
  grow,
  ...input
}: TextFieldProps & {
  minHeight?: number;
  bare?: boolean;
  /** Grow into the parent's height. The grow is applied to the box itself, not just the shell. */
  grow?: boolean;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Shell label={label} hint={hint} error={error} required={required} className={className}>
      {/* `bare` drops the field's own box when a surrounding card already acts as the input. */}
      <View
        className={cx(
          bare ? 'w-full' : box({ error: !!error, focused, disabled }),
          'py-sm',
          grow && 'flex-1',
        )}
        style={{ minHeight }}>
        <TextInput
          multiline
          editable={!disabled}
          textAlignVertical="top"
          placeholderTextColor={colors.textPlaceholder}
          selectionColor={colors.accent}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          className="flex-1 font-sans text-body text-ink"
          style={grow ? undefined : { minHeight: minHeight - 24 }}
          {...input}
        />
      </View>
    </Shell>
  );
}

/** Opens a sheet or picker. Never a native dropdown — it breaks the surface. */
export function SelectField({
  label,
  hint,
  error,
  required,
  disabled,
  value,
  placeholder,
  onPress,
  className,
}: FieldShell & { value?: string; placeholder?: string; onPress?: () => void }) {
  const t = useT();
  const empty = placeholder ?? t('onboarding.genderPlaceholder');
  return (
    <Shell label={label} hint={hint} error={error} required={required} className={className}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ?? placeholder }}
        disabled={disabled}
        onPress={onPress}
        className={cx(box({ error: !!error, disabled }), 'h-[64px] flex-row items-center justify-between active:opacity-90')}>
        <Text variant="body" tone={value ? 'default' : 'placeholder'}>
          {value ?? empty}
        </Text>
        <Icon name="chevron-down" size={17} />
      </Pressable>
    </Shell>
  );
}

/** Date of birth. Shows the format so nobody has to guess DD or MM first. */
export function DateField(props: Omit<Parameters<typeof SelectField>[0], 'placeholder'> & { placeholder?: string }) {
  const t = useT();
  return (
    <Shell label={props.label} hint={props.hint} error={props.error} required={props.required} className={props.className}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label}
        disabled={props.disabled}
        onPress={props.onPress}
        className={cx(box({ error: !!props.error, disabled: props.disabled }), 'h-[64px] flex-row items-center justify-between active:opacity-90')}>
        <Text variant="body" tone={props.value ? 'default' : 'placeholder'}>
          {props.value ?? (props.placeholder ?? t('onboarding.dateFormat'))}
        </Text>
        <Icon name="calendar" size={17} />
      </Pressable>
    </Shell>
  );
}

export function SearchField({
  className,
  ...input
}: Omit<TextInputProps, 'className'> & { className?: string }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View className={cx('h-[46px] w-full flex-row items-center gap-xs rounded-pill border border-edge bg-glass/glass px-md', className)}>
      <Icon name="search" size={17} />
      <TextInput
        placeholder={t('common.search')}
        placeholderTextColor={colors.textPlaceholder}
        selectionColor={colors.accent}
        accessibilityLabel={t('a11y.search')}
        className="flex-1 text-ink"
        {...input}
        style={[INPUT_TYPE, input.style]}
      />
    </View>
  );
}
