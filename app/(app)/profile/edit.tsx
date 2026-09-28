import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { czechVocative, useSession, zodiacFor, type DeeperAnswers, type Gender } from '../../../auth';
import {
  Banner,
  DateField,
  LiquidButton,
  ListRow,
  Screen,
  SectionHeader,
  SelectField,
  Sheet,
  Text,
  TextArea,
  TextField,
  Title,
  TopBar,
  useDatePicker,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import type { Dictionary, Path } from '../../../i18n';
import { authErrorKey } from '../../../lib/authErrors';
import { MIN_AGE } from '../../../lib/config';

const GENDERS: Array<{ value: Gender; label: Path<Dictionary> }> = [
  { value: 'female', label: 'onboarding.genderFemale' },
  { value: 'male', label: 'onboarding.genderMale' },
  { value: 'other', label: 'onboarding.genderOther' },
  { value: 'unspecified', label: 'onboarding.genderUnspecified' },
];

const ANSWERS: Array<{ key: keyof DeeperAnswers; label: Path<Dictionary>; placeholder: Path<Dictionary> }> = [
  { key: 'work', label: 'onboarding.work', placeholder: 'onboarding.workPlaceholder' },
  { key: 'situation', label: 'onboarding.situation', placeholder: 'onboarding.situationPlaceholder' },
  { key: 'blocking', label: 'onboarding.blocking', placeholder: 'onboarding.blockingPlaceholder' },
  { key: 'visions', label: 'onboarding.visions', placeholder: 'onboarding.visionsPlaceholder' },
];

/** ISO `YYYY-MM-DD` to `DD . MM . YYYY`. */
function displayDob(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d} . ${m} . ${y}`;
}

const DOB_EARLIEST = new Date(1900, 0, 1);
const dobLatest = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE);
  return d;
};

/** Edit name, greeting, date of birth, gender and the four onboarding answers. */
export default function EditProfile() {
  const { t } = useI18n();
  const router = useRouter();
  const { profile, context, saveProfile, saveDeeper } = useSession();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [vocative, setVocative] = useState(profile?.vocative ?? '');
  const [dob, setDob] = useState(profile?.dateOfBirth);
  const [gender, setGender] = useState<Gender | undefined>(profile?.gender);
  const [answers, setAnswers] = useState<DeeperAnswers>(context);
  const [genderOpen, setGenderOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const dobPicker = useDatePicker({
    value: dob,
    onChange: setDob,
    title: t('onboarding.dateOfBirth'),
    initial: new Date(1990, 0, 1),
    minimumDate: DOB_EARLIEST,
    maximumDate: dobLatest(),
  });

  const genderLabel = GENDERS.find((g) => g.value === gender);

  const onNameChange = (v: string) => {
    // Keep the greeting in step with the name unless the user changed it by hand.
    if (vocative === czechVocative(displayName)) setVocative(czechVocative(v));
    setDisplayName(v);
  };

  const save = async () => {
    const name = displayName.trim();
    if (!name) {
      setSubmitted(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveProfile({
        displayName: name,
        vocative: vocative.trim() || czechVocative(name),
        dateOfBirth: dob,
        gender,
        zodiac: zodiacFor(dob),
      });
      const cleaned: DeeperAnswers = {};
      ANSWERS.forEach(({ key }) => {
        const v = answers[key]?.trim();
        if (v) cleaned[key] = v;
      });
      const changed = ANSWERS.some(({ key }) => (cleaned[key] ?? '') !== (context[key] ?? ''));
      if (changed) await saveDeeper(cleaned);
      router.back();
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      avoidKeyboard
      footer={
        <View className="pb-lg">
          {error ? <Banner tone="warning" message={error} className="mb-md" /> : null}
          <LiquidButton title={t('common.save')} loading={busy} onPress={save} />
        </View>
      }>
      <TopBar onBack={() => router.back()} />

      <Title center className="pt-sm">
        {t('profile.edit')}
      </Title>

      <View className="gap-xl pt-xl">
        <TextField
          label={t('onboarding.howToAddress')}
          placeholder={t('auth.firstNamePlaceholder')}
          value={displayName}
          error={submitted && !displayName.trim() ? t('onboarding.nameRequired') : undefined}
          onChangeText={onNameChange}
          autoCapitalize="words"
          textContentType="givenName"
        />
        <View>
          <TextField
            label={t('profile.vocative')}
            value={vocative}
            onChangeText={setVocative}
            autoCapitalize="words"
          />
          <Text variant="micro" tone="tertiary" className="pt-xxs">
            {t('profile.vocativeHint')}
          </Text>
        </View>
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

      <SectionHeader title={t('profile.aboutYou')} className="pt-xl" />
      <View className="gap-lg">
        {ANSWERS.map(({ key, label, placeholder }) => (
          <View key={key}>
            <Text variant="label" tone="secondary" className="pb-xs">
              {t(label)}
            </Text>
            <TextArea
              value={answers[key] ?? ''}
              onChangeText={(v) => setAnswers((a) => ({ ...a, [key]: v }))}
              placeholder={t(placeholder)}
              minHeight={96}
            />
          </View>
        ))}
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
