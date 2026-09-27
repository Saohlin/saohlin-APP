import { Pressable, View } from 'react-native';

import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import type { Dictionary, Path } from '../../i18n';
import { Text } from './Text';
import { cx } from './cx';

const KEYS: Array<Path<Dictionary>> = [
  'weekday.mon',
  'weekday.tue',
  'weekday.wed',
  'weekday.thu',
  'weekday.fri',
  'weekday.sat',
  'weekday.sun',
];

/** Monday of the week containing `d`. Czech weeks start on Monday. */
function mondayOf(d: Date) {
  const out = new Date(d);
  const shift = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - shift);
  out.setHours(0, 0, 0, 0);
  return out;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Monday-to-Sunday week strip with the selected day highlighted and a dot on
 * days that have entries. Computes real dates so month boundaries work.
 */
export function WeekStrip({
  selected,
  onSelect,
  marked = [],
  today = new Date(),
  className,
}: {
  selected?: Date;
  onSelect?: (day: Date) => void;
  /** Days that already have an entry. */
  marked?: Date[];
  today?: Date;
  className?: string;
}) {
  const { colors } = useTheme();
  const t = useT();
  const start = mondayOf(today);
  const active = selected ?? today;

  return (
    <View className={cx('w-full flex-row justify-between', className)}>
      {KEYS.map((key, i) => {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        const on = sameDay(day, active);
        const hasEntry = marked.some((m) => sameDay(m, day));

        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${t(key)} ${day.getDate()}`}
            onPress={() => onSelect?.(day)}
            className="items-center gap-xxs px-xxs active:opacity-70">
            <Text variant="label" tone={on ? 'secondary' : 'tertiary'}>
              {t(key)}
            </Text>
            <View
              className={cx(
                'h-[34px] w-[34px] items-center justify-center rounded-cell',
                // `selected` is too close to the glass card fill, so the border colour is used.
                on && 'bg-edge',
              )}>
              <Text variant="caption" tone="default">
                {day.getDate()}
              </Text>
            </View>
            <View
              className="h-[4px] w-[4px] rounded-pill"
              style={{ backgroundColor: hasEntry ? colors.accent : 'transparent' }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
