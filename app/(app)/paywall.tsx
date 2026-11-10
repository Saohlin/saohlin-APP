import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useSession } from '../../auth';
import { MeshBackdrop } from '../../components/brand/MeshBackdrop';
import {
  Banner,
  Dialog,
  GlassCard,
  Icon,
  LiquidButton,
  Screen,
  Text,
  TopBar,
} from '../../components/ui';
import { useI18n } from '../../i18n';
import { openLegal } from '../../lib/legal';
import { fonts, useTheme, type as typeScale } from '../../theme';

/**
 * The one oversized number on the screen. Type on this screen is kept to two
 * families and few sizes: the display font for the heading, the two small
 * labels and the button; the body font at 15 for reading, 12 for notes and
 * links, and this for the price.
 */
const PRICE_TYPE = {
  fontFamily: fonts.bodySemibold,
  fontSize: typeScale.titleLg.fontSize,
  lineHeight: typeScale.titleLg.lineHeight,
} as const;

/** What membership includes. The same four lines the welcome screen promises. */
const BENEFITS = [
  'welcome.benefitSupport',
  'welcome.benefitMemory',
  'welcome.benefitJournal',
  'welcome.benefitMantras',
] as const;

/**
 * Paywall, shown as a modal so the conversation underneath is kept and can
 * resume after purchase. Entitlement and founding-price eligibility are decided
 * on the server, never here.
 *
 * Top to bottom: why you are here, what it costs, what you get, then the one
 * action. Restore and the legal links sit under the button, as the stores expect.
 */
export default function Paywall() {
  const { t } = useI18n();
  const { entitlement } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  // Purchases are not wired yet: the buttons say so instead of doing nothing.
  const [notice, setNotice] = useState(false);
  const hideNotice = useCallback(() => setNotice(false), []);

  return (
    // A modal is its own native sheet, so the root backdrop is not behind it.
    // The same backdrop is painted here, reversed, so the sheet reads as its own layer.
    <View className="flex-1">
      <MeshBackdrop reversed />
      <Screen
        scroll
        header={
          <TopBar action="close" actionVariant="plain" actionLabel={t('common.close')} onActionPress={() => router.back()} />
        }
        footer={
          <View className="gap-xs pb-lg">
            <LiquidButton title={t('membership.activate')} onPress={() => setNotice(true)} />
            <Text variant="caption" tone="tertiary" center className="pt-xxs">
              {t('membership.renewNote')}
            </Text>
            {/* One line, in the body font: the display font is too wide for three links side by side. */}
            <View className="flex-row items-center justify-center gap-xs">
              {(
                [
                  [t('membership.restore'), () => setNotice(true)],
                  [t('legal.terms'), () => openLegal('terms')],
                  [t('legal.privacy'), () => openLegal('privacy')],
                ] as const
              ).map(([label, onPress], i) => (
                <View key={label} className="shrink flex-row items-center gap-xs">
                  {i > 0 ? (
                    <Text variant="micro" tone="tertiary">
                      ·
                    </Text>
                  ) : null}
                  <Pressable accessibilityRole="button" hitSlop={10} onPress={onPress} className="shrink py-xs active:opacity-60">
                    <Text variant="caption" tone="secondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className="underline">
                      {label}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        }>
        {entitlement.billingProblem ? (
          <Banner
            tone="warning"
            title={t('membership.billingProblemTitle')}
            message={t('membership.billingProblemMessage')}
            className="mt-sm"
          />
        ) : null}

        <View className="flex-1 justify-center gap-lg pb-sm">
          <View className="items-center gap-xs">
            {/* The feedback screen's heading style, kept to one line. */}
            <Text variant="display" tone="accent" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {t('membership.paywallTitle')}
            </Text>
            <Text variant="body" tone="secondary" center className="max-w-[300px]">
              {t('membership.paywallMessage')}
            </Text>
          </View>

          {/* The offer: one plan, so the price is the centrepiece rather than a choice. */}
          <GlassCard padding="items-center gap-xxs px-md py-lg">
            <Text variant="label" tone="accent">
              {t('membership.title')}
            </Text>
            {/* The price is set in the body font throughout: the display font has no
               euro glyph, and a store-formatted price ("9,99 €") must render as given. */}
            <View className="flex-row items-baseline gap-xxs pt-xs">
              <Text variant="bodyMedium" tone="strong" style={PRICE_TYPE}>
                €9,99
              </Text>
              <Text variant="body" tone="secondary">
                {t('membership.perMonth', { price: '' }).trim()}
              </Text>
            </View>
            <Text variant="caption" tone="tertiary" center>
              {/* TODO: final membership copy. */}
              {t('membership.noCommitment')}
            </Text>
          </GlassCard>

          <View className="gap-sm">
            {/* Larger than the card label and slightly heavier. The display font ships one
               weight, so the weight is synthesised, as on the button label. */}
            <Text
              variant="navItem"
              tone="accent"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{ fontWeight: '600' }}
              className="pb-xxs">
              {t('membership.includes')}
            </Text>
            {BENEFITS.map((key) => (
              <View key={key} className="flex-row gap-sm">
                {/* The welcome screen's shield tick, same size and colour, centred on
                   the first line of text rather than on the whole block. */}
                <View style={{ height: typeScale.chat.lineHeight, justifyContent: 'center' }}>
                  <Icon name="shield" size={22} color={colors.accent} />
                </View>
                {/* The welcome screen breaks these lines by hand; here they wrap on their own. */}
                <Text variant="chat" tone="secondary" className="flex-1">
                  {t(key).replace(/\n/g, ' ')}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </Screen>
      <Dialog
        single
        visible={notice}
        onClose={hideNotice}
        title={t('common.inProgressTitle')}
        message={t('common.inProgress')}
        confirmLabel={t('common.understood')}
        onConfirm={hideNotice}
      />
    </View>
  );
}
