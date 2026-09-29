import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

import {
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  TopBar,
} from '../../components/ui';
import { useI18n } from '../../i18n';
import { listConversations, type ConversationSummary } from '../../lib/api/chat';

const PAGE = 30;

function czechDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/**
 * Screen 21: past conversations, newest first, 30 per page. Tapping one opens
 * it in the chat to read and continue (screen 22). Titles are written by
 * CLAUDIA AI after the second exchange; until then the date stands in.
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

  const open = (id: string) => router.navigate({ pathname: '/chat', params: { c: id } });

  return (
    <Screen padded={false}>
      <View className="px-gutter">
        <TopBar title={t('chat.history')} onBack={() => router.back()} />
      </View>
      {state === 'loading' ? (
        <LoadingState />
      ) : state === 'error' ? (
        <ErrorState onRetry={() => void load(0)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="chat"
          title={t('states.emptyHistoryTitle')}
          message={t('states.emptyHistoryMessage')}
          actionLabel={t('chat.startConversation')}
          onAction={() => router.navigate({ pathname: '/chat', params: { c: undefined } })}
        />
      ) : (
        <FlatList
          className="flex-1 px-gutter"
          data={items}
          keyExtractor={(c) => c.id}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!done) void load(page + 1);
          }}
          renderItem={({ item }) => (
            <ListRow
              icon="chat"
              title={item.title?.trim() || t('chat.untitled', { date: czechDate(item.startedAt) })}
              subtitle={czechDate(item.lastMessageAt)}
              onPress={() => open(item.id)}
            />
          )}
        />
      )}
    </Screen>
  );
}
