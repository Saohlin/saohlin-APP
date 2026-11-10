import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import {
  Dialog,
  EmptyState,
  ErrorState,
  GlassCard,
  Icon,
  LiquidButton,
  OfflineState,
  Screen,
  Text,
  TopBar,
} from '../../../components/ui';
import { CardsError } from '../../../features/cards/api';
import { CardArt } from '../../../features/cards/components/CardArt';
import { useCard } from '../../../features/cards/hooks';
import type { Card } from '../../../features/cards/types';
import { useI18n } from '../../../i18n';
import { type as typeScale, useTheme } from '../../../theme';

/**
 * One card, laid out as Claudia's approved DŮVĚRA template (1 Nov): the name,
 * three keywords, the artwork, the quote line, then three glass panels
 * (Vzkaz pro tebe, Tvůj konkrétní krok, Mantra) and the reading button.
 * Everything comes from `public.cards`. The back and bookmark buttons and the
 * reading button stay pinned; the card scrolls between them.
 */

/** The artwork takes about 37% of the screen width, as in the template. */
const ART_SHARE = 0.37;
const ART_MIN = 136;
const ART_MAX = 220;

export default function CardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const card = useCard(id);
  // The bookmark (waiting for Claudia) and the reading (phase 2) are not built yet: both say so.
  const [notice, setNotice] = useState(false);
  const hideNotice = useCallback(() => setNotice(false), []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/cards'));
  const header = (
    <TopBar
      onBack={back}
      action="bookmark"
      actionLabel={t('cards.library')}
      onActionPress={() => setNotice(true)}
    />
  );

  let body: React.ReactNode;
  if (card.data) {
    body = <CardDetail card={card.data} />;
  } else if (card.error) {
    const kind = card.error instanceof CardsError ? card.error.kind : 'unknown';
    body =
      kind === 'notFound' ? (
        <EmptyState
          icon={null}
          title={t('cards.notFoundTitle')}
          message={t('cards.notFoundMessage')}
          actionLabel={t('cards.backToCards')}
          onAction={() => router.replace('/cards')}
        />
      ) : kind === 'offline' ? (
        <OfflineState onRetry={() => void card.refetch()} />
      ) : (
        <ErrorState onRetry={() => void card.refetch()} />
      );
  } else {
    body = <CardLoading />;
  }

  // The app's scrolling screen: back and bookmark float over a light veil, the
  // card scrolls underneath them, and the reading button stays pinned below.
  // (A ScrollView of our own inside a non-scrolling Screen sits under its
  // keyboard-dismissing Pressable, which takes the drag on iOS.)
  return (
    <Screen
      scroll
      header={header}
      footer={
        card.data ? (
          <LiquidButton
            title={t('cards.wantReading')}
            onPress={() => setNotice(true)}
            accessory={<ReadingArrow />}
            labelStyle={{ ...typeScale.cardButton, lineHeight: undefined }}
          />
        ) : undefined
      }>
      {body}

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

function ReadingArrow() {
  const { colors } = useTheme();
  return <Icon name="arrow-right" size={20} weight="regular" color={colors.textStrong} />;
}

function useArtWidth() {
  const { width } = useWindowDimensions();
  return Math.round(Math.min(ART_MAX, Math.max(ART_MIN, width * ART_SHARE)));
}

function CardDetail({ card }: { card: Card }) {
  const { t } = useI18n();
  const artWidth = useArtWidth();

  const panels = [
    { key: 'message', title: t('cards.message'), text: card.message, mantra: false },
    { key: 'step', title: t('cards.concreteStep'), text: card.step, mantra: false },
    { key: 'mantra', title: t('cards.mantra'), text: card.mantra ? `„${card.mantra}“` : null, mantra: true },
  ].filter((p) => !!p.text);

  return (
    <View className="pt-xs">
      <Text
        variant="guideName"
        tone="brand"
        center
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        accessibilityRole="header">
        {card.name}
      </Text>
      {card.keywords.length ? (
        <Text variant="cardKeywords" center className="pt-xs">
          {card.keywords.join(' • ')}
        </Text>
      ) : null}

      <View className="items-center pt-md">
        <CardArt uri={card.artUrl} name={card.name} width={artWidth} glow />
      </View>

      {card.quote ? (
        <Text variant="cardQuote" center className="pt-md">
          {`„${card.quote}“`}
        </Text>
      ) : null}

      <View className="gap-sm pt-md">
        {panels.map((p) => (
          <GlassCard key={p.key} edge="frost" accessible>
            <Text variant="cardHeading">{p.title}</Text>
            <Text variant={p.mantra ? 'cardMantra' : 'cardBody'} className="pt-xs">
              {p.text}
            </Text>
          </GlassCard>
        ))}
      </View>
    </View>
  );
}

/** While a card opened from a link loads: the artwork box and three empty panels. */
function CardLoading() {
  const artWidth = useArtWidth();
  return (
    <View accessibilityRole="progressbar" className="flex-1 pt-md">
      <View className="items-center">
        <CardArt width={artWidth} />
      </View>
      <View className="gap-sm pt-lg">
        <GlassCard edge="frost" className="h-[96px]" />
        <GlassCard edge="frost" className="h-[96px]" />
        <GlassCard edge="frost" className="h-[72px]" />
      </View>
    </View>
  );
}
