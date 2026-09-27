import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useSession } from '../../auth';
import { LiquidButton, Screen, Text, TextButton, TextField, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

/**
 * Create account. Profile answers and consent given earlier in onboarding are
 * sent with the sign-up request, so the account is created with them attached.
 */
type Field = 'firstName' | 'lastName' | 'email' | 'password';

export default function SignUp() {
  const { t } = useI18n();
  const { signUp } = useSession();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const submit = async () => {
    const next: Partial<Record<Field, string>> = {};
    if (!firstName.trim()) next.firstName = t('validation.required');
    if (!lastName.trim()) next.lastName = t('validation.required');
    if (!email.includes('@')) next.email = t('validation.emailInvalid');
    if (password.length < 8) next.password = t('validation.passwordShort');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await signUp(email, password, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      router.replace('/deeper');
    } catch {
      setErrors({ password: t('validation.networkFailed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      footer={
        <View className="gap-sm">
          <LiquidButton title={t('auth.signUp')} loading={busy} onPress={submit} />
          <View className="flex-row items-center justify-center gap-xxs">
            <Text variant="micro" tone="tertiary">
              {t('auth.haveAccount')}
            </Text>
            <TextButton title={t('auth.signIn')} onPress={() => router.push('/sign-in')} />
          </View>
        </View>
      }>
      <Title center className="pt-xl">
        {t('auth.createAccount')}
      </Title>

      <View className="flex-1 justify-center gap-xxl pt-xl">
        <TextField
          label={t('auth.firstName')}
          placeholder={t('auth.firstNamePlaceholder')}
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          error={errors.firstName}
          textContentType="givenName"
        />
        <TextField
          label={t('auth.lastName')}
          placeholder={t('auth.lastNamePlaceholder')}
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          error={errors.lastName}
          textContentType="familyName"
        />
        <TextField
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          error={errors.email}
        />
        <TextField
          label={t('auth.password')}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          password
          textContentType="newPassword"
          error={errors.password}
        />
      </View>
    </Screen>
  );
}
