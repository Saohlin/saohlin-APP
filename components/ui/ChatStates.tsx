import { Linking, View } from 'react-native';

import { useT } from '../../i18n';
import { SecondaryButton, TextButton } from './Button';
import { GlassCard } from './Card';
import { InlineMessage } from './Feedback';
import { Text } from './Text';
import { cx } from './cx';

export type CrisisLine = { name: string; phone: string; hours?: string; audience?: string };

/**
 * Screen 20: Czech crisis lines as tap-to-call. Shown after an acute crisis
 * reply, and again when that conversation is reopened. The lines come from
 * config and appear only once Claudia and the lawyer have confirmed them.
 */
export function CrisisCard({ lines, className }: { lines: CrisisLine[]; className?: string }) {
  const t = useT();
  if (!lines.length) return null;
  return (
    <GlassCard className={cx('mt-xs', className)} padding="p-md gap-sm">
      <Text variant="label" tone="purple">
        {t('chat.crisisTitle')}
      </Text>
      {lines.map((l) => (
        <View key={l.phone} className="gap-xxs">
          <Text variant="body">{l.name}</Text>
          {l.hours || l.audience ? (
            <Text variant="micro" tone="tertiary">
              {[l.hours, l.audience].filter(Boolean).join(', ')}
            </Text>
          ) : null}
          <SecondaryButton
            compact
            icon="phone"
            title={`${t('chat.call')} ${l.phone}`}
            onPress={() => void Linking.openURL(`tel:${l.phone.replace(/\s+/g, '')}`)}
          />
        </View>
      ))}
    </GlassCard>
  );
}

/** Under a user message that did not go through: what happened and a free retry. */
export function MessageFailed({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <View className={cx('items-end gap-xxs', className)}>
      <InlineMessage tone="error" message={message} />
      {onRetry ? <TextButton title={t('chat.retry')} icon="refresh" onPress={onRetry} className="self-end" /> : null}
    </View>
  );
}
