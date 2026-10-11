import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { fonts, useTheme } from '../../theme';
import { LiquidButton } from './LiquidButton';
import { SecondaryButton, IconButton } from './Button';
import { Text } from './Text';
import { cx } from './cx';
import { SHEEN, SHEEN_STOPS } from './glass';
import { useT } from '../../i18n';

/** The dim behind a sheet or dialog. Tapping it dismisses, unless blocking. */
export function Scrim({ onPress, className }: { onPress?: () => void; className?: string }) {
  const { scrim } = useTheme();
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('a11y.close')}
      onPress={onPress}
      style={{ backgroundColor: scrim }}
      className={cx('absolute inset-0', className)}
    />
  );
}

/**
 * Gradient and sheen layers shared by every modal surface, so sheets match the
 * glass cards and bubbles. Both are absolutely positioned and don't affect size.
 */
function GlassCoats() {
  const { gradients } = useTheme();
  return (
    <>
      <LinearGradient
        colors={gradients.bubble as [string, string, ...string[]]}
        locations={gradients.bubbleStops as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={SHEEN as unknown as [string, string, ...string[]]}
        locations={SHEEN_STOPS as unknown as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </>
  );
}

/** Bottom sheet: pickers, the guide detail, anything that keeps context. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  className,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const { shadow } = useTheme();
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Scrim onPress={onClose} />
        <View
          style={shadow.xl}
          className={cx(
            'w-full overflow-hidden rounded-t-sheet border-t border-edge bg-surface',
            className,
          )}>
          <GlassCoats />
          <View className="px-gutter pb-xl pt-sm">
            <View className="mb-sm h-[4px] w-[36px] self-center rounded-pill bg-edge" />
            {title ? (
              <View className="mb-sm flex-row items-center justify-between">
                <Text variant="title">{title}</Text>
                <IconButton name="close" label={t('a11y.close')} onPress={onClose} size={34} />
              </View>
            ) : null}
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Confirmation for irreversible actions (delete account, clear memory, etc.).
 * The destructive label names the action, never "OK".
 */
export function Dialog({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  destructive,
  busy,
  plainCancel,
  className,
}: {
  /** Cancel as bold text under the single button, instead of a second button. */
  plainCancel?: boolean;
  visible: boolean;
  /** Tapping outside, or the system back button: always the harmless way out. */
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  /** What the second button does, when it is a choice of its own and not "close". Defaults to `onClose`. */
  onCancel?: () => void;
  destructive?: boolean;
  /** The confirmed action is running: both buttons wait. */
  busy?: boolean;
  className?: string;
}) {
  const { shadow, colors } = useTheme();
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center px-gutter">
        <Scrim onPress={onClose} />
        <View
          accessibilityViewIsModal
          style={shadow.xl}
          className={cx(
            'w-full max-w-[340px] overflow-hidden rounded-card border border-edge bg-surface',
            className,
          )}>
          <GlassCoats />
          <View className="gap-sm p-lg">
            <Text variant="title" center>
              {title}
            </Text>
            {message ? (
              <Text variant="caption" center>
                {message}
              </Text>
            ) : null}
            <View className="gap-xs pt-xs">
              {destructive ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!busy, busy: !!busy }}
                  disabled={busy}
                  onPress={onConfirm}
                  className={cx(
                    'h-[52px] items-center justify-center rounded-pill bg-error-solid active:opacity-90',
                    busy && 'opacity-60',
                  )}>
                  {/* Colour set inline: the variant's own ink class would otherwise win
                     over a colour class, leaving dark text on the red button. */}
                  <Text variant="button" style={{ color: colors.errorOn }}>
                    {confirmLabel}
                  </Text>
                </Pressable>
              ) : (
                <LiquidButton title={confirmLabel} onPress={onConfirm} loading={busy} />
              )}
              {plainCancel ? (
                // One button only: the way out is a bold line of text under it.
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!busy }}
                  disabled={busy}
                  hitSlop={8}
                  onPress={onCancel ?? onClose}
                  // Tight to the button above, and pulled into the card's bottom padding so
                  // the text does not float in a gap of its own.
                  className={cx('-mb-xs items-center pt-xxs active:opacity-60', busy && 'opacity-45')}>
                  <Text variant="bodyMedium" tone="secondary" style={{ fontFamily: fonts.bodySemibold }}>
                    {cancelLabel ?? t('common.cancel')}
                  </Text>
                </Pressable>
              ) : (
                <SecondaryButton
                  title={cancelLabel ?? t('common.cancel')}
                  onPress={onCancel ?? onClose}
                  disabled={busy}
                  haptic={false}
                />
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
