import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, View } from 'react-native';

import {
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Screen,
  SectionHeader,
  SoftCard,
  Text,
  TopBar,
  useHeaderInset,
} from '../../components/ui';
import { useI18n } from '../../i18n';
import type { Dictionary, Path } from '../../i18n';
import { listConversations, type ConversationSummary } from '../../lib/api/chat';
import { useTheme } from '../../theme';

const PAGE = 30;

function czechDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

function clock(iso: string) {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Whole days between an ISO time and today, by calendar day rather than by 24 h. */
function daysAgo(iso: string) {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(new Date()) - day(new Date(iso))) / 86_400_000);
}

type Bucket = 'today' | 'yesterday' | 'week' | 'earlier';
const BUCKET_TITLE: Record<Bucket, Path<Dictionary>> = {
  today: 'chat.historyToday',
  yesterday: 'chat.historyYesterday',
  week: 'chat.historyWeek',
  earlier: 'chat.historyEarlier',
};
const bucketOf = (iso: string): Bucket => {
  const n = daysAgo(iso);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 7 ? 'week' : 'earlier';
};

/** One conversation: a glass card with its title and when it was last active. */
function ConversationCard({ title, when, onPress }: { title: string; when: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${when}`} onPress={onPress} className="active:opacity-85">
      <SoftCard padding="flex-row items-center gap-sm px-md py-sm">
        <View className="h-[40px] w-[40px] items-center justify-center rounded-pill border border-edge bg-glass/glass-soft">
          <Icon name="chat" size={19} color={colors.accent} />
        </View>
        <View className="flex-1 gap-xxs">
          <Text variant="bodyMedium" numberOfLines={2}>
            {title}
          </Text>
          <View className="flex-row items-center gap-xxs">
            <Icon name="clock" size={11} color={colors.textTertiary} />
            <Text variant="micro" tone="tertiary">
              {when}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={15} />
      </SoftCard>
    </Pressable>
  );
}

/**
 * Screen 21: past conversations, newest first, 30 per page, grouped by when
 * they were last active. Tapping one opens it in the chat to read and continue
 * (screen 22). Titles are written by CLAUDIA AI after the second exchange;
 * until then the date stands in.
 */
export default function Conversations() {
  const { t } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (p: number) => {
    try {
      const rows = await listConversations(p);
      setItems((prev) => (p === 0 ? rows : [...prev, ...rows]));
      setDone(rows.length < PAGE);
      setPage(p);
      setState('ready');
    } catch {
      if (p === 0) setState('error');
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  const headerInset = useHeaderInset();
  const open = (id: string) => router.navigate({ pathname: '/chat', params: { c: id } });
  const startNew = () => router.navigate({ pathname: '/chat', params: { c: undefined } });

  // The list arrives newest first, so buckets fill in order and stay in order.
  const sections = useMemo(() => {
    const order: Bucket[] = ['today', 'yesterday', 'week', 'earlier'];
    return order
      .map((key) => ({ key, title: t(BUCKET_TITLE[key]), data: items.filter((c) => bucketOf(c.lastMessageAt) === key) }))
      .filter((s) => s.data.length > 0);
  }, [items, t]);

  return (
    <Screen padded={false} headerInset={false} header={<TopBar title={t('chat.history')} onBack={() => router.back()} />}>
      {state !== 'ready' || items.length === 0 ? (
        // The screen is unpadded so the list can scroll edge to edge; the states
        // need the gutter back, or their button runs to the screen edges.
        <View className="flex-1 px-gutter pb-lg" style={{ paddingTop: headerInset }}>
          {state === 'loading' ? (
            <LoadingState spinner />
          ) : state === 'error' ? (
            <ErrorState onRetry={() => void load(0)} />
          ) : (
            <EmptyState
              icon={null}
              title={t('states.emptyHistoryTitle')}
              message={t('states.emptyHistoryMessage')}
              actionLabel={t('chat.startConversation')}
              onAction={startNew}
            />
          )}
        </View>
      ) : (
        <SectionList
          className="flex-1"
          contentContainerClassName="px-gutter pb-xl"
          contentContainerStyle={{ paddingTop: headerInset }}
          sections={sections}
          keyExtractor={(c) => c.id}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!done) void load(page + 1);
          }}
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} className="pt-lg" />}
          ItemSeparatorComponent={() => <View className="h-xs" />}
          renderItem={({ item, section }) => (
            <ConversationCard
              title={item.title?.trim() || t('chat.untitled', { date: czechDate(item.startedAt) })}
              // Recent ones read better as a time of day; older ones need the date.
              when={section.key === 'today' || section.key === 'yesterday' ? clock(item.lastMessageAt) : czechDate(item.lastMessageAt)}
              onPress={() => open(item.id)}
            />
          )}
        />
      )}
    </Screen>
  );
}
