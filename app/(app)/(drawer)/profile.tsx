import { useRouter } from 'expo-router';

import { useSession } from '../../../auth';
import { GlassCard, ListRow, Screen, Text, Title, TopBar } from '../../../components/ui';
import { useI18n } from '../../../i18n';

export default function ProfileTab() {
  const { t } = useI18n();
  const { profile } = useSession();
  const router = useRouter();

  return (
    <Screen scroll>
      <TopBar menu />

      <Title center className="pt-sm">
        {t('profile.title')}
      </Title>

      <GlassCard className="mt-lg">
        <Text variant="label" tone="secondary">
          {t('onboarding.howToAddress')}
        </Text>
        <Text variant="body" className="pt-xxs">
          {profile?.displayName ?? '-'}
        </Text>
      </GlassCard>

      <ListRow icon="edit" title={t('profile.edit')} onPress={() => {}} />
      {/* Users can review and clear what the AI remembers. */}
      <ListRow icon="clock" title={t('profile.memoryTitle')} onPress={() => {}} />
      <ListRow icon="settings" title={t('settings.title')} onPress={() => router.push('/settings')} />
    </Screen>
  );
}
