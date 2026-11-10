import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useSession } from '../../../auth';
import { EntryRow, EntryRowsSkeleton, JournalFault, JournalToast, ROW_GAP, UndoDeleted } from '../../../components/journal';
import {
  Banner,
  EmptyState,
  LiquidButton,
  Screen,
  SectionHeader,
  SoftCard,
  Text,
  TextButton,
  TopBar,
  WeekStrip,
  useHeaderInset,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { JournalError, getHome, listEntries, type EntrySummary, type JournalErrorKind } from '../../../lib/api/journal';
import { cursorForDay, dateToDay, dayToDate, displayDay, takeDay } from '../../../lib/journal/format';
import { journalStore, useJournalStore } from '../../../lib/journal/store';
import {
  SCROLL_FADE_HEIGHT,
  motion,
  scrollFade,
  scrollFadeStops,
  useTheme,
} from '../../../theme';

/**
 * Journal: header, week strip, the card with the single "write" entry point,
 * then the newest entries. One request (`journal_home`) fills the screen.
 *
 * Coming back shows what was loaded last at once and refreshes behind it.
 * Entries are private; only a shared one ever reaches CLAUDIA AI, and that
 * is decided on the server, not here.
 */

/** How long loaded data is shown without asking the server again. */
const FRESH_MS = 30_000;

const BOOK = require('../../../assets/brand/journal-book.png');
/** Illustration width. Controls the text column width next to it. */
const BOOK_W = 124;
/** Size of the "write" capsule on the today card. */
const WRITE_H = 36;
const BOOK_H = Math.round((BOOK_W * 872) / 700);

/** Screen gutter for this screen (narrower than the app default). */
const INSET = 'px-[20px]';

export default function Journal() {
  const { t, tp } = useI18n();
  const router = useRouter();
  const headerInset = useHeaderInset();
  const { colors } = useTheme();
  const { session } = useSession();
  const { home, deleted, flash } = useJournalStore(session?.userId ?? null);

  const [fault, setFault] = useState<JournalErrorKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** The day chosen in the strip; null follows the server's "today". */
  const [picked, setPicked] = useState<string | null>(null);
  // A slow answer that arrives after a newer one is dropped.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await getHome();
      if (mine !== seq.current) return;
      journalStore.setHome(data);
      setFault(null);
    } catch (e) {
      if (mine === seq.current) setFault(e instanceof JournalError ? e.kind : 'unknown');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const s = journalStore.get();
      if (!s.home || Date.now() - s.homeAt > FRESH_MS) void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

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

  // The server's day (Prague), so the strip is right on a phone set to another zone.
  const today = home?.today ?? dateToDay(new Date());
  // A day picked last week is not in this week's strip any more.
  const inWeek = !!picked && (!home || home.week.some((d) => d.date === picked));
  const day = inWeek && picked ? picked : today;
  const isToday = day === today;
  const dayCount = home ? (isToday ? home.todayCount : home.week.find((d) => d.date === day)?.count ?? 0) : 0;

  /**
   * Entries of the day chosen in the strip. Until a day is tapped the list
   * below shows the most recent entries; once one is, it shows that day only.
   */
  const [dayRows, setDayRows] = useState<{ day: string; items: EntrySummary[] } | 'failed' | null>(null);
  const daySeq = useRef(0);
  const chosen = inWeek ? picked : null;
  const loadDay = useCallback(async (iso: string) => {
    const mine = ++daySeq.current;
    try {
      const page = await listEntries(cursorForDay(iso), { limit: 30 });
      if (mine === daySeq.current) setDayRows({ day: iso, items: takeDay(page.items, iso).items });
    } catch {
      if (mine === daySeq.current) setDayRows('failed');
    }
  }, []);
  useEffect(() => {
    if (!chosen) {
      daySeq.current++;
      setDayRows(null);
      return;
    }
    setDayRows(null);
    void loadDay(chosen);
  }, [chosen, loadDay]);
  // Coming back from writing or deleting an entry: the chosen day may have changed.
  useFocusEffect(
    useCallback(() => {
      if (chosen) void loadDay(chosen);
    }, [chosen, loadDay]),
  );
  const dayItems = chosen && dayRows && dayRows !== 'failed' && dayRows.day === chosen ? dayRows.items : null;

  const openEntry = (id: string) => router.push({ pathname: '/journal/[id]', params: { id } });

  // No bottom edge: the scroller runs to the screen edge; list padding clears the home indicator.
  return (
    <Screen
      padded={false}
      edges={['top']}
      headerInset={false}
      header={
        <TopBar
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/chat'))}
          action="search"
          actionLabel={t('a11y.search')}
          onActionPress={() => router.push({ pathname: '/journal/archive', params: { search: '1' } })}
        />
      }>
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
        }>
        <View className={`${INSET} pb-xxl`} style={{ paddingTop: headerInset }}>
          <Text variant="title" center className="pt-xs">
            {t('journal.title')}
          </Text>
          {/* Subtitle column is narrower than the full width, for the intended line break. */}
          <Text variant="caption" center className="w-[72%] self-center pt-xs">
            {t('journal.subtitle')}
          </Text>

          {/* Week strip is inset less than the default card padding. */}
          <SoftCard padding="px-xs py-sm" className="mt-md">
            <WeekStrip
              today={dayToDate(today)}
              selected={dayToDate(day)}
              onSelect={(d) => setPicked(dateToDay(d))}
              marked={(home?.week ?? []).filter((d) => d.count > 0).map((d) => dayToDate(d.date))}
              lockFuture
            />
          </SoftCard>

          <SoftCard className="mt-sm">
            <View className="flex-row items-start">
              <View className="flex-1 pr-sm">
                <Text variant="label" tone="tertiary">
                  {isToday ? t('journal.today') : displayDay(day)}
                </Text>
                {/* `greeting` keeps sentence case (`title` would uppercase it). */}
                <Text variant="greeting" className="pt-xxs">
                  {isToday ? t('journal.todayPrompt') : t('journal.dayPrompt')}
                </Text>
                {dayCount > 0 ? (
                  <TextButton
                    title={tp(isToday ? 'journal.todayEntries' : 'journal.dayEntries', dayCount)}
                    onPress={() => router.push({ pathname: '/journal/archive', params: { day } })}
                    className="pt-xs"
                  />
                ) : null}
                {/* The single entry point into writing. No accessory arrow, so the label keeps full size. */}
                <LiquidButton
                  height={WRITE_H}
                  title={t('journal.write')}
                  onPress={() =>
                    isToday ? router.push('/journal/new') : router.push({ pathname: '/journal/new', params: { day } })
                  }
                  style={{ marginTop: dayCount > 0 ? 12 : 24 }}
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

          <UndoDeleted deleted={deleted} className="mt-sm" />

          {/* A refresh that failed leaves what was loaded on screen, and says so. */}
          {home && fault ? (
            <Banner
              tone="warning"
              message={t('journal.refreshFailed')}
              actionLabel={t('common.tryAgain')}
              onAction={() => void load()}
              className="mt-sm"
            />
          ) : null}

          {chosen ? (
            <>
              {/* A day is chosen: the list is that day's entries, not the recent ones. */}
              <SectionHeader
                title={chosen === today ? t('journal.today') : displayDay(chosen)}
                action={home && home.total > 0 ? t('common.showAll') : undefined}
                onActionPress={() => router.push('/journal/archive')}
                className="pt-lg"
              />
              {dayRows === 'failed' ? (
                <Banner
                  tone="warning"
                  message={t('journal.refreshFailed')}
                  actionLabel={t('common.tryAgain')}
                  onAction={() => void loadDay(chosen)}
                />
              ) : !dayItems ? (
                <EntryRowsSkeleton rows={2} />
              ) : dayItems.length === 0 ? (
                <EmptyState
                  compact
                  icon={null}
                  className="pt-xxl"
                  title={t('journal.emptyDayTitle')}
                  message={t('journal.emptyDayMessage')}
                />
              ) : (
                <View style={{ gap: ROW_GAP }}>
                  {dayItems.map((e) => (
                    <EntryRow key={e.id} entry={e} onPress={() => openEntry(e.id)} />
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
            <SectionHeader
              title={t('journal.archive')}
              action={home && home.total > 0 ? t('common.showAll') : undefined}
              onActionPress={() => router.push('/journal/archive')}
              className="pt-lg"
            />

            {!home ? (
              fault ? (
                <JournalFault kind={fault} onRetry={() => void load()} compact />
              ) : (
                <EntryRowsSkeleton rows={4} />
              )
            ) : home.total === 0 ? (
              <EmptyState compact icon={null} className="pt-xxl" title={t('states.emptyJournalTitle')} message={t('states.emptyJournalMessage')} />
            ) : (
              <View style={{ gap: ROW_GAP }}>
                {home.recent.map((e) => (
                  <EntryRow key={e.id} entry={e} onPress={() => openEntry(e.id)} />
                ))}
              </View>
            )}
            </>
          )}
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

      <JournalToast flash={flash} />
    </Screen>
  );
}
