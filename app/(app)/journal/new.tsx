import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  GlassCard,
  LiquidButton,
  Screen,
  Switch,
  Text,
  TextArea,
  TopBar,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';

/**
 * New journal entry. Entries are private by default; the share toggle is the
 * only way an entry can reach the AI. Saving is not wired up yet.
 */
export default function NewJournalEntry() {
  const { t } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [share, setShare] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSave = body.trim().length > 0;

  return (
    <Screen
      avoidKeyboard
      footer={
        <LiquidButton
          title={t('common.save')}
          onPress={() => {
            if (!canSave) {
              setSubmitted(true);
              return;
            }
            router.back();
          }}
        />
      }>
      <TopBar onBack={() => router.back()} />

      <Text variant="title" center className="pt-xs">
        {t('journal.newEntry')}
      </Text>

      {/* The card is the field, the same construction as the four onboarding
          questions and the feedback screen. */}
      <GlassCard className="mt-lg flex-1" padding="flex-1 px-md py-sm">
        <TextArea
          bare
          grow
          value={body}
          onChangeText={setBody}
          error={submitted && !canSave ? t('journal.entryRequired') : undefined}
          placeholder={t('journal.entryPlaceholder')}
          autoFocus
          className="flex-1"
        />
      </GlassCard>

      <Switch
        value={share}
        onChange={setShare}
        label={t('journal.shareWithAi')}
        description={t('journal.shareHint')}
        className="mt-xs"
      />
    </Screen>
  );
}
