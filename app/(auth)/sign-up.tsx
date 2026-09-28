import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useSession } from '../../auth';
import { LiquidButton, Screen, Text, TextButton, TextField, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { authErrorKey, looksLikeEmail, passwordMeetsPolicy } from '../../lib/authErrors';
import { EMAIL_VERIFICATION_REQUIRED } from '../../lib/config';

/**
 * Create account: email and password only. The name was already asked on the
 * profile screen; it and the consent are sent with the sign-up request.
 */
type Field = 'email' | 'password';

export default function SignUp() {
  const { t } = useI18n();
  const { signUp } = useSession();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const submit = async () => {
    const next: Partial<Record<Field, string>> = {};
    if (!looksLikeEmail(email)) next.email = t('validation.emailInvalid');
    if (!passwordMeetsPolicy(password)) next.password = t('validation.passwordShort');
    setErrors(next);
    if (Object.keys(next).length || busy) return;

    setBusy(true);
    try {
      const needsVerification = await signUp(email, password);
      // Otherwise the new session routes onward through the guards.
      if (needsVerification) {
        if (EMAIL_VERIFICATION_REQUIRED) router.replace('/verify-email');
        else setErrors({ password: t('validation.confirmationStillOn') });
      }
    } catch (e) {
      const key = authErrorKey(e);
      setErrors(key === 'validation.emailInvalid' ? { email: t(key) } : { password: t(key) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      avoidKeyboard
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
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          error={errors.email}
        />
        <TextField
          label={t('auth.password')}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          password
          textContentType="newPassword"
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
          error={errors.password}
        />
      </View>
    </Screen>
  );
}
