import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useSession } from '../../auth';
import { LiquidButton, Screen, TextButton, TextField, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

export default function SignIn() {
  const { t } = useI18n();
  const { signIn } = useSession();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setError(undefined);
    setBusy(true);
    try {
      await signIn(email, password);
      // No explicit navigation: the guards route from the new status, so there
      // is one source of truth for where a signed-in user goes.
    } catch {
      setError(t('validation.passwordWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      footer={<LiquidButton title={t('auth.signIn')} loading={busy} onPress={submit} />}>
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
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextField
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          password
          textContentType="password"
          error={error}
        />
        <TextButton
          title={t('auth.forgotPassword')}
          onPress={() => router.push('/forgot-password')}
          className="self-end"
        />
      </View>
    </Screen>
  );
}
