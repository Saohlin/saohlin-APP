import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { cx } from './cx';

/**
 * Screen container. Screens have no background of their own: MeshBackdrop is
 * painted once at the root so the app reads as one surface. A screen that must
 * cover it (full-bleed video) does so in its own file.
 */

export type ScreenProps = {
  children: ReactNode;
  /** Turn off the 26 pt horizontal inset when a child needs to bleed. */
  padded?: boolean;
  scroll?: boolean;
  edges?: readonly Edge[];
  className?: string;
  /** Pinned to the bottom, outside the scroll area — the CTA lives here. */
  footer?: ReactNode;
  /**
   * Lifts content and footer above the keyboard. Off by default; the chat turns it on.
   * iOS only uses padding; Android already resizes the window.
   */
  avoidKeyboard?: boolean;
};

export function Screen({
  children,
  padded = true,
  scroll = false,
  edges = ['top', 'bottom'],
  className,
  footer,
  avoidKeyboard = false,
}: ScreenProps) {
  const { scheme } = useTheme();

  const Inner = scroll ? ScrollView : View;
  const innerProps = scroll
    ? {
        className: 'flex-1 shrink',
        contentContainerClassName: cx('grow', padded && 'px-gutter pb-lg'),
        keyboardShouldPersistTaps: 'handled' as const,
      }
    : { className: cx('flex-1 shrink', padded && 'px-gutter pb-lg') };

  const body = (
    <>
      <Inner {...(innerProps as object)}>{children}</Inner>
      {/* Footer keeps its own height and the content yields space, so a growing
         footer (the expanded composer) extends upwards from a pinned bottom edge. */}
      {footer ? (
        <View className={cx(padded && 'px-gutter', 'shrink-0 pt-sm')}>{footer}</View>
      ) : null}
    </>
  );

  return (
    <View className="flex-1">
      <SafeAreaView edges={edges} className={cx('flex-1', className)}>
        {avoidKeyboard ? (
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </SafeAreaView>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

/** A hairline. Use `strong` only where two unrelated regions meet. */
export function Divider({
  strong,
  className,
  ...rest
}: ViewProps & { strong?: boolean; className?: string }) {
  return <View className={cx('h-px w-full', strong ? 'bg-edge' : 'bg-edge-subtle', className)} {...rest} />;
}

/** Vertical rhythm helper for the common "title, then body" block. */
export function Section({ className, ...rest }: ViewProps & { className?: string }) {
  return <View className={cx('gap-sm', className)} {...rest} />;
}
