import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useSession } from '../../../auth';
import { EntrySkeleton, FloatingToast, JournalFault, JournalToast } from '../../../components/journal';
import {
  Banner,
  Dialog,
  Icon,
  ListRow,
  Screen,
  Sheet,
  Text,
  TopBar,
  type Tone,
  useHeaderInset,
} from '../../../components/ui';
import { useI18n, type Dictionary, type Path } from '../../../i18n';
import {
  JournalError,
  deleteEntry,
  getEntry,
  shareEntry,
  unshareEntry,
  type Entry,
  type JournalErrorKind,
} from '../../../lib/api/journal';
import { copyText } from '../../../lib/clipboard';
import {
  actionFaultCopy,
  isShareNotice,
  limitCopy,
  shareNoticeCopy,
  shareNoticeOf,
  type ShareNotice,
} from '../../../lib/journal/copy';
import { SHARE_MAX_CHARS, displayDay, displayTime, toSummary } from '../../../lib/journal/format';
import { journalStore, useJournalStore } from '../../../lib/journal/store';
import { space, useTheme, withAlpha } from '../../../theme';

type Notice = { tone: Tone; title?: string; text: Path<Dictionary>; action?: 'paywall' | 'settings' };
type Asking = 'share' | 'unshare' | 'delete' | null;

const noticeForShare = (n: ShareNotice): Notice => ({
  tone: n === 'OFFLINE' || n === 'FAILED' ? 'error' : n === 'PAYWALL' || n === 'AI_PAUSED' ? 'info' : 'warning',
  text: shareNoticeCopy(n),
  action: n === 'PAYWALL' ? 'paywall' : n === 'AI_PAUSED' ? 'settings' : undefined,
});

/** Height of the soft wash at the bottom edge of an open entry. */
const EDGE_FADE = space.xxl * 2 + space.lg;

/**
 * One entry, to read. From here it can be edited, shared with CLAUDIA AI (or
 * taken back) and deleted. Sharing is always a confirmed, explicit step, and
 * the screen says plainly whether the entry is private or shared.
 *
 * `?notice=` is set by the editor when an entry was saved but the share the
 * user asked for did not happen: the entry is safe, and the reason is shown.
 */
export default function JournalEntry() {
  const { t, formatNumber } = useI18n();
  const router = useRouter();
  const headerInset = useHeaderInset();
  const { colors, mesh } = useTheme();
  const { session } = useSession();
  const { flash } = useJournalStore(session?.userId ?? null);
  const params = useLocalSearchParams<{ id: string; notice?: string }>();
  const id = params.id;

  const [entry, setEntry] = useState<Entry | null>(null);
  const [fault, setFault] = useState<JournalErrorKind | null>(null);
  const [notice, setNotice] = useState<Notice | null>(() =>
    isShareNotice(params.notice) ? { ...noticeForShare(params.notice), title: t('journal.saved') } : null,
  );
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideCopied = useCallback(() => setCopied(false), []);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const e = await getEntry(id);
      if (mine !== seq.current) return;
      setEntry(e);
      setFault(null);
    } catch (e) {
      if (mine !== seq.current) return;
      const kind = e instanceof JournalError ? e.kind : 'unknown';
      // What is on screen stays readable when a refresh fails, unless the entry is gone.
      setFault(kind);
      if (kind === 'notFound') setEntry(null);
    }
  }, [id]);

  // Every visit re-reads it: an edit, or a share from another device, shows at once.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/journal'));

  const fail = (e: unknown, fallback: Path<Dictionary>) => {
    const kind = e instanceof JournalError ? e.kind : 'unknown';
    if (kind === 'notFound') {
      setEntry(null);
      setFault('notFound');
      return;
    }
    setNotice({
      tone: kind === 'offline' || kind === 'consent' ? 'warning' : 'error',
      text: actionFaultCopy(kind, fallback),
      action: kind === 'consent' ? 'settings' : undefined,
    });
  };

  /** Shares, or (already shared) goes back to its conversation. The server decides which. */
  const share = async () => {
    if (!entry || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await shareEntry(entry.id);
      setAsking(null);
      if (res.kind === 'ok') {
        setEntry(res.entry);
        journalStore.changed();
        router.dismissTo({ pathname: '/chat', params: { c: res.conversationId, opener: 'journal' } });
        return;
      }
      setNotice(noticeForShare(shareNoticeOf(res)));
      if (res.code === 'PAYWALL') router.push('/paywall');
    } catch (e) {
      setAsking(null);
      fail(e, 'journal.shareFailed');
    } finally {
      setBusy(false);
    }
  };

  const unshare = async () => {
    if (!entry || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await unshareEntry(entry.id);
      setAsking(null);
      if (res.kind === 'ok') {
        setEntry(res.entry);
        journalStore.changed('unshared');
      } else {
        setNotice({ tone: 'warning', text: limitCopy(res) });
      }
    } catch (e) {
      setAsking(null);
      fail(e, 'journal.actionFailed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entry || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await deleteEntry(entry.id);
      setAsking(null);
      if (res.kind === 'ok') {
        // The list this returns to offers "undo".
        journalStore.deleted(toSummary(entry));
        leave();
      } else {
        setNotice({ tone: 'warning', text: limitCopy(res) });
      }
    } catch (e) {
      setAsking(null);
      fail(e, 'journal.actionFailed');
    } finally {
      setBusy(false);
    }
  };

  const ask = (what: Asking) => {
    setMenu(false);
    setAsking(what);
  };

  if (!entry) {
    return (
      <Screen header={<TopBar onBack={leave} />}>
        {fault ? (
          <JournalFault kind={fault} onRetry={() => void load()} onBack={leave} />
        ) : (
          <EntrySkeleton className="pt-lg" />
        )}
      </Screen>
    );
  }

  const shared = entry.sharedWithAi;
  const long = entry.bodyChars > SHARE_MAX_CHARS;

  return (
    <Screen
      padded={false}
      // No bottom inset: the entry runs to the very edge of the screen, and the
      // list's own padding lets the last line scroll clear of the home indicator.
      edges={['top']}
      headerInset={false}
      header={
        <TopBar
          onBack={leave}
          action="more"
          actionVariant="plain"
          actionLabel={t('a11y.more')}
          onActionPress={() => setMenu(true)}
        />
      }>
      <ScrollView
        className="flex-1 px-gutter"
        contentContainerClassName="gap-sm pb-xxl"
        contentContainerStyle={{ paddingTop: headerInset }}>
        <View className="gap-xxs">
          <Text variant="label" tone="tertiary">
            {displayDay(entry.entryDate)} · {displayTime(entry.createdAt)}
          </Text>
          <View className="flex-row items-center gap-xxs">
            <Icon name={shared ? 'chat' : 'lock'} size={14} color={colors.accent} />
            <Text variant="micro" tone="secondary">
              {shared ? t('journal.shared') : t('journal.private')}
              {entry.source === 'saved_message' ? ` · ${t('journal.fromChat')}` : ''}
            </Text>
          </View>
        </View>

        {notice ? (
          <Banner
            tone={notice.tone}
            title={notice.title}
            message={t(notice.text)}
            actionLabel={
              notice.action === 'paywall'
                ? t('membership.activate')
                : notice.action === 'settings'
                  ? t('chat.aiPausedAction')
                  : undefined
            }
            onAction={
              notice.action === 'paywall'
                ? () => router.push('/paywall')
                : notice.action === 'settings'
                  ? () => router.push('/settings')
                  : undefined
            }
            onDismiss={() => setNotice(null)}
          />
        ) : null}
        {/* A refresh that failed: the text on screen is the last one read. */}
        {fault && fault !== 'notFound' ? (
          <Banner
            tone="warning"
            message={t('journal.refreshFailed')}
            actionLabel={t('common.tryAgain')}
            onAction={() => void load()}
          />
        ) : null}

        {entry.title ? <Text variant="greeting">{entry.title}</Text> : null}
        <Text variant="chat" selectable>
          {entry.body}
        </Text>
      </ScrollView>

      {/* The pinned header already veils the top. This is its match at the bottom:
         the text fades out as it reaches the edge instead of being cut off. */}
      <LinearGradient
        pointerEvents="none"
        // Eased, so the wash builds gradually and no upper edge shows.
        colors={[0, 0.07, 0.25, 0.55, 0.8, 0.9].map((a) => withAlpha(mesh.base, a)) as [string, string, ...string[]]}
        locations={[0, 0.2, 0.45, 0.7, 0.9, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: EDGE_FADE }}
      />

      <Sheet visible={menu} onClose={() => setMenu(false)} title={t('journal.entryActions')}>
        <ListRow
          icon="edit"
          title={t('journal.editEntry')}
          showChevron={false}
          onPress={() => {
            setMenu(false);
            router.push({ pathname: '/journal/edit/[id]', params: { id: entry.id } });
          }}
        />
        <ListRow
          icon="copy"
          title={t('chat.copy')}
          showChevron={false}
          onPress={() => {
            setMenu(false);
            void copyText(entry.body).then((ok) => setCopied(ok));
          }}
        />
        {shared ? (
          <>
            {/* The way back to the conversation, now that the screen has no bottom buttons. */}
            <ListRow
              icon="chat"
              title={t('journal.openConversation')}
              showChevron={false}
              onPress={() => {
                setMenu(false);
                void share();
              }}
            />
            <ListRow icon="lock" title={t('journal.unshare')} showChevron={false} onPress={() => ask('unshare')} />
          </>
        ) : (
          <ListRow icon="chat" title={t('journal.shareWithAi')} showChevron={false} onPress={() => ask('share')} />
        )}
        <ListRow
          icon="trash"
          title={t('journal.deleteEntry')}
          showChevron={false}
          destructive
          onPress={() => ask('delete')}
        />
      </Sheet>

      <Dialog
        visible={asking === 'share'}
        onClose={() => (busy ? undefined : setAsking(null))}
        title={t('journal.shareTitle')}
        message={
          long
            ? `${t('journal.shareMessage')} ${t('journal.shareLongNote', { count: formatNumber(SHARE_MAX_CHARS) })}`
            : t('journal.shareMessage')
        }
        confirmLabel={t('journal.shareConfirm')}
        onConfirm={() => void share()}
        plainCancel
        busy={busy}
      />
      <Dialog
        visible={asking === 'unshare'}
        onClose={() => (busy ? undefined : setAsking(null))}
        title={t('journal.unshareTitle')}
        message={t('journal.unshareMessage')}
        confirmLabel={t('journal.unshare')}
        onConfirm={() => void unshare()}
        busy={busy}
      />
      <Dialog
        visible={asking === 'delete'}
        onClose={() => (busy ? undefined : setAsking(null))}
        title={t('journal.deleteTitle')}
        message={shared ? t('journal.deleteSharedMessage') : t('journal.deleteMessage')}
        confirmLabel={t('journal.deleteEntry')}
        onConfirm={() => void remove()}
        destructive
        plainCancel
        busy={busy}
      />

      {copied ? (
        <FloatingToast message={t('chat.copied')} onHide={hideCopied} />
      ) : (
        <JournalToast flash={flash} />
      )}
    </Screen>
  );
}
