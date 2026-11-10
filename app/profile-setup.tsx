import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useSession, zodiacFor, type Gender } from '../auth';
import {
  Banner,
  DateField,
  LiquidButton,
  ListRow,
  Screen,
  SelectField,
  Sheet,
  Text,
  TextButton,
  TextField,
  Title,
  useDatePicker,
  useKeyboardVisible,
} from '../components/ui';
import { useI18n } from '../i18n';
import { authErrorKey } from '../lib/authErrors';
import { MIN_AGE } from '../lib/config';
import { openLegal } from '../lib/legal';
import type { Dictionary, Path } from '../i18n';

/**
 * Onboarding part 1: name, date of birth, gender.
 * - The Czech vocative is derived from the name and stored; it can be corrected
 *   later from the profile.
 * - Pressing Continue accepts the terms; consent is staged and sent with sign-up.
 * - Zodiac is derived from the date of birth.
 * Date is stored as ISO and gender as a key, not as display strings.
 */
const GENDERS: Array<{ value: Gender; label: Path<Dictionary> }> = [
  { value: 'female', label: 'onboarding.genderFemale' },
  { value: 'male', label: 'onboarding.genderMale' },
  { value: 'other', label: 'onboarding.genderOther' },
  { value: 'unspecified', label: 'onboarding.genderUnspecified' },
];

/** ISO `YYYY-MM-DD` to `DD . MM . YYYY`. */
function displayDob(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d} . ${m} . ${y}`;
}

/**
 * Dev builds only: an empty name falls back to DEV_NAME so onboarding can be
 * clicked through quickly. `__DEV__` is false in release builds, so this branch
 * is removed there. Don't replace it with `true`.
 */
const SKIP_REQUIRED = __DEV__;
const DEV_NAME = 'Tereza';

const DOB_DEFAULT = new Date(1990, 0, 1);
const DOB_EARLIEST = new Date(1900, 0, 1);
/** Latest allowed birth date: users must be at least MIN_AGE. */
const dobLatest = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE);
  return d;
};

export default function ProfileSetup() {
  const { t } = useI18n();
  const { session, status, grantConsent, saveProfile } = useSession();
  const router = useRouter();
  const keyboardUp = useKeyboardVisible();
  const [displayName, setDisplayName] = useState('');
  const [dob, setDob] = useState<string>();
  const [gender, setGender] = useState<Gender>();
  /**
   * Set on the first press. The button is never disabled; pressing it with an
   * empty name highlights the field instead.
   */
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const [genderOpen, setGenderOpen] = useState(false);

  /** Native date picker; `maximumDate` enforces the minimum age. */
  const dobPicker = useDatePicker({
    value: dob,
    onChange: setDob,
    title: t('onboarding.dateOfBirth'),
    initial: DOB_DEFAULT,
    minimumDate: DOB_EARLIEST,
    maximumDate: dobLatest(),
  });

  const genderLabel = GENDERS.find((g) => g.value === gender);

  const commit = async () => {
    const name = displayName.trim() || (SKIP_REQUIRED ? DEV_NAME : '');
    if (!name) {
      setSubmitted(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // Consent first, so it's never attached to a profile that failed to save.
      await grantConsent();
      await saveProfile({
        displayName: name,
        // The name is used exactly as typed; no Czech vocative is derived from it.
        vocative: name,
        dateOfBirth: dob,
        gender,
        zodiac: zodiacFor(dob),
      });
      // Before an account exists this continues to registration; an existing
      // account missing its profile is routed onward by the guards instead.
      if (!session) router.replace('/sign-up');
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  // This screen sits outside the guarded groups, so it routes itself: once the
  // profile is saved (or was already), move on instead of showing the form again.
  if (status === 'needsDeeper') return <Redirect href="/deeper" />;
  if (status === 'ready') return <Redirect href="/chat" />;

  return (
    <Screen
      scroll
      footer={
        // The deep bottom padding is for the resting layout; above the keyboard it
        // would only take room from the form.
        <View className={keyboardUp ? 'pb-xs' : 'pb-xxl'}>
          {error ? <Banner tone="warning" message={error} className="mb-md" /> : null}
          <LiquidButton title={t('common.continue')} loading={busy} onPress={commit} />
          {/* Links are their own Pressables: nested Text presses were not registering,
             and a 10 pt run of text is too small a target without hitSlop. */}
          {/* One wrapping row, split into words, so the sentence fills the first line
             before it breaks, the way a single paragraph would. */}
          <View className="pt-md">
            <View className="flex-row flex-wrap items-center justify-center gap-x-xxs">
              {t('onboarding.consentPrefix')
                .split(' ')
                .map((word, i) => (
                  <Text key={i} variant="micro" tone="tertiary">
                    {word}
                  </Text>
                ))}
              <Pressable accessibilityRole="link" hitSlop={12} onPress={() => openLegal('terms')} className="py-xxs active:opacity-60">
                <Text variant="micro" tone="tertiary" className="underline">
                  {t('onboarding.consentTerms')}
                </Text>
              </Pressable>
              <Text variant="micro" tone="tertiary">
                {t('onboarding.consentAnd')}
              </Text>
              <Pressable accessibilityRole="link" hitSlop={12} onPress={() => openLegal('privacy')} className="py-xxs active:opacity-60">
                <Text variant="micro" tone="tertiary" className="underline">
                  {t('onboarding.consentPrivacy')}
                </Text>
              </Pressable>
            </View>
          </View>
          {/* Returning users who reinstalled or switched phones land here first. Only
             shown before an account exists; a signed-in user missing a profile stays. */}
          {session ? null : (
            <View className="flex-row items-center justify-center gap-xxs pt-md">
              <Text variant="micro" tone="tertiary">
                {t('auth.haveAccount')}
              </Text>
              <TextButton title={t('auth.signIn')} onPress={() => router.push('/sign-in')} />
            </View>
          )}
        </View>
      }>
      <Title className="pt-xxl">{t('onboarding.profileTitle')}</Title>
      <Text variant="caption" className="pt-lg">
        {t('onboarding.profileSubtitle')}
      </Text>
      <Text variant="caption" className="pt-xxs">
        {t('onboarding.profileNote')}
      </Text>

      {/* Fields take the remaining space and centre in it, so spacing holds across screen sizes. */}
      <View className="flex-1 justify-center gap-xxl pt-xl">
        <TextField
          label={t('onboarding.howToAddress')}
          placeholder={t('auth.firstNamePlaceholder')}
          value={displayName}
          error={submitted && !displayName.trim() ? t('onboarding.nameRequired') : undefined}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          textContentType="givenName"
        />
        <DateField
          label={t('onboarding.dateOfBirth')}
          value={dob ? displayDob(dob) : undefined}
          onPress={dobPicker.open}
        />
        <SelectField
          label={t('onboarding.gender')}
          placeholder={t('onboarding.genderPlaceholder')}
          value={genderLabel ? t(genderLabel.label) : undefined}
          onPress={() => setGenderOpen(true)}
        />
      </View>

      {dobPicker.picker}

      <Sheet visible={genderOpen} onClose={() => setGenderOpen(false)} title={t('onboarding.gender')}>
        {GENDERS.map((g) => (
          <ListRow
            key={g.value}
            title={t(g.label)}
            showChevron={false}
            icon={gender === g.value ? 'check' : undefined}
            onPress={() => {
              setGender(g.value);
              setGenderOpen(false);
            }}
          />
        ))}
      </Sheet>

    </Screen>
  );
}
