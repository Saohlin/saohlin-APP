import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { space, type as typeScale, useTheme } from '../../theme';
import { IconButton } from './Button';
import { Text } from './Text';
import { cx } from './cx';
import { GLASS_EDGE, SHEEN, SHEEN_STOPS } from './glass';
import { useT } from '../../i18n';

const SEND_SIZE = 42;

/**
 * Composer geometry: a rounded pane with the message on its own full-width row
 * and the controls beneath, growing a line at a time. COMPOSER_LINE is read from
 * `type.chat`, so changing the chat leading updates everything here.
 */
const COMPOSER_LINE = typeScale.chat.lineHeight ?? 21;
/** Field's vertical padding (in the style object, not a class). */
const COMPOSER_PAD = space.xxs;
/** Max lines before the field stops growing and scrolls. */
const COMPOSER_MAX_LINES = 7;
/** Lines before the expand control appears. */
const COMPOSER_REVEAL_LINES = 3;
/** Max share of the window the expanded field may take. */
const COMPOSER_OPEN_SHARE = 0.7;
/**
 * Space the expanded field must leave for the other rows, padding and safe
 * areas (~195 pt on a 393 × 852 phone, rounded up).
 */
const COMPOSER_OPEN_RESERVE = 200;

/** How much of the window the keyboard is covering, live. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', (e) =>
      setHeight(e.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export type Sender = 'user' | 'ai';

/**
 * A chat message. Reply length varies a lot by design and the first reply is
 * often a question, so don't lay out around long replies.
 * Same gradient for both senders; the user's bubble is capped at 78% width.
 */
export function ChatBubble({
  sender,
  text,
  label,
  onListen,
  onCopy,
  showActions,
  className,
}: {
  sender: Sender;
  text: string;
  /** Sender label override; the chat passes the user's display name. */
  label?: string;
  onListen?: () => void;
  onCopy?: () => void;
  showActions?: boolean;
  className?: string;
}) {
  const t = useT();
  const { colors, gradients, shadow } = useTheme();
  const mine = sender === 'user';
  const who = mine ? (label?.trim() || t('chat.you')) : t('brand.ai');
  return (
    <View className={cx('w-full', mine ? 'items-end' : 'items-start', className)}>
      {/* Wrapper shrink-wraps the bubble so the label aligns to the bubble's leading
         edge, and carries the 78% max width. */}
      <View className={cx('items-start', mine ? 'max-w-[78%]' : 'w-full')}>
        <Text variant="label" tone="purple" className="mb-xs px-xxs">
          {who}
        </Text>
        <View
          accessibilityRole="text"
          accessibilityLabel={`${who}: ${text}`}
          style={[shadow.sm, GLASS_EDGE]}
          className={cx(
            'overflow-hidden rounded-card',
            // Solid background under the gradient: Android needs it for `elevation` to cast a shadow.
            mine ? 'bg-bubble-user' : 'w-full bg-bubble-ai',
          )}>
          <LinearGradient
            colors={gradients.bubble as [string, string, ...string[]]}
            locations={gradients.bubbleStops as [number, number, ...number[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={SHEEN as unknown as [string, string, ...string[]]}
            locations={SHEEN_STOPS as unknown as [number, number, ...number[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Actions sit on the first line of the reply, top right. */}
          <View className="flex-row items-start gap-sm p-md">
            {/* `flex-1` in the AI bubble (fixed width), `shrink` in the user bubble:
               flex-basis 0 inside a shrink-wrapped bubble would collapse it to nothing. */}
            <Text variant="chat" className={mine ? 'shrink' : 'flex-1'}>
              {text}
            </Text>
            {!mine && showActions ? (
              <View className="-mr-xxs -mt-xxs flex-row gap-xs">
                <IconButton
                  variant="plain"
                  size={28}
                  iconSize={17}
                  iconColor={colors.textSecondary}
                  name="speaker"
                  label={t('chat.listen')}
                  onPress={onListen}
                />
                <IconButton
                  variant="plain"
                  size={28}
                  iconSize={17}
                  iconColor={colors.textSecondary}
                  name="copy"
                  label={t('chat.copy')}
                  onPress={onCopy}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

/** "CLAUDIA AI přemýšlí…" typing indicator. `label` replaces the copy (it changes after 4 s). */
export function TypingIndicator({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  const { shadow } = useTheme();
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 380, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.delay(480 - i * 160),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('chat.thinking')}
      style={[shadow.sm, GLASS_EDGE]}
      className={cx('flex-row items-center gap-xs self-start rounded-card bg-bubble-ai px-sm py-xs', className)}>
      <View className="flex-row gap-[3px]">
        {dots.map((d, i) => (
          <Animated.View key={i} style={{ opacity: d }} className="h-[5px] w-[5px] rounded-pill bg-accent" />
        ))}
      </View>
      <Text variant="micro" tone="tertiary">
        {label ?? t('chat.thinking')}
      </Text>
    </View>
  );
}

/**
 * Message composer, three rows: an expand control (only when the message
 * overflows), the text field at full width, then dictation and send.
 *
 * Height is measured rather than clamped by class; one line is measured too,
 * because iOS and Android disagree on whether contentSize includes padding.
 */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onMic,
  recording,
  disabled,
  sendDisabled,
  placeholder,
  className,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onMic?: () => void;
  recording?: boolean;
  disabled?: boolean;
  /** Typing stays possible, sending waits (a reply is in flight). */
  sendDisabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const { colors, shadow } = useTheme();
  const t = useT();
  const canSend = value.trim().length > 0 && !disabled && !sendDisabled;

  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();

  /** What the text measures. A line count misses wrapped lines. */
  const [content, setContent] = useState(0);
  /** Measured height of one line on this platform. */
  const oneLine = useRef(0);
  /** Opened by the expand control. */
  const [open, setOpen] = useState(false);

  /** Reset height on send; onContentSizeChange doesn't reliably fire on a programmatic clear. */
  useEffect(() => {
    if (value.length === 0) {
      setContent(oneLine.current);
      setOpen(false);
    }
  }, [value]);

  const base = oneLine.current || COMPOSER_LINE + COMPOSER_PAD * 2;
  /**
   * Fallback height from hard line breaks, for Android builds where
   * onContentSizeChange stops firing on a multiline field with an explicit height.
   */
  const typed = base + COMPOSER_LINE * Math.min(value.split('\n').length - 1, COMPOSER_MAX_LINES - 1);
  const wanted = Math.max(content, typed);

  const grown = base + COMPOSER_LINE * (COMPOSER_MAX_LINES - 1);
  /** When expanded, the field uses the full tall box regardless of content. */
  const opened = Math.max(
    grown,
    Math.min(
      Math.round(windowHeight * COMPOSER_OPEN_SHARE),
      windowHeight - keyboard - COMPOSER_OPEN_RESERVE,
    ),
  );

  const height = open ? opened : Math.min(wanted, grown);

  /**
   * Grows upwards: the composer's bottom is pinned, and `shrink` lets the
   * conversation above give up space instead of pushing the field off screen.
   */
  const canOpen = open || wanted > base + COMPOSER_LINE * (COMPOSER_REVEAL_LINES - 1);

  return (
    <View
      style={[shadow.sm, GLASS_EDGE]}
      className={cx(
        // Rounded rectangle (radius.card, same as the bubbles) with the same glass
        // treatment: lit top edge, violet shade at the bottom and a shadow.
        'w-full overflow-hidden rounded-card bg-glass/glass px-md pb-xxs pt-xs',
        disabled && 'opacity-60',
        className,
      )}>
      <LinearGradient
        colors={SHEEN as unknown as [string, string, ...string[]]}
        locations={SHEEN_STOPS as unknown as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {canOpen ? (
        <View className="flex-row justify-end">
          <IconButton
            variant="plain"
            size={30}
            iconSize={21}
            iconWeight="regular"
            iconColor={colors.accentStrong}
            name={open ? 'collapse' : 'expand'}
            label={t(open ? 'chat.collapseComposer' : 'chat.expandComposer')}
            onPress={() => setOpen((o) => !o)}
          />
        </View>
      ) : null}

      <TextInput
        multiline
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={(e) => {
          const h = Math.ceil(e.nativeEvent.contentSize.height);
          if (value.length === 0 || oneLine.current === 0) oneLine.current = h;
          setContent(h);
        }}
        editable={!disabled}
        placeholder={placeholder ?? t('chat.composerPlaceholder')}
        placeholderTextColor={colors.textDisabled}
        selectionColor={colors.accent}
        accessibilityLabel={t('chat.composerPlaceholder')}
        style={{ height, paddingTop: COMPOSER_PAD, paddingBottom: COMPOSER_PAD }}
        className="w-full font-sans text-chat text-ink"
      />

      <View className="flex-row items-center justify-end gap-xs">
        {/* Bare glyphs inside the pane. */}
        {onMic ? (
          <IconButton
            variant="plain"
            size={40}
            iconSize={27}
            iconColor={recording ? colors.errorFg : colors.textSecondary}
            name="mic"
            label={t(recording ? 'chat.stopRecording' : 'chat.voiceInput')}
            onPress={onMic}
          />
        ) : null}
        {/* Send uses the standard IconButton, without dimming when disabled. */}
        <IconButton
          variant="accent"
          size={SEND_SIZE}
          iconSize={17}
          name="send"
          label={t('chat.send')}
          onPress={onSend}
          disabled={!canSend}
          dimWhenDisabled={false}
        />
      </View>
    </View>
  );
}
