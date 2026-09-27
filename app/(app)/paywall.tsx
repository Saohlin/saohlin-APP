import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useSession } from '../../auth';
import {
  Banner,
  GlassCard,
  LiquidButton,
  Screen,
  SecondaryButton,
  Text,
  TextButton,
  Title,
} from '../../components/ui';
import { useI18n } from '../../i18n';

/**
 * Paywall, shown as a modal so the conversation underneath is kept and can
 * resume after purchase. Entitlement and founding-price eligibility are decided
 * on the server, never here.
 */
export default function Paywall() {
  const { t } = useI18n();
  const { entitlement } = useSession();
  const router = useRouter();

  return (
    <Screen
      footer={
        <View className="gap-sm">
          <LiquidButton title={t('membership.activate')} onPress={() => {}} />
          <SecondaryButton title={t('membership.restore')} onPress={() => {}} haptic={false} />
          <TextButton title={t('common.close')} tone="secondary" className="self-center" onPress={() => router.back()} />
        </View>
      }>
      {entitlement.billingProblem ? (
        <Banner
          tone="warning"
          title={t('membership.billingProblemTitle')}
          message={t('membership.billingProblemMessage')}
          className="mt-lg"
        />
      ) : null}

      <View className="flex-1 justify-center gap-lg">
        <Title center>{t('membership.paywallTitle')}</Title>
        <Text variant="caption" center>
          {t('membership.paywallMessage')}
        </Text>

        <GlassCard className="mt-md" padding="p-md items-center">
          <Text variant="title">{t('membership.perMonth', { price: '€9,99' })}</Text>
          <Text variant="micro" tone="tertiary" center className="pt-xs">
            {/* TODO: final membership copy. */}
            {t('membership.noCommitment')}
          </Text>
        </GlassCard>
      </View>
    </Screen>
  );
}
