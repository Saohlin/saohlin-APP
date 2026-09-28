import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import {
  Banner,
  GlassCard,
  Icon,
  LiquidButton,
  Screen,
  StepBar,
  Text,
  TextArea,
} from '../../components/ui';
import { useSession } from '../../auth';
import type { DeeperAnswers } from '../../auth';
import { authErrorKey } from '../../lib/authErrors';
import { useTheme, type as typeScale } from '../../theme';
import { useI18n } from '../../i18n';
import type { Dictionary, Path } from '../../i18n';

/**
 * Onboarding part 2: four questions (work, current situation, what holds you
 * back, visions). Sensitive answers, collected after consent and sign-up.
 * Only "Next" advances the sequence. Where a step has a `prompt`, it's shown
 * above the field so it stays visible while typing. The glass card is the input.
 */
const STEPS: Array<{
  key: keyof DeeperAnswers;
  title: Path<Dictionary>;
  placeholder: Path<Dictionary>;
  /** Prompt shown above the entry area and kept while typing. */
  prompt?: Path<Dictionary>;
}> = [
  {
    key: 'work',
    title: 'onboarding.work',
    placeholder: 'onboarding.workPlaceholder',
    prompt: 'onboarding.workPrompt',
  },
  { key: 'situation', title: 'onboarding.situation', placeholder: 'onboarding.situationPlaceholder' },
  { key: 'blocking', title: 'onboarding.blocking', placeholder: 'onboarding.blockingPlaceholder' },
  { key: 'visions', title: 'onboarding.visions', placeholder: 'onboarding.visionsPlaceholder' },
];

export default function Deeper() {
  const { t } = useI18n();
  const { saveDeeper } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(['', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const last = step === STEPS.length - 1;
  const prompt = STEPS[step].prompt;
  /**
   * Entry area height, the same on every step (about 27% of screen height), so
   * the box doesn't change size between questions.
   */
  const entry = Math.max(96, Math.round(height * 0.27));
  const setAnswer = (v: string) =>
    setAnswers((a) => a.map((prev, i) => (i === step ? v : prev)));

  /**
   * Saves the answers keyed by topic. Blank answers are omitted rather than
   * stored as empty strings.
   */
  const finish = async () => {
    const answers_: DeeperAnswers = {};
    STEPS.forEach((s, i) => {
      const v = answers[i].trim();
      if (v) answers_[s.key] = v;
    });
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveDeeper(answers_);
      router.push('/welcome');
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      footer={
        /* Lifts the button off the home indicator. */
        <View className="pb-lg">
        {error ? <Banner tone="warning" message={error} className="mb-md" /> : null}
        <LiquidButton
          title={t(last ? 'common.continue' : 'common.next')}
          loading={last && busy}
          // The last step goes to the welcome screen; onboarding is completed there,
          // otherwise the guard would redirect straight to chat.
          onPress={() => (last ? finish() : setStep((s) => s + 1))}
        />
        </View>
      }>
      <StepBar total={STEPS.length} current={step} className="mt-sm" />

      {/* Kept on one line; shrinks to fit narrow screens. */}
      <Text variant="titleLg" center numberOfLines={1} adjustsFontSizeToFit className="pt-lg">
        {t('onboarding.deeperTitle')}
      </Text>

      <GlassCard className="mt-lg" padding="px-md py-lg">
        <Text variant="label" tone="tertiary" center>
          {t('onboarding.stepOf', { current: step + 1, total: STEPS.length })}
        </Text>
        <Text variant="title" center className="pt-sm">
          {t(STEPS[step].title)}
        </Text>
        {prompt ? (
          <Text variant="body" className="pt-md">
            {t(prompt)}
          </Text>
        ) : null}
        {/* Fixed height (not minHeight) so the box doesn't grow while typing; text scrolls inside. */}
        <View className="pt-md" style={{ height: entry }}>
          <TextArea
            bare
            grow
            value={answers[step]}
            onChangeText={setAnswer}
            placeholder={prompt ? undefined : t(STEPS[step].placeholder)}
          />
        </View>
      </GlassCard>

      <View className="gap-md pt-lg">
        {(['onboarding.deeperNoteEdit', 'onboarding.deeperNoteMore'] as const).map((k) => (
          <View key={k} className="flex-row items-start gap-sm">
            {/* Icon box is one line tall, so the icon centres on the first line of text. */}
            <View
              style={{
                height: typeScale.bodyMedium.lineHeight,
                justifyContent: 'center',
                // Nudged down slightly; the heart glyph is optically bottom-heavy.
                paddingTop: 4,
              }}>
              <Icon name="heart" size={24} weight="regular" color={colors.accentStrong} />
            </View>
            <Text variant="bodyMedium" tone="secondary" className="flex-1 pr-xl">
              {t(k)}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}
