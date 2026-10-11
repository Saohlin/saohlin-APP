import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';

import { useSession } from '../../auth';
import { useI18n, type Dictionary, type Path } from '../../i18n';
import {
  JournalError,
  createEntry,
  getEntry,
  shareEntry,
  updateEntry,
  type Entry,
  type JournalErrorKind,
  type SaveResult,
} from '../../lib/api/journal';
import { uuidv4 } from '../../lib/chat/uuid';
import { limitCopy, saveFaultCopy, shareNoticeOf } from '../../lib/journal/copy';
import { clearDraft, readDraft, writeDraft } from '../../lib/journal/drafts';
import { COUNTER_FROM, MAX_BODY_CHARS, displayDay, isIsoDay, toSummary } from '../../lib/journal/format';
import { journalStore } from '../../lib/journal/store';
import {
  Banner,
  Dialog,
  GlassCard,
  InlineMessage,
  LiquidButton,
  Screen,
  Switch,
  Text,
  TextArea,
  TopBar,
  type Tone,
} from '../ui';
import { JournalFault } from './Fault';
import { EntrySkeleton } from './Rows';

/** The draft is written this long after the last keystroke. */
const DRAFT_DELAY_MS = 600;

type Notice = { tone: Tone; text: Path<Dictionary>; settings?: boolean };

/**
 * Writing an entry: a new one (`entryId` absent) or an edit.
 *
 * What it guarantees:
 *  - Nothing typed is lost. The text is kept encrypted on the phone as it is
 *    typed and removed once the server has it or the user discards it.
 *  - A save is never doubled. A new entry carries one id through every retry,
 *    restarts included; an edit carries the version it started from, and a
 *    newer version on the server is a question to the user, not an overwrite.
 *  - Leaving with unsaved text always asks first.
 *
 * Entries are private. The share switch (new entries only) is the one way an
 * entry reaches CLAUDIA AI, and the sharing itself is done by the server.
 */
export function EntryEditor({ entryId, day }: { entryId?: string; day?: string }) {
  const { t, formatNumber } = useI18n();
  const router = useRouter();
  const navigation = useNavigation();
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const editing = !!entryId;
  const slot = entryId ?? null;

  /** Edit: the entry as the server has it. */
  const [base, setBase] = useState<Entry | null>(null);
  const [loadFault, setLoadFault] = useState<JournalErrorKind | null>(null);
  const [ready, setReady] = useState(false);

  const [body, setBody] = useState('');
  const [share, setShare] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [restored, setRestored] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [conflict, setConflict] = useState<Entry | null>(null);

  /** New: the id every save attempt of this entry uses. */
  const clientEntryId = useRef<string>(uuidv4());
  /** New: the day the entry is for; null is "today", decided by the server. */
  const entryDate = useRef<string | null>(isIsoDay(day) ? day : null);
  /** Edit: the version this edit started from. */
  const baseVersion = useRef(0);
  /** Edit: the title, which this screen does not show and must hand back unchanged. */
  const titleRef = useRef<string | null>(null);
  /** Saved or discarded: nothing more may be written as a draft. */
  const finished = useRef(false);
  const bodyRef = useRef('');
  bodyRef.current = body;

  const original = editing ? base?.body ?? '' : '';
  const dirty = ready && (editing ? body !== original : body.trim().length > 0);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const savingRef = useRef(false);
  savingRef.current = saving;

  // ------------------------------------------------------------------ loading

  const load = useCallback(async () => {
    if (!userId) return;
    setLoadFault(null);
    try {
      const [entry, draft] = await Promise.all([
        entryId ? getEntry(entryId) : Promise.resolve(null),
        readDraft(userId, slot),
      ]);
      if (entry) {
        setBase(entry);
        baseVersion.current = entry.version;
        titleRef.current = entry.title;
      }
      // Text typed while this loaded wins over anything stored.
      if (bodyRef.current.length === 0) {
        if (draft && draft.body !== (entry?.body ?? '')) {
          setBody(draft.body);
          setRestored(true);
          if (!entryId && draft.clientEntryId) clientEntryId.current = draft.clientEntryId;
          if (!entryId && !entryDate.current && isIsoDay(draft.entryDate)) entryDate.current = draft.entryDate;
          // An edit resumes from the version it was started on; if the server has moved on, saving asks.
          if (entryId && typeof draft.baseVersion === 'number') baseVersion.current = draft.baseVersion;
        } else if (entry) {
          setBody(entry.body);
        }
      }
      setReady(true);
    } catch (e) {
      setLoadFault(e instanceof JournalError ? e.kind : 'unknown');
    }
  }, [userId, entryId, slot]);

  useEffect(() => {
    void load();
  }, [load]);

  // ------------------------------------------------------------------- drafts

  const persist = useCallback(() => {
    if (!userId || finished.current || !ready) return;
    if (!dirtyRef.current) {
      void clearDraft(userId, slot);
      return;
    }
    void writeDraft(
      userId,
      slot,
      editing
        ? { body: bodyRef.current, baseVersion: baseVersion.current }
        : { body: bodyRef.current, clientEntryId: clientEntryId.current, entryDate: entryDate.current },
    );
  }, [userId, slot, editing, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(persist, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [body, ready, persist]);

  // The app going to the background, or this screen going away, writes at once.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') persist();
    });
    return () => {
      sub.remove();
      persist();
    };
  }, [persist]);

  // ------------------------------------------------------------------ leaving

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/journal');
  }, [router]);

  const onBack = useCallback(() => {
    if (savingRef.current) return true;
    if (dirtyRef.current && !finished.current) {
      setLeaving(true);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [onBack]);

  // The swipe-back gesture cannot ask a question, so it is off while there is something to lose.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty && !saving });
  }, [navigation, dirty, saving]);

  const discard = () => {
    finished.current = true;
    setLeaving(false);
    if (userId) void clearDraft(userId, slot);
    leave();
  };

  /** Throw the restored text away and start from what the server has (or from nothing). */
  const dropRestored = () => {
    setRestored(false);
    setBody(original);
    if (!editing) clientEntryId.current = uuidv4();
    else baseVersion.current = base?.version ?? baseVersion.current;
    if (userId) void clearDraft(userId, slot);
  };

  // ------------------------------------------------------------------- saving

  const send = async (text: string, expectedVersion: number): Promise<SaveResult> => {
    if (entryId) {
      return updateEntry({ id: entryId, expectedVersion, body: text, title: titleRef.current });
    }
    const made = await createEntry({ clientEntryId: clientEntryId.current, body: text, entryDate: entryDate.current });
    // A retry after a lost answer gets the entry the first attempt made. If the
    // text was changed in between, that entry still holds the older text.
    if (made.kind === 'ok' && made.entry.body !== text) {
      return updateEntry({ id: made.entry.id, expectedVersion: made.entry.version, body: text, title: made.entry.title });
    }
    return made;
  };

  const save = async (expectedVersion = baseVersion.current) => {
    setLeaving(false);
    const text = body.trim();
    if (!text) {
      setSubmitted(true);
      return;
    }
    if (saving || !userId) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await send(text, expectedVersion);
      if (res.kind === 'limit') {
        setNotice({ tone: 'warning', text: limitCopy(res) });
        return;
      }
      if (res.kind === 'conflict') {
        setConflict(res.entry);
        return;
      }
      finished.current = true;
      await clearDraft(userId, slot);
      const wantsShare = !editing && share;
      // No "saved" toast: landing back on the list with the entry in it is the confirmation.
      journalStore.saved(toSummary(res.entry), !editing, null);
      if (wantsShare) {
        await shareSaved(res.entry);
        return;
      }
      leave();
    } catch (e) {
      const kind = e instanceof JournalError ? e.kind : 'unknown';
      setNotice({
        tone: kind === 'offline' || kind === 'consent' ? 'warning' : 'error',
        text: saveFaultCopy(kind),
        settings: kind === 'consent',
      });
    } finally {
      setSaving(false);
    }
  };

  /** The entry is saved; now the share the switch asked for. Either way the editor is done. */
  const shareSaved = async (entry: Entry) => {
    try {
      const res = await shareEntry(entry.id);
      if (res.kind === 'ok') {
        journalStore.changed();
        router.dismissTo({ pathname: '/chat', params: { c: res.conversationId, opener: 'journal' } });
        return;
      }
      router.replace({ pathname: '/journal/[id]', params: { id: entry.id, notice: shareNoticeOf(res) } });
    } catch (e) {
      const kind = e instanceof JournalError ? e.kind : 'unknown';
      router.replace({ pathname: '/journal/[id]', params: { id: entry.id, notice: shareNoticeOf(kind) } });
    }
  };

  const loadNewer = () => {
    if (!conflict) return;
    setBase(conflict);
    baseVersion.current = conflict.version;
    titleRef.current = conflict.title;
    setBody(conflict.body);
    setConflict(null);
    setRestored(false);
    if (userId) void clearDraft(userId, slot);
  };

  const overwrite = () => {
    if (!conflict) return;
    const version = conflict.version;
    baseVersion.current = version;
    titleRef.current = conflict.title;
    setBase(conflict);
    setConflict(null);
    void save(version);
  };

  // ------------------------------------------------------------------- render

  const title = editing ? t('journal.editEntry') : t('journal.newEntry');
  const back = () => {
    if (!onBack()) leave();
  };

  if (!ready) {
    return (
      <Screen header={<TopBar onBack={leave} />}>
        <Text variant="title" center className="pt-xs">
          {title}
        </Text>
        {loadFault ? (
          <JournalFault kind={loadFault} onRetry={() => void load()} onBack={leave} />
        ) : (
          <EntrySkeleton className="pt-lg" />
        )}
      </Screen>
    );
  }

  const empty = body.trim().length === 0;
  const count = body.length;
  const atMax = count >= MAX_BODY_CHARS;

  return (
    <Screen
      avoidKeyboard
      footer={
        <LiquidButton
          title={t('common.save')}
          loading={saving}
          disabled={editing && !dirty}
          onPress={() => void save()}
        />
      }
      header={<TopBar onBack={back} />}>
      <Text variant="title" center className="pt-xs">
        {title}
      </Text>
      {editing && base ? (
        <Text variant="micro" tone="tertiary" center className="pt-xxs">
          {displayDay(base.entryDate)}
        </Text>
      ) : entryDate.current ? (
        <Text variant="micro" tone="tertiary" center className="pt-xxs">
          {t('journal.entryFor', { date: displayDay(entryDate.current) })}
        </Text>
      ) : null}

      {restored ? (
        <Banner
          tone="info"
          message={t('journal.draftRestored')}
          actionLabel={editing ? t('journal.draftDropChanges') : t('journal.draftStartOver')}
          onAction={dropRestored}
          onDismiss={() => setRestored(false)}
          className="mt-sm"
        />
      ) : null}
      {notice ? (
        <Banner
          tone={notice.tone}
          message={t(notice.text)}
          actionLabel={notice.settings ? t('chat.aiPausedAction') : undefined}
          onAction={notice.settings ? () => router.push('/settings') : undefined}
          onDismiss={() => setNotice(null)}
          className="mt-sm"
        />
      ) : null}

      {/* The card is the field, the same construction as the four onboarding
          questions and the feedback screen. */}
      <GlassCard className="mt-sm flex-1" padding="flex-1 px-md py-sm">
        <TextArea
          bare
          grow
          value={body}
          onChangeText={(next) => {
            setBody(next);
            if (submitted) setSubmitted(false);
          }}
          error={submitted && empty ? t('journal.entryRequired') : undefined}
          placeholder={t('journal.entryPlaceholder')}
          maxLength={MAX_BODY_CHARS}
          editable={!saving}
          autoFocus={!editing && !restored}
          className="flex-1"
        />
      </GlassCard>

      {count >= COUNTER_FROM ? (
        <View className="flex-row items-center justify-between pt-xxs">
          {atMax ? <InlineMessage tone="warning" message={t('journal.maxReached')} /> : <View />}
          <Text variant="micro" tone={atMax ? 'warning' : 'tertiary'}>
            {t('journal.counter', { count: formatNumber(count), max: formatNumber(MAX_BODY_CHARS) })}
          </Text>
        </View>
      ) : null}

      {editing ? (
        base?.sharedWithAi ? <InlineMessage tone="info" message={t('journal.sharedEditNote')} className="pt-xs" /> : null
      ) : (
        <Switch
          value={share}
          onChange={setShare}
          disabled={saving}
          label={t('journal.shareWithAi')}
          description={t('journal.shareHint')}
          className="mt-xs"
        />
      )}

      <Dialog
        visible={leaving}
        onClose={() => setLeaving(false)}
        title={editing ? t('journal.unsavedEditTitle') : t('journal.unsavedTitle')}
        message={t('journal.unsavedMessage')}
        confirmLabel={t('common.save')}
        onConfirm={() => void save()}
        cancelLabel={t('journal.discard')}
        onCancel={discard}
      />

      <Dialog
        visible={!!conflict}
        onClose={() => setConflict(null)}
        title={t('journal.conflictTitle')}
        message={t('journal.conflictMessage')}
        confirmLabel={t('journal.conflictOverwrite')}
        onConfirm={overwrite}
        cancelLabel={t('journal.conflictLoad')}
        onCancel={loadNewer}
      />
    </Screen>
  );
}
