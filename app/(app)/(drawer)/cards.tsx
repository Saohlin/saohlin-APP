import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';

import {
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  LiquidButton,
  OfflineState,
  Screen,
  Text,
  Title,
  TopBar,
  useHeaderInset,
} from '../../../components/ui';
import { CardsError } from '../../../features/cards/api';
import { CardArt } from '../../../features/cards/components/CardArt';
import { useCards, useDrawCard, useShuffledIds, useTodayDraw } from '../../../features/cards/hooks';
import { useI18n } from '../../../i18n';
import {
  SCROLL_FADE_HEIGHT,
  motion,
  scrollFade,
  scrollFadeStops,
  useTheme,
} from '../../../theme';

/**
 * Karty: the card of the day. Before today's draw, every published card lies
 * face down in a shuffled grid and one tap draws it. After the draw, the screen
 * shows today's card until the day turns in Prague. The server keeps it to one
 * card a day (`draw_card`), so a second phone or a reinstall gets the same card.
 */

const GRID_TOP = 49;
const COLUMNS = 3;
const GAP = { column: 13, row: 15 } as const;
/** Face-down placeholders while the deck loads. */
const LOADING_SLOTS = 9;
/** Today's card, face up. */
const TODAY_WIDTH = 168;

export default function Cards() {
  const { t } = useI18n();
  const router = useRouter();
  const headerInset = useHeaderInset();
  const { colors } = useTheme();

  const deck = useCards();
  const today = useTodayDraw();
  const draw = useDrawCard();
  const ids = useShuffledIds(deck.data);
  const [drawFailed, setDrawFailed] = useState(false);

  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));
  const card = width ? Math.floor((width - GAP.column * (COLUMNS - 1)) / COLUMNS) : 0;

  /** Scroll hint; hides after the first scroll. */
  const cue = useRef(new Animated.Value(1)).current;
  const spent = useRef(false);

  /** Fade at the bottom of the grid to show more cards continue; hidden at the end of the list. */
  const fade = useRef(new Animated.Value(1)).current;
  const faded = useRef(true);
  const ramp = (v: Animated.Value, seen: { current: boolean }, on: boolean) => {
    if (seen.current === on) return;
    seen.current = on;
    Animated.timing(v, {
      toValue: on ? 1 : 0,
      duration: motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    ramp(fade, faded, contentOffset.y + layoutMeasurement.height < contentSize.height - 12);

    if (spent.current || contentOffset.y <= 8) return;
    spent.current = true;
    Animated.timing(cue, {
      toValue: 0,
      duration: motion.base,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const openCard = useCallback((id: string) => router.push({ pathname: '/card/[id]', params: { id } }), [router]);

  const pick = useCallback(
    (id: string) => {
      if (draw.isPending) return;
      draw.mutate(id, {
        // The answer may be a card drawn earlier today (another phone): open that one.
        onSuccess: (d) => (d.cardId ? openCard(d.cardId) : undefined),
        onError: (error) => {
          // A card unpublished since the deck loaded: load the deck again and let the user pick anew.
          if (error instanceof CardsError && error.kind === 'notFound') void deck.refetch();
          setDrawFailed(true);
        },
      });
    },
    [deck, draw, openCard],
  );

  const renderSlot: ListRenderItem<string> = useCallback(
    ({ item }) => <CardArt faceDown width={card} disabled={draw.isPending} onPress={() => pick(item)} />,
    [card, draw.isPending, pick],
  );

  const back = () => (router.canGoBack() ? router.back() : router.replace('/chat'));
  const header = <TopBar onBack={back} />;

  // Today's card, once drawn ------------------------------------------------------------
  const drawn = today.data;
  if (drawn?.cardId) {
    const todayCard = deck.data?.find((c) => c.id === drawn.cardId);
    const cardId = drawn.cardId;
    return (
      <Screen header={header} scroll>
        <View className="flex-1 items-center justify-center gap-md py-lg">
          <Title center>{t('cards.today')}</Title>
          <CardArt
            uri={todayCard?.artUrl}
            name={drawn.cardName}
            width={TODAY_WIDTH}
            glow
            onPress={() => openCard(cardId)}
          />
          <Text variant="section" tone="brand" center>
            {drawn.cardName}
          </Text>
          <Text variant="caption" center>
            {t('cards.nextTomorrow')}
          </Text>
          <LiquidButton title={t('cards.openCard')} onPress={() => openCard(cardId)} />
        </View>
      </Screen>
    );
  }

  // Loading, empty and error --------------------------------------------------------------
  const failed = deck.error ?? today.error;
  if (failed && !deck.data) {
    const offline = failed instanceof CardsError && failed.kind === 'offline';
    const retry = () => {
      void deck.refetch();
      void today.refetch();
    };
    return (
      <Screen header={header}>
        {offline ? (
          <OfflineState onRetry={retry} />
        ) : (
          <ErrorState title={t('cards.loadFailed')} onRetry={retry} />
        )}
      </Screen>
    );
  }

  const loading = deck.isPending || today.isPending;
  if (!loading && deck.data && deck.data.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState icon={null} title={t('cards.emptyTitle')} message={t('cards.emptyMessage')} />
      </Screen>
    );
  }

  // The face-down grid ----------------------------------------------------------------------
  const slots = loading ? Array.from({ length: LOADING_SLOTS }, (_, i) => `loading-${i}`) : ids;

  // No bottom edge: the list runs to the screen edge. Its own padding lifts the
  // last row clear of the home indicator.
  return (
    <Screen padded={false} edges={['top']} headerInset={false} header={header}>
      <View className="flex-1">
        <FlatList
          data={slots}
          keyExtractor={(id) => id}
          numColumns={COLUMNS}
          renderItem={
            loading
              ? () => (
                  <View style={{ opacity: 0.6 }}>
                    <CardArt faceDown width={card} />
                  </View>
                )
              : renderSlot
          }
          columnWrapperStyle={{ columnGap: GAP.column }}
          ItemSeparatorComponent={() => <View style={{ height: GAP.row }} />}
          onScroll={onScroll}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator
          accessibilityHint={t('cards.moreBelow')}
          contentContainerClassName="px-gutter pb-xxl"
          contentContainerStyle={{ paddingTop: headerInset }}
          ListHeaderComponent={
            <View onLayout={onLayout} style={{ marginBottom: GRID_TOP }}>
              {/* Long heading is allowed to shrink. */}
              <Title center numberOfLines={1} adjustsFontSizeToFit className="pt-sm">
                {t('cards.forYou')}
              </Title>
              <Text variant="caption" center className="pt-xs">
                {t('cards.drawPrompt')}
              </Text>
              <Text variant="caption" center className="pt-xxs">
                {t('cards.trustIntuition')}
              </Text>
            </View>
          }
        />

        <Animated.View
          pointerEvents="none"
          style={{ opacity: fade, height: SCROLL_FADE_HEIGHT }}
          className="absolute inset-x-0 bottom-0">
          <LinearGradient
            colors={scrollFade as unknown as [string, string, ...string[]]}
            locations={scrollFadeStops as unknown as [number, number, ...number[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View pointerEvents="none" style={{ opacity: cue }} className="absolute inset-x-0 bottom-xs items-center">
          <Icon name="chevron-down" size={26} weight="regular" color={colors.accentStrong} />
        </Animated.View>
      </View>

      <Dialog
        single
        visible={drawFailed}
        onClose={() => setDrawFailed(false)}
        title={t('states.errorTitle')}
        message={t('cards.drawFailed')}
        confirmLabel={t('common.understood')}
        onConfirm={() => setDrawFailed(false)}
      />
    </Screen>
  );
}
