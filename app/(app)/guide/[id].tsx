import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  GlassCard,
  GuideCard,
  LiquidButton,
  Screen,
  Text,
  TopBar,
} from '../../../components/ui';
import { guideById } from '../../../guides';
import { useI18n } from '../../../i18n';

/**
 * Guide detail: artwork beside the name and introduction, then a description
 * panel that fills the remaining space and scrolls when the text is longer.
 * Only one guide has final copy; the rest use placeholder text flagged in dev builds.
 */

/** Artwork width; height follows the 2:3 ratio. */
const ART_WIDTH = 141;
const ART_GAP = 18;

export default function GuideDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  const guide = guideById(id);

  if (!guide) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center">
          <Text variant="caption" tone="tertiary">
            {t('cards.guide')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <LiquidButton title={t('cards.wantReading')} onPress={() => router.push('/chat')} />
      }>
      <TopBar
        onBack={() => router.back()}
        action="bookmark"
        actionLabel={t('cards.library')}
        onActionPress={() => setSaved((s) => !s)}
      />

      <View className="flex-row pt-xl">
        <GuideCard source={guide.art} name={guide.name} width={ART_WIDTH} />

        <View className="flex-1" style={{ marginLeft: ART_GAP }}>
          {/* Uses `title` so long names fit the column without shrinking too far. */}
          <Text variant="title" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
            {guide.name}
          </Text>

          {/* No hard line breaks in the intro text. */}
          {guide.intro ? (
            <Text variant="body" className="pt-md">
              {guide.intro}
            </Text>
          ) : null}
        </View>
      </View>

      {/* The panel fills the remaining space rather than hugging its text. */}
      <GlassCard className="mt-md flex-1" padding="flex-1 p-lg">
        <Text variant="title" tone="purple">
          {t('cards.meaning')}
        </Text>

        <ScrollView
          className="flex-1"
          contentContainerClassName="pt-md pb-xs"
          showsVerticalScrollIndicator={false}>
          {guide.meaning ? (
            <>
              <Text variant="body">{guide.meaning}</Text>
              {guide.guidance ? (
                <Text variant="body" className="pt-xl">
                  {guide.guidance}
                </Text>
              ) : null}
            </>
          ) : (
            <Text variant="body" tone="tertiary">
              {t('cards.descriptionPending')}
            </Text>
          )}

          {/* Dev-only marker for placeholder copy. Never shown in release builds. */}
          {__DEV__ && guide.draftCopy ? (
            <Text variant="micro" tone="tertiary" className="pt-md">
              ukázkový text, čeká na Claudiiny popisy
            </Text>
          ) : null}
        </ScrollView>
      </GlassCard>

      {saved ? (
        <Text variant="micro" tone="tertiary" center className="pt-xs">
          {t('cards.drawHistory')}
        </Text>
      ) : null}
    </Screen>
  );
}
