import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useT, type Dictionary, type Path } from '../../i18n';
import { JournalError, restoreEntry } from '../../lib/api/journal';
import { actionFaultCopy, limitCopy } from '../../lib/journal/copy';
import { toSummary } from '../../lib/journal/format';
import { journalStore, type Flash, type JournalState } from '../../lib/journal/store';
import { Banner, Toast, cx, type Tone } from '../ui';

const FLASH: Record<Flash, Path<Dictionary>> = {
  saved: 'journal.saved',
  restored: 'journal.restored',
  unshared: 'journal.unshared',
  savedFromChat: 'journal.savedFromChat',
};

/** A toast pinned above the bottom edge of a screen. */
export function FloatingToast({
  message,
  tone,
  onHide,
}: {
  message: string | null;
  tone?: Tone;
  onHide: () => void;
}) {
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 px-gutter pb-xl">
      <Toast visible={!!message} tone={tone} message={message ?? ''} onHide={onHide} />
    </View>
  );
}

/** The one-off confirmation left by the last journal action ("saved", "restored"). */
export function JournalToast({ flash }: { flash: JournalState['flash'] }) {
  const t = useT();
  const hide = useCallback(() => journalStore.clearFlash(), []);
  return <FloatingToast message={flash ? t(FLASH[flash]) : null} onHide={hide} />;
}

/**
 * "The entry is deleted. Undo." Shown on the list the user lands on after a
 * delete, for as long as that screen stays open; the server keeps the entry
 * restorable for 24 hours.
 */
export function UndoDeleted({ deleted, className }: { deleted: JournalState['deleted']; className?: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Path<Dictionary> | null>(null);

  const undo = async () => {
    if (!deleted || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await restoreEntry(deleted.id);
      if (res.kind === 'ok') journalStore.restored(toSummary(res.entry));
      else setProblem(limitCopy(res));
    } catch (e) {
      const kind = e instanceof JournalError ? e.kind : 'unknown';
      if (kind === 'notFound') {
        // Past the 24 hours, or restored elsewhere: the offer is over either way.
        journalStore.dismissDeleted();
        setProblem('journal.restoreGone');
      } else {
        setProblem(actionFaultCopy(kind, 'journal.restoreFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!deleted) {
    return problem ? (
      <Banner tone="warning" message={t(problem)} onDismiss={() => setProblem(null)} className={className} />
    ) : null;
  }
  return (
    <View className={cx('gap-xs', className)}>
      <Banner
        tone="info"
        message={t('journal.deleted')}
        actionLabel={busy ? t('common.loading') : t('journal.undo')}
        onAction={() => void undo()}
        onDismiss={() => journalStore.dismissDeleted()}
      />
      {problem ? <Banner tone="warning" message={t(problem)} onDismiss={() => setProblem(null)} /> : null}
    </View>
  );
}
