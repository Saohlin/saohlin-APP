import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { useSession } from '../../../auth';
import {
  Banner,
  ChatBubble,
  ChatComposer,
  CrisisCard,
  Dialog,
  InlineMessage,
  LimitReachedState,
  ListRow,
  MessageFailed,
  Screen,
  Sheet,
  Text,
  TextButton,
  Toast,
  TopBar,
  TrialCounter,
  TypingIndicator,
  type CrisisLine,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { crisisResources } from '../../../lib/api/chat';
import { copyText } from '../../../lib/clipboard';
import type { Notice, UiMessage } from '../../../lib/chat/reducer';
import { useChat } from '../../../lib/chat/useChat';

/** The thinking copy changes after this long without a first sentence. */
const THINKING_LONG_MS = 4000;
/** Auto-scroll follows the reply only while the user is this close to the bottom. */
const FOLLOW_SLACK = 80;

/**
 * Chat with CLAUDIA AI (screens 12 to 22). The first reply is often a
 * question, and reply length varies a lot by mode, so the layout must not
 * assume long answers. Opened with `?c=<conversationId>` it reads and
 * continues a past conversation.
 */
export default function Chat() {
  const { t } = useI18n();
  const router = useRouter();
  const navigation = useNavigation();
  const { c } = useLocalSearchParams<{ c?: string }>();
  const { profile, entitlement, refresh } = useSession();

  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);
  const [thinkingLong, setThinkingLong] = useState(false);
  const [storedCrisis, setStoredCrisis] = useState<CrisisLine[]>([]);

  const chat = useChat({ conversationId: c ?? null, onPaywall: () => router.push('/paywall') });
  const { state } = chat;

  // Capitalise only the first letter; names like `van der Berg` must stay as typed.
  const vocative = profile?.vocative?.trim() || '';
  const name = vocative ? vocative.charAt(0).toUpperCase() + vocative.slice(1) : '';

  // The thinking copy changes at 4 s.
  useEffect(() => {
    if (state.phase !== 'thinking' && state.phase !== 'sending') {
      setThinkingLong(false);
      return;
    }
    const timer = setTimeout(() => setThinkingLong(true), THINKING_LONG_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // Nothing interrupts a message in flight: the drawer waits for done.
  useEffect(() => {
    navigation.setOptions({ swipeEnabled: !chat.busy });
  }, [navigation, chat.busy]);

  // A limit the server did not store hands the text back to the composer.
  useEffect(() => {
    if (state.restoreDraft) {
      setDraft((d) => d || state.restoreDraft!);
      chat.draftRestored();
    }
  }, [state.restoreDraft, chat]);

  // Back from the paywall: re-read the membership; if it is active, answer the held message in place.
  const heldId = state.notice?.kind === 'paywall' ? state.notice.userMessageId : null;
  useFocusEffect(
    useCallback(() => {
      if (heldId) void refresh();
    }, [heldId, refresh]),
  );
  useEffect(() => {
    if (heldId && entitlement.active) chat.resume(heldId);
  }, [heldId, entitlement.active, chat]);

  // A reopened conversation that held a crisis card shows the lines again.
  const hasCrisisEvent = state.messages.some((m) => m.eventKind === 'crisis_resources');
  useEffect(() => {
    if (hasCrisisEvent) void crisisResources().then(setStoredCrisis).catch(() => {});
  }, [hasCrisisEvent]);

  // Auto-scroll follows the reply unless the user has scrolled up to read.
  const scroll = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - FOLLOW_SLACK;
    if (contentOffset.y < 40 && state.hasMore && !state.loading) void chat.loadOlder();
  };

  const onSend = () => {
    if (chat.send(draft)) {
      setDraft('');
      atBottom.current = true;
    }
  };

  const onCopy = async (text: string) => {
    if (await copyText(text)) setCopied(true);
  };

  const trialRemaining = state.trialRemaining ?? entitlement.trialRemaining;
  const empty = state.messages.length === 0 && !state.loading;
  const lastUserKey = [...state.messages].reverse().find((m) => m.role === 'user')?.key;

  return (
    <Screen
      padded={false}
      avoidKeyboard
      footer={
        <View className="px-gutter">
          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={onSend}
            sendDisabled={chat.busy}
            onMic={() => {}}
          />
        </View>
      }>
      <View className="px-gutter">
        <TopBar
          menu
          title={t('nav.chat')}
          action="more"
          actionVariant="plain"
          actionLabel={t('a11y.more')}
          onActionPress={() => setMenuOpen(true)}
        />
        {!entitlement.active && trialRemaining > 0 ? (
          <TrialCounter
            remaining={trialRemaining}
            total={entitlement.trialTotal}
            className="mt-xxs"
            onPress={() => router.push('/paywall')}
          />
        ) : null}
      </View>

      <ScrollView
        ref={scroll}
        className="flex-1 px-gutter"
        contentContainerClassName="gap-lg pb-md"
        onScroll={onScroll}
        scrollEventThrottle={100}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (atBottom.current) scroll.current?.scrollToEnd({ animated: true });
        }}>
        {empty ? (
          <View className="items-center gap-xxs pb-xl pt-xl">
            <Text variant="greeting" center>
              {name ? t('chat.greeting', { name }) : t('chat.title')}
            </Text>
            <Text variant="caption" tone="default" center>
              {t('chat.prompt')}
            </Text>
          </View>
        ) : null}

        {/* AI Act Art. 50: disclosed at the start of every conversation. */}
        <Text variant="micro" tone="tertiary" center className={empty ? '-mt-md' : 'pt-sm'}>
          {t('chat.aiDisclosure')}
        </Text>

        {state.hasMore ? (
          <TextButton title={t('chat.loadOlder')} onPress={() => void chat.loadOlder()} className="self-center" />
        ) : null}

        {state.messages.map((m) => (
          <MessageView
            key={m.key}
            m={m}
            userLabel={profile?.displayName}
            crisisLines={storedCrisis}
            onRetry={
              m.role === 'user' && m.status === 'failed' && m.key === lastUserKey && canRetry(state.notice)
                ? () => chat.retry(m.key)
                : undefined
            }
            failedMessage={t(failureCopy(state.notice))}
            heldMessage={t('chat.held')}
            onCopy={onCopy}
          />
        ))}

        {state.phase === 'sending' || state.phase === 'thinking' ? (
          <TypingIndicator label={thinkingLong ? t('chat.thinkingLong') : undefined} />
        ) : null}

        {state.crisis ? <CrisisCard lines={state.crisis} /> : null}

        <NoticeView
          notice={state.notice}
          onPaywall={() => router.push('/paywall')}
          onSettings={() => router.push('/settings')}
          onUndo={(id) => void chat.undoClear(id)}
          onDismiss={chat.dismissNotice}
        />
      </ScrollView>

      <Toast visible={copied} message={t('chat.copied')} onHide={() => setCopied(false)} />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={t('nav.chat')}>
        <ListRow
          icon="plus"
          title={t('chat.newConversation')}
          showChevron={false}
          disabled={chat.busy}
          onPress={() => {
            router.setParams({ c: undefined });
            chat.startNew();
            setDraft('');
            setMenuOpen(false);
          }}
        />
        <ListRow
          icon="clock"
          title={t('chat.history')}
          showChevron={false}
          disabled={chat.busy}
          onPress={() => {
            setMenuOpen(false);
            router.push('/conversations');
          }}
        />
        <ListRow
          icon="trash"
          title={t('chat.clear')}
          showChevron={false}
          destructive
          disabled={chat.busy || !state.conversationId}
          onPress={() => {
            setMenuOpen(false);
            setConfirmClear(true);
          }}
        />
      </Sheet>

      <Dialog
        visible={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('chat.clearTitle')}
        message={t('chat.clearMessage')}
        confirmLabel={t('chat.clear')}
        destructive
        onConfirm={() => {
          setConfirmClear(false);
          router.setParams({ c: undefined });
          void chat.clear();
        }}
      />
    </Screen>
  );
}

function canRetry(n: Notice | null) {
  return !n || n.kind !== 'error' || n.retryable;
}

function failureCopy(n: Notice | null) {
  if (n?.kind !== 'error') return 'chat.sendFailed' as const;
  switch (n.code) {
    case 'NETWORK':
      return 'states.offlineMessage' as const;
    case 'CREDIT_EXHAUSTED':
      return 'chat.errorUnavailable' as const;
    case 'MAINTENANCE':
      return 'states.maintenanceMessage' as const;
    case 'UNAUTHENTICATED':
      return 'chat.errorSession' as const;
    case 'AI_UNAVAILABLE':
      return 'chat.errorAi' as const;
    default:
      return 'chat.sendFailed' as const;
  }
}

function MessageView({
  m,
  userLabel,
  crisisLines,
  onRetry,
  failedMessage,
  heldMessage,
  onCopy,
}: {
  m: UiMessage;
  userLabel?: string;
  crisisLines: CrisisLine[];
  onRetry?: () => void;
  failedMessage: string;
  heldMessage: string;
  onCopy: (text: string) => void;
}) {
  if (m.role === 'event') {
    return m.eventKind === 'crisis_resources' ? <CrisisCard lines={crisisLines} /> : null;
  }
  if (m.role === 'assistant') {
    return <ChatBubble sender="ai" text={m.text} showActions={m.status === 'done'} onCopy={() => onCopy(m.text)} />;
  }
  return (
    <View className={m.status === 'sending' ? 'opacity-60' : undefined}>
      <ChatBubble sender="user" label={userLabel} text={m.text} />
      {m.status === 'failed' ? <MessageFailed message={failedMessage} onRetry={onRetry} className="pt-xxs" /> : null}
      {m.status === 'held' ? <InlineMessage tone="info" message={heldMessage} className="self-end pt-xxs" /> : null}
    </View>
  );
}

function NoticeView({
  notice,
  onPaywall,
  onSettings,
  onUndo,
  onDismiss,
}: {
  notice: Notice | null;
  onPaywall: () => void;
  onSettings: () => void;
  onUndo: (conversationId: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  if (!notice) return null;
  switch (notice.kind) {
    case 'paywall':
      return <Banner tone="info" message={notice.message} actionLabel={t('membership.activate')} onAction={onPaywall} />;
    case 'dailyCap':
      // Her warm message, no error styling (screen 19).
      return <LimitReachedState message={notice.message} className="flex-none py-lg" />;
    case 'aiPaused':
      return <Banner tone="info" message={notice.message} actionLabel={t('chat.aiPausedAction')} onAction={onSettings} />;
    case 'cleared':
      return (
        <Banner
          tone="info"
          message={t('chat.cleared')}
          actionLabel={t('chat.undo')}
          onAction={() => onUndo(notice.conversationId)}
          onDismiss={onDismiss}
        />
      );
    default:
      return null;
  }
}
