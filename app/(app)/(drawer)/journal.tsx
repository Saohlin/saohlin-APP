import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  JournalRow,
  LiquidButton,
  Screen,
  SectionHeader,
  SoftCard,
  Text,
  TopBar,
  WeekStrip,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import {
  SCROLL_FADE_HEIGHT,
  motion,
  scrollFade,
  scrollFadeStops,
} from '../../../theme';

/**
 * Journal: header, week strip, today's card with the single "write" entry point,
 * then the archive. The entries below are placeholder data until storage exists.
 * Unshared entries must never reach the AI.
 */
const DEMO_ENTRIES = [
  { id: '1', date: '30. 07. 2026', excerpt: 'Dnes jsem si uvědomila, že klid je můj nový luxus.', time: '22:15' },
  { id: '2', date: '29. 07. 2026', excerpt: 'Vděčnost za malé okamžiky, které dělají velký rozdíl.', time: '20:40' },
  { id: '3', date: '28. 07. 2026', excerpt: 'Důvěřuji procesu. Všechno se děje přesně tak, jak má.', time: '19:10' },
  { id: '4', date: '27. 07. 2026', excerpt: 'Dnes si dovoluji zpomalit a být sama sebou.', time: '18:30' },
];

/** Gap between archive rows. */
const ROW_GAP = 20;

const BOOK = require('../../../assets/brand/journal-book.png');
/** Illustration width. Controls the text column width next to it. */
const BOOK_W = 124;
/** Size of the "write" capsule on the today card. */
const WRITE_H = 36;
const BOOK_H = Math.round((BOOK_W * 872) / 700);

/** Screen gutter for this screen (narrower than the app default). */
const INSET = 'px-[20px]';

export default function Journal() {
  const { t } = useI18n();
  const router = useRouter();
  const [day, setDay] = useState(new Date());

  /** Bottom fade while scrolling; hidden at the end of the list. */
  const fade = useRef(new Animated.Value(1)).current;
  const faded = useRef(true);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const on = contentOffset.y + layoutMeasurement.height < contentSize.height - 12;
    if (faded.current === on) return;
    faded.current = on;
    Animated.timing(fade, {
      toValue: on ? 1 : 0,
      duration: motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  // No bottom edge: the scroller runs to the screen edge; list padding clears the home indicator.
  return (
    <Screen padded={false} edges={['top']}>
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} showsVerticalScrollIndicator={false}>
        <View className={`${INSET} pb-xxl`}>
        <TopBar
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/chat'))}
          action="search"
          actionLabel={t('common.search')}
        />

        <Text variant="title" center className="pt-xs">
          {t('journal.title')}
        </Text>
        {/* Subtitle column is narrower than the full width, for the intended line break. */}
        <Text variant="caption" center className="w-[72%] self-center pt-xs">
          {t('journal.subtitle')}
        </Text>

        {/* Week strip is inset less than the default card padding. */}
        <SoftCard padding="px-xs py-sm" className="mt-md">
          <WeekStrip selected={day} onSelect={setDay} marked={[new Date()]} />
        </SoftCard>

        <SoftCard className="mt-sm">
          <View className="flex-row items-start">
            <View className="flex-1 pr-sm">
              <Text variant="label" tone="tertiary">
                {t('journal.today')}
              </Text>
              {/* `greeting` keeps sentence case (`title` would uppercase it). */}
              <Text variant="greeting" className="pt-xxs">
                {t('journal.todayPrompt')}
              </Text>
              {/* The single entry point into writing. No accessory arrow, so the label keeps full size. */}
              <LiquidButton
                height={WRITE_H}
                title={t('journal.write')}
                onPress={() => router.push('/journal/new')}
                style={{ marginTop: 24 }}
              />
            </View>
            <Image
              source={BOOK}
              style={{ width: BOOK_W, height: BOOK_H }}
              resizeMode="contain"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </View>
        </SoftCard>

        <SectionHeader
          title={t('journal.archive')}
          action={t('common.showAll')}
          onActionPress={() => {}}
          className="pt-lg"
        />
        <View style={{ gap: ROW_GAP }}>
          {DEMO_ENTRIES.map((e) => (
            <JournalRow
              key={e.id}
              date={e.date}
              excerpt={e.excerpt}
              time={e.time}
              onPress={() => {}}
            />
          ))}
          </View>
        </View>
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
    </Screen>
  );
}
