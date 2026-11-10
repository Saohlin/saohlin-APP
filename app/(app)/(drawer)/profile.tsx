import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useSession } from '../../../auth';
import {
  GlassCard,
  Icon,
  LiquidButton,
  Screen,
  SectionHeader,
  SoftCard,
  Text,
  TopBar,
  cx,
  type IconName,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import type { Dictionary, Path } from '../../../i18n';
import { fonts, useTheme } from '../../../theme';

/** Same compact pill as "Zapsat myšlenky" on the journal screen. */
const ACTION_H = 36;

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

/** One line of the profile: a glyph, a small display-font label, and the value on the right. */
function DetailRow({ icon, label, value, muted }: { icon: IconName; label: string; value: string; muted?: boolean }) {
  const { colors } = useTheme();
  return (
    <SoftCard padding="flex-row items-center gap-sm px-md py-md" accessible accessibilityLabel={`${label}: ${value}`}>
      <View className="h-[36px] w-[36px] items-center justify-center rounded-pill border border-edge bg-glass/glass-soft">
        <Icon name={icon} size={17} color={colors.accent} />
      </View>
      <Text variant="label" tone="tertiary" numberOfLines={1} className="flex-1">
        {label}
      </Text>
      <Text variant="chat" tone={muted ? 'tertiary' : 'secondary'} numberOfLines={1}>
        {value}
      </Text>
    </SoftCard>
  );
}

/**
 * Profile. A full screen rather than a card at the top: who you are (name and
 * membership) in a hero card, then one row per thing we know (date of birth,
 * zodiac sign, gender), the membership state, and the edit button pinned below.
 */
export default function ProfileTab() {
  const { t } = useI18n();
  const { profile, entitlement } = useSession();
  const { colors } = useTheme();
  const router = useRouter();

  const name = profile?.displayName?.trim() || '-';
  const missing = t('profile.notAnswered');
  const dob = profile?.dateOfBirth ? displayDob(profile.dateOfBirth) : null;
  const zodiac = profile?.zodiac ? t(`zodiac.${profile.zodiac}` as Path<Dictionary>) : null;
  const gender = profile?.gender && profile.gender !== 'unspecified' ? t(GENDER_LABEL[profile.gender]) : null;

  const member = entitlement.active;
  const renews = member && entitlement.renewsAt ? displayDob(entitlement.renewsAt.slice(0, 10)) : null;

  return (
    <Screen
      scroll
      header={
        // Edit lives in the bar, opposite the back button, as the same purple bead.
        <TopBar
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/chat'))}
          action="edit"
          actionLabel={t('profile.edit')}
          onActionPress={() => router.push('/profile/edit')}
        />
      }>
      <Text variant="title" center className="pt-xs">
        {t('profile.title')}
      </Text>
      <Text variant="caption" center className="self-center pt-xs max-w-[260px]">
        {t('profile.subtitle')}
      </Text>

      {/* Hero: the person. Initial in a glass bead, the name as typed, membership as a pill. */}
      <GlassCard className="mt-lg" padding="items-center gap-sm px-md py-xl">
        <View className="h-[72px] w-[72px] items-center justify-center rounded-pill border border-edge bg-glass/glass">
          <Text variant="titleLg" tone="accent">
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
        {/* `greeting` keeps the name as typed (`title` would uppercase it). */}
        <Text variant="greeting" center numberOfLines={2}>
          {name}
        </Text>
        <View
          className={cx(
            'flex-row items-center gap-xxs rounded-pill px-sm py-xxs',
            member ? 'bg-accent' : 'border border-edge bg-glass/glass-soft',
          )}>
          <Icon name={member ? 'star' : 'lock'} size={12} color={member ? colors.textOnAccent : colors.textSecondary} />
          <Text variant="label" style={{ color: member ? colors.textOnAccent : colors.textSecondary }}>
            {t(member ? 'membership.statusActive' : 'membership.statusNone')}
          </Text>
        </View>
      </GlassCard>

      <SectionHeader title={t('profile.memoryBasics')} className="pt-lg" />
      <View className="gap-xs">
        <DetailRow icon="calendar" label={t('onboarding.dateOfBirth')} value={dob ?? missing} muted={!dob} />
        <DetailRow icon="star" label={t('profile.zodiac')} value={zodiac ?? missing} muted={!zodiac} />
        <DetailRow icon="profile" label={t('onboarding.gender')} value={gender ?? missing} muted={!gender} />
      </View>

      {/* Subscription: where things stand, and the one thing to do about it. */}
      <SectionHeader title={t('membership.title')} className="pt-lg" />
      <GlassCard padding="gap-sm px-md py-md">
        <View className="flex-row items-center gap-sm">
          <View className="h-[36px] w-[36px] items-center justify-center rounded-pill border border-edge bg-glass/glass-soft">
            <Icon name={member ? 'star' : 'gift'} size={17} color={colors.accent} />
          </View>
          <View className="flex-1 gap-xxs">
            {/* Not a status when there is no membership: an invitation. */}
            {member ? (
              <Text variant="bodyMedium">{t('membership.statusActive')}</Text>
            ) : (
              // One line. The word marked with asterisks in the string carries the weight.
              <Text variant="bodyMedium" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                {t('membership.invite')
                  .split('*')
                  .map((part, i) =>
                    i % 2 ? (
                      <Text key={i} variant="bodyMedium" tone="accent" style={{ fontFamily: fonts.bodySemibold }}>
                        {part.toUpperCase()}
                      </Text>
                    ) : (
                      part
                    ),
                  )}
              </Text>
            )}
            <Text variant="caption" tone="secondary">
              {member
                ? renews
                  ? t('membership.renewsOn', { date: renews })
                  : t('membership.noCommitment')
                : t('membership.trialLeft', {
                    remaining: String(Math.max(0, entitlement.trialRemaining)),
                    total: String(entitlement.trialTotal),
                  })}
            </Text>
          </View>
        </View>
        {/* On its own line under the text, across the full width of the card. */}
        {member ? null : (
          <LiquidButton height={ACTION_H} title={t('membership.getStarted')} onPress={() => router.push('/paywall')} />
        )}
      </GlassCard>

      {/* The "More" section is switched off for now; `profile.more` is kept for it.
      <SectionHeader title={t('profile.more')} className="pt-lg" />
      <LinkRow icon="clock" title={t('profile.memoryTitle')} onPress={() => router.push('/profile/memory')} />
      <LinkRow icon="settings" title={t('settings.title')} onPress={() => router.push('/settings')} />
      */}
    </Screen>
  );
}
