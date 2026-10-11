import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Dialog,
  GlassCard,
  GuideCard,
  HEADER_HEIGHT,
  IconButton,
  LiquidButton,
  Screen,
  Text,
  TopBar,
} from '../../../components/ui';
import { guideById } from '../../../guides';
import { useI18n } from '../../../i18n';
import { fonts } from '../../../theme';

/**
 * Guide detail: the name and its three keywords between the back and bookmark
 * buttons, the artwork, one quote line, then three panels (what your soul
 * needs, your concrete step, mantra). The header stays put; the rest scrolls.
 * Only Orel has final copy; the rest use placeholder text flagged in dev builds.
 */

/** Artwork width; height follows the 2:3 ratio. */
const ART_WIDTH = 148;

export default function GuideDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  // Saving a guide and the reading from a card are not built yet: both buttons say so.
  const [notice, setNotice] = useState(false);
  const hideNotice = useCallback(() => setNotice(false), []);

  const guide = guideById(id);

  if (!guide) {
    return (
      <Screen header={<TopBar onBack={() => router.back()} />}>
        <View className="flex-1 items-center justify-center">
          <Text variant="caption" tone="tertiary">
            {t('cards.guide')}
          </Text>
        </View>
      </Screen>
    );
  }

  const panels = [
    { title: t('cards.soulNeeds'), text: guide.soulNeeds },
    { title: t('cards.concreteStep'), text: guide.step },
  ].filter((p) => !!p.text);

  return (
    // Unpadded so the panels' shadows are not cut off at the scroller's sides;
    // each region carries the gutter itself.
    <Screen
      padded={false}
      pinHeader={false}
      footer={
        <View className="px-gutter">
          {/* The reading from a drawn card is not built yet (the chat does not know the card). */}
          <LiquidButton title={t('cards.wantReading')} onPress={() => setNotice(true)} />
        </View>
      }
      header={
        // The buttons stay on the first line when a long name wraps to two.
        <View className="flex-row items-start pb-xs">
          <View className="w-[40px] justify-center" style={{ height: HEADER_HEIGHT }}>
            <IconButton name="back" label={t('a11y.back')} onPress={() => router.back()} />
          </View>

          <View className="flex-1 justify-center px-xs" style={{ minHeight: HEADER_HEIGHT }}>
            <Text variant="guideName" tone="brand" center numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.5}>
              {guide.name}
            </Text>
            {guide.keywords?.length ? (
              <Text variant="label" center className="pt-xxs">
                {guide.keywords.join('  •  ')}
              </Text>
            ) : null}
          </View>

          <View className="w-[40px] items-end justify-center" style={{ height: HEADER_HEIGHT }}>
            <IconButton
              name="bookmark"
              label={t('cards.library')}
              onPress={() => setNotice(true)}
            />
          </View>
        </View>
      }>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-gutter pt-xs pb-lg"
        showsVerticalScrollIndicator={false}>
        <View className="items-center">
          <GuideCard source={guide.art} name={guide.name} width={ART_WIDTH} />
        </View>

        {guide.quote ? (
          <Text variant="label" center className="pt-md">
            {`„${guide.quote}“`}
          </Text>
        ) : null}

        <View className="gap-sm pt-md">
          {panels.map((p) => (
            <GlassCard key={p.title}>
              <Text variant="section" tone="purple">
                {p.title}
              </Text>
              <Text variant="chat" className="pt-xs">
                {p.text}
              </Text>
            </GlassCard>
          ))}

          {guide.mantra ? (
            <GlassCard>
              <Text variant="section" tone="purple">
                {t('cards.mantra')}
              </Text>
              <Text variant="body" className="pt-xs" style={{ fontFamily: fonts.bodyItalic }}>
                {`„${guide.mantra}“`}
              </Text>
            </GlassCard>
          ) : null}

          {!panels.length && !guide.mantra ? (
            <Text variant="body" tone="tertiary" center>
              {t('cards.descriptionPending')}
            </Text>
          ) : null}
        </View>

        {/* Dev-only marker for placeholder copy. Never shown in release builds. */}
        {__DEV__ && guide.draftCopy ? (
          <Text variant="micro" tone="tertiary" center className="pt-md">
            ukázkový text, čeká na Claudiiny popisy
          </Text>
        ) : null}

      </ScrollView>

      <Dialog
        single
        visible={notice}
        onClose={hideNotice}
        title={t('common.inProgressTitle')}
        message={t('common.inProgress')}
        confirmLabel={t('common.understood')}
        onConfirm={hideNotice}
      />
    </Screen>
  );
}
