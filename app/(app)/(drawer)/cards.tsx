import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';

import { GuideDrawGrid, Icon, Screen, Text, Title, TopBar } from '../../../components/ui';
import { GUIDE_BACK, shuffleGuides } from '../../../guides';
import { useI18n } from '../../../i18n';
import {
  SCROLL_FADE_HEIGHT,
  motion,
  scrollFade,
  scrollFadeStops,
  useTheme,
} from '../../../theme';

/**
 * Card draw: all 23 guides shuffled into a scrollable grid of face-down cards.
 * The guide behind each position is fixed before the tap. The heading stays
 * put while the grid scrolls.
 * TODO: turn-over animation.
 */

const GRID_TOP = 49;

export default function Cards() {
  const { t } = useI18n();
  const router = useRouter();
  const { colors } = useTheme();
  /**
   * Reshuffle each time the screen gains focus. The drawer keeps screens mounted,
   * so shuffling only on mount would repeat the same spread.
   */
  const [deck, setDeck] = useState(shuffleGuides);
  useFocusEffect(
    useCallback(() => {
      setDeck(shuffleGuides());
    }, []),
  );

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

  const open = (slot: number) =>
    router.push({ pathname: '/guide/[id]', params: { id: String(deck[slot].id) } });

  // No bottom edge: the scroller runs to the screen edge. The list's own padding
  // lifts the last row clear of the home indicator.
  return (
    <Screen padded={false} edges={['top']}>
      <TopBar menu />

      <View className="px-gutter">
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

      <View className="flex-1">
        <ScrollView
          onScroll={onScroll}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator
          accessibilityHint={t('cards.moreBelow')}
          contentContainerClassName="px-gutter pb-xxl"
          style={{ marginTop: GRID_TOP }}>
          <GuideDrawGrid back={GUIDE_BACK} count={deck.length} onPick={open} />
        </ScrollView>

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

        <Animated.View
          pointerEvents="none"
          style={{ opacity: cue }}
          className="absolute inset-x-0 bottom-xs items-center">
          <Icon
            name="chevron-down"
            size={26}
            weight="regular"
            color={colors.accentStrong}
          />
        </Animated.View>
      </View>
    </Screen>
  );
}
