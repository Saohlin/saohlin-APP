import { Pressable } from 'react-native';

import { useT } from '../../i18n';
import { useTheme } from '../../theme';
import { Icon, Text } from '../ui';

/**
 * The marker in a conversation that was opened on a shared journal entry.
 * It carries no text of the entry: the chat screen never holds journal text,
 * the server reads the entry itself.
 */
export function SharedEntryCard({ onPress }: { onPress?: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('journal.sharedCard')}
      accessibilityHint={onPress ? t('journal.openEntry') : undefined}
      disabled={!onPress}
      onPress={onPress}
      className="flex-row items-center gap-xs self-center rounded-pill border border-edge bg-glass/glass-soft px-md py-xs active:opacity-70">
      <Icon name="journal" size={15} color={colors.accent} />
      <Text variant="label" tone="secondary">
        {t('journal.sharedCard')}
      </Text>
      {onPress ? <Icon name="chevron-right" size={13} /> : null}
    </Pressable>
  );
}
