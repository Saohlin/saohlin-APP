import { useState } from 'react';
import { View } from 'react-native';

import { Banner, GlassCard, Icon, LiquidButton, Screen, Text, Wordmark } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { Dictionary, Path } from '../../i18n';
import { useSession } from '../../auth';
import { authErrorKey } from '../../lib/authErrors';
import { useTheme, type as typeScale } from '../../theme';

/**
 * Welcome screen at the end of onboarding: heading, wordmark, four benefit rows,
 * the free-first-reading panel above the CTA and the disclaimer below it.
 * Values in `M` are layout measurements from the design; adjust them against the
 * design rather than by eye.
 */
const M = {
  top: 47,
  eyebrowToMark: 26,
  markWidth: 275,
  markToSubtitle: 24,
  subtitleToBenefits: 36,
  benefitRow: 26,
  benefitInset: 4,
  disclaimerInset: 15,
  benefitIcon: 26,
  benefitGap: 23,
  giftIcon: 28,
  giftGap: 20,
  infoIcon: 21,
  infoGap: 13,
  benefitsToGift: 30,
  giftToCta: 16,
  ctaToDisclaimer: 26,
} as const;

/** Benefit rows. Same icon on every row. */
const BENEFITS = [
  'welcome.benefitSupport',
  'welcome.benefitMemory',
  'welcome.benefitJournal',
  'welcome.benefitMantras',
] as const satisfies readonly Path<Dictionary>[];

export default function Welcome() {
  const { t } = useI18n();
  const { completeDeeper } = useSession();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Completing onboarding flips the status to ready; the guards then open the chat.
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await completeDeeper();
    } catch (e) {
      setError(t(authErrorKey(e)));
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <View className="items-center" style={{ paddingTop: M.top }}>
        <Text variant="title">{t('welcome.greeting')}</Text>

        <View style={{ marginTop: M.eyebrowToMark }}>
          <Wordmark width={M.markWidth} />
        </View>

        {/* Single line; shrinks rather than wraps on narrow phones. */}
        <Text
          variant="tagline"
          center
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
          style={{ marginTop: M.markToSubtitle }}>
          {t('welcome.subtitle')}
        </Text>
      </View>

      <View
        style={{
          marginTop: M.subtitleToBenefits,
          paddingLeft: M.benefitInset,
          gap: M.benefitRow,
        }}>
        {BENEFITS.map((key) => (
          <View key={key} className="flex-row">
            {/* Icon is centred on the first line of text, not the whole block. */}
            <View
              style={{
                width: M.benefitIcon,
                height: typeScale.body.lineHeight,
                justifyContent: 'center',
              }}>
              <Icon name="shield" size={M.benefitIcon} color={colors.brandViolet} />
            </View>
            <Text variant="body" tone="strong" style={{ marginLeft: M.benefitGap, flex: 1 }}>
              {t(key)}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: M.benefitsToGift }}>
        <GlassCard padding="p-md">
          <View className="flex-row items-center">
            <View style={{ width: M.giftIcon }}>
              <Icon name="gift" size={M.giftIcon} color={colors.brandViolet} />
            </View>
            <Text variant="lead" tone="secondary" style={{ marginLeft: M.giftGap, flex: 1 }}>
              {t('welcome.gift')}
            </Text>
          </View>
        </GlassCard>
      </View>

      {/* Inline rather than pinned to the footer, to keep the space below. */}
      <View style={{ marginTop: M.giftToCta }}>
        {error ? <Banner tone="warning" message={error} className="mb-md" /> : null}
        <LiquidButton
          title={t('welcome.startConversation')}
          loading={busy}
          onPress={start}
          accessory={<Icon name="send" size={20} color={colors.textStrong} />}
        />
      </View>

      <View
        className="flex-row"
        style={{ marginTop: M.ctaToDisclaimer, paddingLeft: M.disclaimerInset }}>
        <View
          style={{
            width: M.infoIcon,
            height: typeScale.caption.lineHeight,
            justifyContent: 'center',
          }}>
          <Icon name="info" size={M.infoIcon} color={colors.textSecondary} />
        </View>
        <Text variant="caption" style={{ marginLeft: M.infoGap, flex: 1 }}>
          {t('welcome.disclaimer')}
        </Text>
      </View>
    </Screen>
  );
}
