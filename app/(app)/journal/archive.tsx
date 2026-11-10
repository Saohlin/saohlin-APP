import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { useSession } from '../../../auth';
import {
  EntryRow,
  EntryRowsSkeleton,
  JournalFault,
  JournalToast,
  ROW_GAP,
  UndoDeleted,
} from '../../../components/journal';
import {
  Banner,
  ButtonRow,
  Chip,
  EmptyState,
  InlineMessage,
  Screen,
  SearchField,
  Text,
  TextButton,
  TopBar,
  useHeaderInset,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import {
  JournalError,
  listEntries,
  searchEntries,
  type Cursor,
  type EntrySummary,
  type JournalErrorKind,
  type Limit,
  type SearchHit,
} from '../../../lib/api/journal';
import { limitCopy } from '../../../lib/journal/copy';
import {
  SEARCH_MAX_CHARS,
  appendPage,
  cursorForDay,
  displayDay,
  isIsoDay,
  searchTerm,
  takeDay,
} from '../../../lib/journal/format';
import { journalStore, useJournalStore } from '../../../lib/journal/store';
import { useTheme } from '../../../theme';

const PAGE = 30;
/** Search waits this long after the last keystroke. */
const SEARCH_DELAY_MS = 300;

type List = {
  items: EntrySummary[];
  next: Cursor | null;
  /** First page: nothing to show yet. */
  loading: boolean;
  /** A further page is on its way. */
  loadingMore: boolean;
  fault: JournalErrorKind | null;
  /** The first page is in, a later one failed. */
  moreFault: boolean;
};
const EMPTY_LIST: List = { items: [], next: null, loading: true, loadingMore: false, fault: null, moreFault: false };

type Search =
  | { state: 'idle' }
  | { state: 'short' }
  | { state: 'loading' }
  | { state: 'done'; items: SearchHit[]; scanned: number; total: number }
  | { state: 'limit'; limit: Limit }
  | { state: 'fault'; kind: JournalErrorKind };

/**
 * The whole journal, newest first, with search. Pages are fetched as the
 * list is scrolled (keyset paging: page 100 costs what page 1 does).
 *
 * `?day=YYYY-MM-DD` shows one day, `?shared=1` only what is shared with
 * CLAUDIA AI, `?search=1` opens with the search field focused.
 *
 * Search runs on the server, over decrypted text that never leaves it except
 * as the matching rows; the term is sent in the request body, not the URL.
 */
export default function JournalArchive() {
  const { t } = useI18n();
  const router = useRouter();
  const headerInset = useHeaderInset();
  const { colors } = useTheme();
  const { session } = useSession();
  const { revision, deleted, flash } = useJournalStore(session?.userId ?? null);
  const params = useLocalSearchParams<{ day?: string; shared?: string; search?: string }>();

  const [day, setDay] = useState<string | null>(isIsoDay(params.day) ? params.day : null);
  const [sharedOnly, setSharedOnly] = useState(params.shared === '1');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<List>(EMPTY_LIST);
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [refreshing, setRefreshing] = useState(false);

  const term = searchTerm(query);
  const searching = query.trim().length > 0;

  // ------------------------------------------------------------------- list

  const listSeq = useRef(0);
  const listRef = useRef(list);
  listRef.current = list;
  const loadedAt = useRef(-1);

  /** One page. In day mode a page can run past the day; what is past it is dropped and paging stops. */
  const fetchPage = useCallback(
    async (before: Cursor | null) => {
      const page = await listEntries(before ?? (day ? cursorForDay(day) : null), { limit: PAGE, sharedOnly });
      if (!day) return { items: page.items, next: page.nextCursor };
      const mine = takeDay(page.items, day);
      return { items: mine.items, next: mine.reachedOlder ? null : page.nextCursor };
    },
    [day, sharedOnly],
  );

  const loadFirst = useCallback(
    async (quiet = false) => {
      const mine = ++listSeq.current;
      loadedAt.current = journalStore.get().revision;
      if (!quiet) setList(EMPTY_LIST);
      try {
        const page = await fetchPage(null);
        if (mine !== listSeq.current) return;
        setList({ ...EMPTY_LIST, items: page.items, next: page.next, loading: false });
      } catch (e) {
        if (mine !== listSeq.current) return;
        const kind = e instanceof JournalError ? e.kind : 'unknown';
        // A quiet refresh that fails keeps the rows that are already there.
        setList((l) => ({ ...l, loading: false, loadingMore: false, fault: kind }));
      }
    },
    [fetchPage],
  );

  const loadMore = useCallback(async () => {
    const l = listRef.current;
    if (l.loading || l.loadingMore || !l.next) return;
    const mine = listSeq.current;
    setList({ ...l, loadingMore: true, moreFault: false });
    try {
      const page = await fetchPage(l.next);
      if (mine !== listSeq.current) return;
      setList((cur) => ({ ...cur, items: appendPage(cur.items, page.items), next: page.next, loadingMore: false }));
    } catch {
      if (mine !== listSeq.current) return;
      setList((cur) => ({ ...cur, loadingMore: false, moreFault: true }));
    }
  }, [fetchPage]);

  // A new filter starts the list over.
  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  // Back from an entry that was edited, shared or deleted: the rows are re-read behind what is shown.
  useFocusEffect(
    useCallback(() => {
      if (loadedAt.current !== -1 && loadedAt.current !== revision) void loadFirst(true);
    }, [revision, loadFirst]),
  );

  // ----------------------------------------------------------------- search

  const searchSeq = useRef(0);
  const runSearch = useCallback(async (q: string) => {
    const mine = ++searchSeq.current;
    setSearch({ state: 'loading' });
    try {
      const res = await searchEntries(q);
      // An answer to an earlier term is dropped.
      if (mine !== searchSeq.current) return;
      setSearch(
        res.kind === 'ok'
          ? { state: 'done', items: res.items ?? [], scanned: res.scanned, total: res.total }
          : { state: 'limit', limit: res },
      );
    } catch (e) {
      if (mine !== searchSeq.current) return;
      setSearch({ state: 'fault', kind: e instanceof JournalError ? e.kind : 'unknown' });
    }
  }, []);

  useEffect(() => {
    if (!searching) {
      searchSeq.current++;
      setSearch({ state: 'idle' });
      return;
    }
    if (!term) {
      searchSeq.current++;
      setSearch({ state: 'short' });
      return;
    }
    setSearch({ state: 'loading' });
    const timer = setTimeout(() => void runSearch(term), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // `revision`: an entry changed while the results were open.
  }, [searching, term, revision, runSearch]);

  // ----------------------------------------------------------------- render

  const onRefresh = async () => {
    setRefreshing(true);
    if (searching && term) await runSearch(term);
    else await loadFirst(true);
    setRefreshing(false);
  };

  const open = (id: string) => router.push({ pathname: '/journal/[id]', params: { id } });
  const write = () =>
    day ? router.push({ pathname: '/journal/new', params: { day } }) : router.push('/journal/new');

  const rows: (EntrySummary | SearchHit)[] = searching ? (search.state === 'done' ? search.items : []) : list.items;

  const header = (
    <View className="gap-sm pb-sm">
      <UndoDeleted deleted={deleted} />
      {searching ? (
        search.state === 'short' ? (
          <InlineMessage tone="info" message={t('journal.searchHint')} />
        ) : search.state === 'limit' ? (
          <Banner tone="warning" message={t(limitCopy(search.limit))} />
        ) : search.state === 'done' && search.total > search.scanned ? (
          <Text variant="micro" tone="tertiary">
            {t('journal.searchScanned', { scanned: search.scanned, total: search.total })}
          </Text>
        ) : null
      ) : (
        <>
          {day ? (
            <View className="flex-row items-center justify-between">
              <Text variant="label" tone="secondary">
                {t('journal.dayFilter', { date: displayDay(day) })}
              </Text>
              <TextButton title={t('common.showAll')} onPress={() => setDay(null)} className="self-center" />
            </View>
          ) : (
            <ButtonRow>
              {/* A chip fills its parent, so each gets half the row. */}
              <View className="flex-1">
                <Chip label={t('journal.all')} selected={!sharedOnly} onPress={() => setSharedOnly(false)} />
              </View>
              <View className="flex-1">
                <Chip label={t('journal.sharedOnly')} selected={sharedOnly} onPress={() => setSharedOnly(true)} />
              </View>
            </ButtonRow>
          )}
          {/* Rows are on screen but the last refresh failed. */}
          {list.fault && list.items.length > 0 ? (
            <Banner
              tone="warning"
              message={t('journal.refreshFailed')}
              actionLabel={t('common.tryAgain')}
              onAction={() => void loadFirst(true)}
            />
          ) : null}
        </>
      )}
    </View>
  );

  const body = () => {
    if (searching) {
      if (search.state === 'loading') return <EntryRowsSkeleton rows={3} />;
      if (search.state === 'fault') {
        return <JournalFault kind={search.kind} onRetry={() => term && void runSearch(term)} compact />;
      }
      if (search.state === 'done' && search.items.length === 0) {
        return (
          <EmptyState
            compact
            icon="search"
            title={t('journal.searchEmptyTitle')}
            message={t('journal.searchEmptyMessage')}
          />
        );
      }
      return null;
    }
    if (list.loading) return <EntryRowsSkeleton rows={6} />;
    if (list.items.length > 0) return null;
    if (list.fault) return <JournalFault kind={list.fault} onRetry={() => void loadFirst()} compact />;
    if (day) {
      return (
        <EmptyState
          compact
          title={t('journal.emptyDayTitle')}
          message={t('journal.emptyDayMessage')}
          actionLabel={t('journal.write')}
          onAction={write}
        />
      );
    }
    if (sharedOnly) {
      return <EmptyState compact icon="chat" title={t('journal.emptySharedTitle')} message={t('journal.emptySharedMessage')} />;
    }
    return (
      <EmptyState
        compact
        title={t('states.emptyJournalTitle')}
        message={t('states.emptyJournalMessage')}
        actionLabel={t('journal.write')}
        onAction={write}
      />
    );
  };

  const footer = searching ? null : list.loadingMore ? (
    <EntryRowsSkeleton rows={2} className="pt-md" />
  ) : list.moreFault ? (
    <View className="flex-row items-center justify-between pt-md">
      <InlineMessage message={t('journal.loadMoreFailed')} className="flex-1" />
      <TextButton title={t('common.tryAgain')} onPress={() => void loadMore()} className="self-center" />
    </View>
  ) : null;

  return (
    <Screen
      padded={false}
      edges={['top']}
      headerInset={false}
      header={
        <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/journal'))} title={t('journal.archive')} />
      }>
      <View className="px-gutter pb-sm" style={{ paddingTop: headerInset }}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t('journal.searchPlaceholder')}
          autoFocus={params.search === '1'}
          maxLength={SEARCH_MAX_CHARS}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => (
          <EntryRow entry={item} text={'snippet' in item ? item.snippet : undefined} onPress={() => open(item.id)} />
        )}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={body()}
        ListFooterComponent={footer}
        contentContainerClassName="px-gutter pb-xxl"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          // After a failed page the retry is a deliberate tap, not every scroll frame.
          if (!searching && !listRef.current.moreFault) void loadMore();
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
        }
      />

      <JournalToast flash={flash} />
    </Screen>
  );
}

function Separator() {
  return <View style={{ height: ROW_GAP }} />;
}
