import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { LOCALES, useI18n } from '../../i18n';
import { useTheme } from '../../theme';
import { LiquidButton } from './LiquidButton';
import { Sheet } from './Overlay';

/**
 * Date picker hook. iOS shows the wheel in a sheet with a confirm button (the
 * spinner reports every value it scrolls past); Android opens the Material dialog.
 *
 *   const dob = useDatePicker({ value, onChange, title });
 *   <DateField onPress={dob.open} />
 *   {dob.picker}
 *
 * Dates cross this boundary as ISO `YYYY-MM-DD` built from local calendar parts,
 * so a UTC round-trip can't shift a birthday by a day.
 */
export type DatePickerOptions = {
  /** ISO `YYYY-MM-DD`, or undefined when nothing has been chosen yet. */
  value?: string;
  onChange: (iso: string) => void;
  /** Sheet title on iOS; ignored by the Android dialog, which titles itself. */
  title: string;
  /** Where the wheel opens when there is no value. A birth year, not today. */
  initial?: Date;
  minimumDate?: Date;
  maximumDate?: Date;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromIsoDate(iso: string | undefined): Date | undefined {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

export function useDatePicker({
  value,
  onChange,
  title,
  initial,
  minimumDate,
  maximumDate,
}: DatePickerOptions): { open: () => void; picker: ReactNode } {
  const { lang, t } = useI18n();
  const { colors, scheme } = useTheme();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);

  const start = () => fromIsoDate(value) ?? initial ?? new Date(1990, 0, 1);

  const open = () => {
    if (Platform.OS === 'android') {
      // `onValueChange` fires only on a real selection (`onChange` is deprecated
      // and also fires on dismissal).
      DateTimePickerAndroid.open({
        value: start(),
        mode: 'date',
        minimumDate,
        maximumDate,
        onValueChange: (_, date) => {
          if (date) onChange(toIsoDate(date));
        },
      });
      return;
    }
    setDraft(start());
    setVisible(true);
  };

  const picker =
    Platform.OS === 'android' ? null : (
      <Sheet visible={visible} onClose={() => setVisible(false)} title={title}>
        <View className="items-center">
          <DateTimePicker
            value={draft ?? start()}
            mode="date"
            display="spinner"
            locale={LOCALES[lang]}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            // Without this the iOS wheel ignores the theme.
            textColor={colors.text}
            themeVariant={scheme === 'dark' ? 'dark' : 'light'}
            onValueChange={(_, date) => date && setDraft(date)}
          />
        </View>
        {/* Confirming the date is the sheet's primary action. */}
        <View className="pt-md">
          <LiquidButton
            title={t('common.done')}
            onPress={() => {
              if (draft) onChange(toIsoDate(draft));
              setVisible(false);
            }}
          />
        </View>
      </Sheet>
    );

  return { open, picker };
}
