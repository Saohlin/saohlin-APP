import { View } from 'react-native';

import { useT } from '../../i18n';
import type { EntrySummary } from '../../lib/api/journal';
import { displayDay, displayTime } from '../../lib/journal/format';
import { JournalRow, Skeleton, cx } from '../ui';

/** Gap between entry rows, on the Deník screen and in the archive alike. */
export const ROW_GAP = 20;

/** One entry in a list. `text` replaces the excerpt (a search hit shows where it matched). */
export function EntryRow({
  entry,
  text,
  onPress,
}: {
  entry: EntrySummary;
  text?: string | null;
  onPress: () => void;
}) {
  const t = useT();
  return (
    <JournalRow
      date={displayDay(entry.entryDate)}
      excerpt={text || entry.title || entry.excerpt}
      time={displayTime(entry.createdAt)}
      shared={entry.sharedWithAi}
      statusLabel={entry.sharedWithAi ? t('journal.shared') : t('journal.private')}
      onPress={onPress}
    />
  );
}

/** Rows in the shape of `EntryRow` while a list loads. */
export function EntryRowsSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  const t = useT();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      style={{ gap: ROW_GAP }}
      className={cx('w-full', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          className="w-full flex-row items-center gap-sm rounded-card border border-edge-subtle px-sm py-sm">
          <View className="flex-1 gap-xs">
            <Skeleton width={72} height={9} />
            <Skeleton width={i % 2 ? '70%' : '90%'} height={12} />
          </View>
          <Skeleton width={30} height={9} />
        </View>
      ))}
    </View>
  );
}

/** The read screen while the entry loads. */
export function EntrySkeleton({ className }: { className?: string }) {
  const t = useT();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      className={cx('w-full gap-sm', className)}>
      <Skeleton width={110} height={10} />
      <Skeleton width={150} height={10} />
      <View className="gap-xs pt-sm">
        <Skeleton width="96%" />
        <Skeleton width="88%" />
        <Skeleton width="92%" />
        <Skeleton width="61%" />
      </View>
    </View>
  );
}
