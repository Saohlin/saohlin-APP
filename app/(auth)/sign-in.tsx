import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useSession } from '../../auth';
import { LiquidButton, Screen, TextButton, TextField, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { authErrorKey, isEmailNotConfirmed, looksLikeEmail } from '../../lib/authErrors';
import { EMAIL_VERIFICATION_REQUIRED } from '../../lib/config';

export default function SignIn() {
  const { t } = useI18n();
  const { signIn } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string>();
  const [error, setError] = useState<string>();

  const submit = async () => {
    setError(undefined);
    setEmailError(undefined);
    if (!looksLikeEmail(email)) {
      setEmailError(t('validation.emailInvalid'));
      return;
    }
    if (!password || busy) return;

    setBusy(true);
    try {
      await signIn(email, password);
      // No navigation here: the guards route from the new status.
    } catch (e) {
      if (EMAIL_VERIFICATION_REQUIRED && isEmailNotConfirmed(e)) {
        router.replace('/verify-email');
        return;
      }
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll avoidKeyboard footer={<LiquidButton title={t('auth.signIn')} loading={busy} onPress={submit} />}>
      <Title center className="pt-xl">
        {t('auth.signIn')}
      </Title>

      <View className="flex-1 justify-center gap-xxl pt-xl">
        <TextField
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          error={emailError}
        />
        <TextField
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          password
          textContentType="password"
          autoComplete="current-password"
          error={error}
        />
        <TextButton
          title={t('auth.forgotPassword')}
          onPress={() => router.push({ pathname: '/forgot-password', params: { email } })}
          className="self-end"
        />
      </View>
    </Screen>
  );
}
