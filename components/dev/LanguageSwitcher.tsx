import { Pressable, View } from 'react-native';

import { LANGUAGES, useI18n } from '../../i18n';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { cx } from '../ui/cx';

// Dev-only language toggle. Renders nothing in production builds.
export function LanguageSwitcher({
  className,
  floating = false,
}: {
  className?: string;
  floating?: boolean;
}) {
  const { lang, setLang, canSwitchLanguage } = useI18n();
  const { shadow } = useTheme();

  if (!canSwitchLanguage) return null;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Developer language"
      style={floating ? shadow.lg : undefined}
      className={cx(
        'flex-row items-center gap-xxs rounded-pill border border-edge bg-surface p-xxs',
        floating && 'absolute right-md top-xxl z-50',
        className,
      )}>
      {LANGUAGES.map((l) => {
        const on = l.code === lang;
        return (
          <Pressable
            key={l.code}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={l.label}
            onPress={() => setLang(l.code)}
            className={cx(
              'rounded-pill px-sm py-xxs active:opacity-70',
              on ? 'bg-accent' : 'bg-transparent',
            )}>
            <Text variant="micro" className={on ? 'text-accent-on' : 'text-ink-tertiary'}>
              {l.code.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
