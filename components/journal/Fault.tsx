import { useT } from '../../i18n';
import type { JournalErrorKind } from '../../lib/api/journal';
import { EmptyState, ErrorState, OfflineState } from '../ui';

/**
 * A journal screen that could not load. Offline and "this entry is gone" are
 * their own states, not a generic failure: the fix is different for each.
 */
export function JournalFault({
  kind,
  onRetry,
  onBack,
  compact,
  className,
}: {
  kind: JournalErrorKind;
  onRetry?: () => void;
  /** Where "this entry is gone" leads. */
  onBack?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  if (kind === 'offline') return <OfflineState onRetry={onRetry} compact={compact} className={className} />;
  if (kind === 'notFound') {
    return (
      <EmptyState
        title={t('journal.entryMissingTitle')}
        message={t('journal.entryMissingMessage')}
        actionLabel={onBack ? t('journal.backToJournal') : undefined}
        onAction={onBack}
        compact={compact}
        className={className}
      />
    );
  }
  if (kind === 'session') {
    return <ErrorState message={t('chat.errorSession')} compact={compact} className={className} />;
  }
  return <ErrorState onRetry={onRetry} compact={compact} className={className} />;
}
