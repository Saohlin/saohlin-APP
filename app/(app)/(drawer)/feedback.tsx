import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Keyboard, Linking, Pressable, View } from 'react-native';

import { useSession } from '../../../auth';
import {
  Banner,
  GlassCard,
  Icon,
  InlineMessage,
  LiquidButton,
  Screen,
  Text,
  TextArea,
  TextButton,
  TopBar,
  useKeyboardVisible,
  type Tone,
} from '../../../components/ui';
import { useI18n, type Dictionary, type Path } from '../../../i18n';
import { FEEDBACK_COUNTER_FROM, MAX_FEEDBACK_CHARS, sendFeedback } from '../../../lib/api/feedback';
import { JournalError, type JournalErrorKind } from '../../../lib/api/journal';
import { uuidv4 } from '../../../lib/chat/uuid';
import { clearFeedbackDraft, readFeedbackDraft, writeFeedbackDraft } from '../../../lib/feedback/draft';
import { haptic } from '../../../lib/haptics';
import { capsule, useTheme } from '../../../theme';

/**
 * Feedback: heading, short intro, a text field that fills the rest of the
 * screen, the send button, and an email alternative below.
 *
 * Sending is meant to be felt. On the press the card is picked up and the
 * button says it is sending; when the server has the message the card leaves
 * upwards, the phone gives its "done" tap and a thank-you takes the card's
 * place. If the send fails the card is put back down with the text untouched
 * and a sentence says why.
 *
 * What it guarantees:
 *  - Nothing typed is lost: the text is kept encrypted on the phone until it
 *    is sent, so leaving the screen or losing the connection costs nothing.
 *  - A retry is the same message, not a second one (one id per text).
 */
const EMAIL = 'info@saohlin.com';
/** Heart icon size under the heading. */
const HEART = 31;
/** The heart of the thank-you, and the ring that spreads from it. */
const SENT_HEART = 56;
const RING = 96;
/** The draft is written this long after the last keystroke. */
const DRAFT_DELAY_MS = 600;
/** A send is shown for at least this long, so a fast answer does not flicker past. */
const MIN_SENDING_MS = 450;
/** How far the card travels as it leaves. */
const FLY_DISTANCE = 96;

type Phase = 'write' | 'sending' | 'sent';
type Notice = { tone: Tone; text: Path<Dictionary> };

const faultNotice = (kind: JournalErrorKind): Notice =>
  kind === 'offline'
    ? { tone: 'warning', text: 'feedback.sendOffline' }
    : kind === 'session'
      ? { tone: 'warning', text: 'chat.errorSession' }
      : { tone: 'error', text: 'feedback.sendFailed' };

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export default function Feedback() {
  const { t, formatNumber } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.userId ?? null;
  const keyboardUp = useKeyboardVisible();

  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>('write');
  /** Set on a press with nothing written. The button is never disabled; an empty message shows a field error. */
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The stored draft has been looked at; only then may a draft be written. */
  const [ready, setReady] = useState(false);

  const messageRef = useRef('');
  messageRef.current = message;
  /** The last send attempt. The same text goes out under the same id, so a retry is not a second message. */
  const attempt = useRef<{ id: string; text: string } | null>(null);
  const mounted = useRef(true);
  const reduceMotion = useRef(false);

  /** 0 resting, 1 picked up (sending). */
  const lift = useRef(new Animated.Value(0)).current;
  /** 0 here, 1 gone (sent). */
  const fly = useRef(new Animated.Value(0)).current;
  /** The thank-you coming in: the heart, the ring around it, then the words. */
  const pop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const words = useRef(new Animated.Value(0)).current;

  const canSend = message.trim().length > 0;
  const sending = phase === 'sending';
  const count = message.length;
  const atMax = count >= MAX_FEEDBACK_CHARS;

  useEffect(() => {
    mounted.current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      reduceMotion.current = on;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      reduceMotion.current = on;
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, []);

  // -------------------------------------------------------------------- draft

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readFeedbackDraft(userId).then((body) => {
      if (!live) return;
      // Text typed while this loaded wins over anything stored.
      if (body && messageRef.current.length === 0) setMessage(body);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  const persist = useCallback(() => {
    if (userId && ready) void writeFeedbackDraft(userId, messageRef.current);
  }, [userId, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(persist, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [message, ready, persist]);

  // The app going to the background, or this screen going away, writes at once.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') persist();
    });
    return () => {
      sub.remove();
      persist();
    };
  }, [persist]);

  // ------------------------------------------------------------------ sending

  const settle = (value: Animated.Value, toValue: number) =>
    Animated.spring(value, { toValue, damping: 16, stiffness: 240, mass: 0.7, useNativeDriver: true });

  /** The message is with the server: the card leaves, the thank-you arrives. */
  const celebrate = () => {
    haptic.success();
    const arrive = () => {
      if (!mounted.current) return;
      setPhase('sent');
      setMessage('');
      AccessibilityInfo.announceForAccessibility(t('feedback.sent'));
      if (reduceMotion.current) {
        pop.setValue(1);
        Animated.timing(words, { toValue: 1, duration: 160, useNativeDriver: true }).start();
        return;
      }
      Animated.parallel([
        Animated.spring(pop, { toValue: 1, damping: 9, stiffness: 170, mass: 0.7, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(words, {
          toValue: 1,
          duration: 380,
          delay: 140,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    };
    if (reduceMotion.current) {
      arrive();
      return;
    }
    Animated.timing(fly, {
      toValue: 1,
      duration: 380,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(arrive);
  };

  const send = async () => {
    if (sending) return;
    const text = message.trim();
    if (!text) {
      setSubmitted(true);
      return;
    }
    if (!userId) return;

    haptic.tap();
    Keyboard.dismiss();
    setNotice(null);
    setPhase('sending');
    if (!reduceMotion.current) settle(lift, 1).start();

    if (attempt.current?.text !== text) attempt.current = { id: uuidv4(), text };
    const started = Date.now();
    try {
      const res = await sendFeedback({ clientId: attempt.current.id, body: text });
      if (!mounted.current) {
        if (res.kind === 'ok') void clearFeedbackDraft(userId);
        return;
      }
      if (res.kind === 'limit') {
        settle(lift, 0).start();
        setPhase('write');
        setNotice({ tone: 'warning', text: 'feedback.limit' });
        return;
      }
      attempt.current = null;
      await clearFeedbackDraft(userId);
      await wait(Math.max(0, MIN_SENDING_MS - (Date.now() - started)));
      if (mounted.current) celebrate();
    } catch (e) {
      if (!mounted.current) return;
      settle(lift, 0).start();
      setPhase('write');
      setNotice(faultNotice(e instanceof JournalError ? e.kind : 'unknown'));
    }
  };

  const writeAnother = () => {
    for (const v of [lift, fly, pop, ring, words]) v.setValue(0);
    setSubmitted(false);
    setNotice(null);
    setPhase('write');
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/chat'));

  // --------------------------------------------------------------------- sent

  if (phase === 'sent') {
    return (
      <Screen
        footer={
          <View className="gap-xs">
            <LiquidButton title={t('feedback.backToChat')} onPress={() => router.navigate('/chat')} />
            <TextButton title={t('feedback.writeAnother')} onPress={writeAnother} className="self-center" />
          </View>
        }
        header={<TopBar onBack={back} />}>
        <View className="flex-1 items-center justify-center gap-lg">
          <View style={{ width: RING, height: RING }} className="items-center justify-center">
            {/* One ring spreading out from the heart, like a stone landing in water. */}
            <Animated.View
              pointerEvents="none"
              style={{
                width: RING,
                height: RING,
                borderRadius: RING / 2,
                borderWidth: 1,
                borderColor: colors.brandViolet,
                opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] }),
                transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
              }}
              className="absolute"
            />
            <Animated.View
              style={{
                opacity: pop.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' }),
                transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
              }}>
              <Icon name="heart" size={SENT_HEART} filled color={colors.brandViolet} />
            </Animated.View>
          </View>

          <Animated.View
            style={{
              opacity: words,
              transform: [{ translateY: words.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            }}
            className="gap-sm">
            <Text variant="lead" tone="strong" center>
              {t('feedback.sent')}
            </Text>
            <Text variant="body" center>
              {t('feedback.body4')}
            </Text>
          </Animated.View>
        </View>
      </Screen>
    );
  }

  // -------------------------------------------------------------------- write

  /** The words above the card step back as it leaves. */
  const aside = { opacity: fly.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }) };
  const card = {
    opacity: fly.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 0.85, 0] }),
    transform: [
      {
        translateY: Animated.add(
          lift.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }),
          fly.interpolate({ inputRange: [0, 1], outputRange: [0, -FLY_DISTANCE] }),
        ),
      },
      {
        scale: Animated.multiply(
          lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }),
          fly.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }),
        ),
      },
    ],
  };

  return (
    <Screen
      avoidKeyboard
      footer={
        <View className="gap-sm">
          <LiquidButton
            title={t('feedback.send')}
            loading={sending}
            loadingTitle={t('feedback.sending')}
            onPress={() => void send()}
            accessory={<Icon name="send" size={17} weight="bold" color={capsule.label} />}
          />

          {/* While typing, only the send button stays above the keyboard: the rule and
             the email line would take the room the message needs. */}
          {keyboardUp ? null : (
            <Animated.View style={aside} className="gap-sm">
              {/* "NEBO" sits inside a full-width rule. */}
              <View className="flex-row items-center gap-sm pt-xs">
                {/* Drawn inline rather than with Divider: the needed strength (`edge-strong`)
                   would clash with the background class Divider already sets. */}
                <View className="h-px flex-1 shrink bg-edge-strong" />
                <Text variant="label" tone="placeholder">
                  {t('feedback.or')}
                </Text>
                <View className="h-px flex-1 shrink bg-edge-strong" />
              </View>

              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${t('feedback.orWrite')} ${EMAIL}`}
                onPress={() => Linking.openURL(`mailto:${EMAIL}`).catch(() => {})}
                className="flex-row flex-wrap items-center justify-center gap-xxs active:opacity-70">
                <Text variant="caption" tone="placeholder" className="font-sans-medium">
                  {t('feedback.orWrite')}
                </Text>
                <Text variant="caption" tone="brand" className="font-sans-medium">
                  {EMAIL}
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </View>
      }
      header={<TopBar onBack={back} />}>
      {/* With the keyboard up the heading and the two paragraphs step aside, so the
         message box has the whole space above the keyboard instead of a sliver. */}
      {keyboardUp ? null : (
        <Animated.View style={aside}>
          <Text variant="display" tone="brand" center className="pt-md">
            {t('feedback.heading')}
          </Text>

          {/* Phosphor outline heart; the Unicode heart isn't in either font. */}
          <View className="items-center pt-xs">
            <Icon name="heart" size={HEART} weight="light" color={colors.brandViolet} />
          </View>

          <View className="gap-lg pt-xl">
            <Text variant="body" tone="strong">
              {t('feedback.intro')}
            </Text>
            <Text variant="body" tone="strong">
              {t('feedback.body1')}
            </Text>
          </View>
        </Animated.View>
      )}

      {notice ? (
        <Banner
          tone={notice.tone}
          message={t(notice.text)}
          onDismiss={() => setNotice(null)}
          className={keyboardUp ? 'mt-sm' : 'mt-lg'}
        />
      ) : null}

      {/* The card is the field (`bare` TextArea), visible without scrolling. */}
      <Animated.View style={card} className={keyboardUp || notice ? 'mt-sm flex-1' : 'mt-lg flex-1'}>
        <GlassCard className="flex-1" padding="flex-1 px-md py-sm">
          <TextArea
            bare
            grow
            value={message}
            onChangeText={(next) => {
              setMessage(next);
              if (submitted) setSubmitted(false);
            }}
            error={submitted && !canSend ? t('feedback.messageRequired') : undefined}
            placeholder={t('feedback.placeholder')}
            maxLength={MAX_FEEDBACK_CHARS}
            editable={!sending}
            className="flex-1"
          />
        </GlassCard>
      </Animated.View>

      {count >= FEEDBACK_COUNTER_FROM ? (
        <View className="flex-row items-center justify-between pt-xxs">
          {atMax ? <InlineMessage tone="warning" message={t('feedback.maxReached')} /> : <View />}
          <Text variant="micro" tone={atMax ? 'warning' : 'tertiary'}>
            {t('feedback.counter', { count: formatNumber(count), max: formatNumber(MAX_FEEDBACK_CHARS) })}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}
