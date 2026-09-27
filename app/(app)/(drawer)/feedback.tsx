import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import {
  GlassCard,
  Icon,
  LiquidButton,
  Screen,
  Text,
  TextArea,
  TopBar,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { capsule, useTheme } from '../../../theme';

/**
 * Feedback: heading, short intro, a text field that fills the rest of the
 * screen, the send button, and an email alternative below.
 */
const EMAIL = 'info@saohlin.com';
/** Heart icon size under the heading. */
const HEART = 31;

export default function Feedback() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const [message, setMessage] = useState('');
  /** Set on the first press. The button is never disabled; an empty message shows a field error. */
  const [submitted, setSubmitted] = useState(false);
  const canSend = message.trim().length > 0;

  return (
    <Screen
      avoidKeyboard
      footer={
        <View className="gap-sm">
          <LiquidButton
            title={t('feedback.send')}
            // TODO: send feedback to the backend, then show the `feedback.sent` confirmation.
            onPress={() => {
              if (!canSend) {
                setSubmitted(true);
                return;
              }
              router.back();
            }}
            accessory={<Icon name="send" size={17} weight="bold" color={capsule.label} />}
          />

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
            onPress={() => Linking.openURL(`mailto:${EMAIL}`)}
            className="flex-row flex-wrap items-center justify-center gap-xxs active:opacity-70">
            <Text variant="caption" tone="placeholder" className="font-sans-medium">
              {t('feedback.orWrite')}
            </Text>
            <Text variant="caption" tone="brand" className="font-sans-medium">
              {EMAIL}
            </Text>
          </Pressable>
        </View>
      }>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/chat'))} />

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

      {/* The card is the field (`bare` TextArea), visible without scrolling. */}
      <GlassCard className="mt-lg flex-1" padding="flex-1 px-md py-sm">
        <TextArea
          bare
          grow
          value={message}
          onChangeText={setMessage}
          error={submitted && !canSend ? t('feedback.messageRequired') : undefined}
          placeholder={t('feedback.placeholder')}
          className="flex-1"
        />
      </GlassCard>
    </Screen>
  );
}
