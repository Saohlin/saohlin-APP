import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View, type ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { space, withAlpha, z } from '../../theme/layout';
import { cx } from './cx';

/**
 * Screen container. Screens have no background of their own: MeshBackdrop is
 * painted once at the root so the app reads as one surface. A screen that must
 * cover it (full-bleed video) does so in its own file.
 */

/** Height of the TopBar row inside the pinned header. Keep in step with `TopBar`. */
export const HEADER_HEIGHT = 44;
/** How far the header's veil keeps fading below the bar. */
const HEADER_FADE = space.xxl + space.md;

/**
 * Top padding that clears the pinned header, for screens that own their
 * scroller (`headerInset={false}`): put it on the scroller's content container
 * so the content starts below the bar and scrolls up behind it.
 */
export function useHeaderInset() {
  const { top } = useSafeAreaInsets();
  return top + HEADER_HEIGHT + space.xs;
}

/** True while the software keyboard is up. For footers that should slim down above it. */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // iOS announces the keyboard before it moves, so layout changes ride its animation.
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

export type ScreenProps = {
  children: ReactNode;
  /**
   * The screen's top bar (normally a `TopBar`). Pinned at the top over a very
   * light veil while the content scrolls behind it, unless `pinHeader` is off.
   */
  header?: ReactNode;
  /**
   * Off for the chat: the header is laid out in normal flow above the content,
   * with no veil and nothing scrolling behind it.
   */
  pinHeader?: boolean;
  /**
   * Pads the content so it starts below the pinned header. On by default; a
   * screen with its own scroller turns it off and applies `useHeaderInset()` there.
   */
  headerInset?: boolean;
  /** Turn off the 26 pt horizontal inset when a child needs to bleed. */
  padded?: boolean;
  scroll?: boolean;
  edges?: readonly Edge[];
  className?: string;
  /**
   * Pinned to the bottom, outside the scroll area — the CTA lives here. On a
   * `scroll` screen it moves to the end of the scrolling content while the
   * keyboard is open.
   */
  footer?: ReactNode;
  /**
   * Lifts content and footer above the keyboard. On by default, so any screen
   * with a field is safe; it does nothing on a screen without one.
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
  avoidKeyboard = true,
  header,
  pinHeader = true,
  headerInset = true,
}: ScreenProps) {
  const { scheme, mesh } = useTheme();
  const insets = useSafeAreaInsets();
  const inset = useHeaderInset();
  const keyboardUp = useKeyboardVisible();
  // Only a scrolling screen can take its footer into the scroller. A fixed screen
  // (the chat, the journal editor) keeps it above the keyboard: there is nowhere to scroll to.
  const footerInScroll = scroll && keyboardUp && !!footer;
  const pinned = !!header && pinHeader;
  const top = pinned && headerInset ? { paddingTop: inset } : undefined;
  // With a pinned header the screen runs to the top edge, so content can pass under the bar.
  const safeEdges = pinned ? edges.filter((e) => e !== 'top') : edges;

  const Inner = scroll ? ScrollView : View;
  const innerProps = scroll
    ? {
        className: 'flex-1 shrink',
        contentContainerClassName: cx('grow', padded && 'px-gutter pb-lg'),
        contentContainerStyle: top,
        // A tap on empty space or a drag puts the keyboard away; a tap on a
        // button still lands on the button.
        keyboardShouldPersistTaps: 'handled' as const,
        keyboardDismissMode: (Platform.OS === 'ios' ? 'interactive' : 'on-drag') as 'interactive' | 'on-drag',
        // Keeps the focused field above the keyboard when it opens.
        automaticallyAdjustKeyboardInsets: !avoidKeyboard,
      }
    : { className: cx('flex-1 shrink', padded && 'px-gutter pb-lg'), style: top };

  const body = (
    <>
      {scroll ? (
        <Inner {...(innerProps as object)}>
          {header && !pinned ? padded ? header : <View className="px-gutter">{header}</View> : null}
          {children}
          {/* While typing, the footer is the last thing in the scroller, reached by
             scrolling, instead of riding up to sit on top of the keyboard. */}
          {footerInScroll ? <View className={cx(!padded && 'px-gutter', 'shrink-0 pt-lg')}>{footer}</View> : null}
        </Inner>
      ) : (
        // No scroller to catch the tap, so the screen itself puts the keyboard
        // away when empty space is touched. Hidden from screen readers: it is not a control.
        <Pressable accessible={false} onPress={Keyboard.dismiss} className="flex-1 shrink">
          <Inner {...(innerProps as object)}>
            {header && !pinned ? padded ? header : <View className="px-gutter">{header}</View> : null}
            {children}
          </Inner>
        </Pressable>
      )}
      {/* Footer keeps its own height and the content yields space, so a growing
         footer (the expanded composer) extends upwards from a pinned bottom edge. */}
      {footer && !footerInScroll ? (
        // With the keyboard up the home-indicator inset is gone, so the footer would
        // sit flush on the keyboard; a small gap keeps the field or button off it.
        <View className={cx(padded && 'px-gutter', 'shrink-0 pt-sm', keyboardUp && 'pb-xs')}>{footer}</View>
      ) : null}
    </>
  );

  return (
    <View className="flex-1">
      <SafeAreaView edges={safeEdges} className={cx('flex-1', className)}>
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
      {pinned ? (
        // Drawn after the content, so it sits on top. Touches outside the
        // buttons fall through to the scroller underneath.
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: z.header }}>
          {/* The veil: a light wash behind the bar, fading out below it. It uses the
             backdrop's own base colour, so it reads as haze rather than a white band. */}
          <LinearGradient
            pointerEvents="none"
            // Eased, not linear: strong at the top, already thinning behind the bar,
            // then a long soft tail, so there is no visible lower edge.
            colors={[0.8, 0.72, 0.5, 0.22, 0.07, 0].map((a) => withAlpha(mesh.base, a)) as [string, string, ...string[]]}
            locations={(() => {
              const bar = insets.top + HEADER_HEIGHT;
              const all = bar + HEADER_FADE;
              return [0, (bar * 0.55) / all, bar / all, (bar + HEADER_FADE * 0.4) / all, (bar + HEADER_FADE * 0.75) / all, 1] as [number, number, ...number[]];
            })()}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View pointerEvents="box-none" className="px-gutter" style={{ paddingTop: insets.top, paddingBottom: HEADER_FADE }}>
            {header}
          </View>
        </View>
      ) : null}
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
