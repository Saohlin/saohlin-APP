import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useSession, type DeeperAnswers } from '../../../auth';
import { GlassCard, LiquidButton, Screen, SectionHeader, Text, Title, TopBar } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import type { Dictionary, Path } from '../../../i18n';

const ANSWERS: Array<{ key: keyof DeeperAnswers; label: Path<Dictionary> }> = [
  { key: 'work', label: 'onboarding.work' },
  { key: 'situation', label: 'onboarding.situation' },
  { key: 'blocking', label: 'onboarding.blocking' },
  { key: 'visions', label: 'onboarding.visions' },
];

const GENDER_LABEL: Record<string, Path<Dictionary>> = {
  female: 'onboarding.genderFemale',
  male: 'onboarding.genderMale',
  other: 'onboarding.genderOther',
  unspecified: 'onboarding.genderUnspecified',
};

function displayDob(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}. ${m}. ${y}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard className="mt-sm">
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text variant="body" className="pt-xxs">
        {value}
      </Text>
    </GlassCard>
  );
}

/**
 * What the AI knows about the user: profile and onboarding answers.
 * Memories learned in conversation will be listed here once chat is built.
 */
export default function Memory() {
  const { t } = useI18n();
  const router = useRouter();
  const { profile, context } = useSession();

  return (
    <Screen
      scroll
      footer={
        <View className="pb-lg">
          <LiquidButton title={t('profile.edit')} onPress={() => router.push('/profile/edit')} />
        </View>
      }>
      <TopBar onBack={() => router.back()} />

      <Title center className="pt-sm">
        {t('profile.memoryTitle')}
      </Title>
      <Text variant="caption" tone="secondary" center className="pt-sm">
        {t('profile.memoryIntro')}
      </Text>

      <SectionHeader title={t('profile.memoryBasics')} className="pt-lg" />
      <Fact label={t('onboarding.howToAddress')} value={profile?.displayName ?? '-'} />
      <Fact label={t('profile.vocative')} value={profile?.vocative ?? '-'} />
      {profile?.dateOfBirth ? (
        <Fact label={t('onboarding.dateOfBirth')} value={displayDob(profile.dateOfBirth)} />
      ) : null}
      {profile?.zodiac ? (
        <Fact label={t('profile.zodiac')} value={t(`zodiac.${profile.zodiac}` as Path<Dictionary>)} />
      ) : null}
      {profile?.gender && profile.gender !== 'unspecified' ? (
        <Fact label={t('onboarding.gender')} value={t(GENDER_LABEL[profile.gender])} />
      ) : null}

      <SectionHeader title={t('profile.memoryAnswers')} className="pt-lg" />
      {ANSWERS.map(({ key, label }) => (
        <Fact key={key} label={t(label)} value={context[key] || t('profile.notAnswered')} />
      ))}

      <SectionHeader title={t('profile.memoryConversations')} className="pt-lg" />
      <Text variant="body" tone="secondary" className="pb-xl">
        {t('profile.memoryEmpty')}
      </Text>
    </Screen>
  );
}
