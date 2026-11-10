import { Pressable, View } from 'react-native';

import { haptic } from '../../lib/haptics';
import { MARKS, type Mark } from '../../lib/api/marks';
import { useT } from '../../i18n';
import { Text } from './Text';
import { TextButton } from './Button';
import { cx } from './cx';

const LABEL: Record<Mark, 'marks.right' | 'marks.tooGeneric' | 'marks.shouldHaveAsked' | 'marks.wrongGuide'> = {
  right: 'marks.right',
  too_generic: 'marks.tooGeneric',
  should_have_asked: 'marks.shouldHaveAsked',
  wrong_guide: 'marks.wrongGuide',
};

/**
 * Claudia's four marks under a finished answer (testing mode, C6). Shown only
 * on tester accounts. Each chip saves on tap; the note opens a sheet.
 */
export function AnswerMarks({
  marks,
  note,
  onToggle,
  onNote,
  className,
}: {
  marks: Mark[];
  note: string | null;
  onToggle: (mark: Mark) => void;
  onNote: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <View className={cx('w-full gap-xs pt-xs', className)}>
      <View accessibilityRole="toolbar" accessibilityLabel={t('marks.label')} className="flex-row flex-wrap gap-xs">
        {MARKS.map((m) => {
          const on = marks.includes(m);
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t(LABEL[m])}
              hitSlop={4}
              onPress={() => {
                haptic.tap();
                onToggle(m);
              }}
              className={cx(
                'rounded-pill border px-sm py-xxs active:opacity-80',
                on ? 'border-edge-focus bg-selected' : 'border-edge bg-surface',
              )}>
              <Text variant="caption" tone={on ? 'accent' : 'secondary'}>
                {t(LABEL[m])}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {marks.length > 0 ? (
        <View className="flex-row items-start gap-xs">
          {note ? (
            <Text variant="caption" tone="secondary" className="flex-1" numberOfLines={2}>
              {note}
            </Text>
          ) : null}
          <TextButton title={t(note ? 'marks.editNote' : 'marks.addNote')} onPress={onNote} />
        </View>
      ) : null}
    </View>
  );
}
