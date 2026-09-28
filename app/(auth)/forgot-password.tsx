import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { useSession } from '../../auth';
import { Banner, LiquidButton, Screen, TextButton, TextField, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import { authErrorKey, looksLikeEmail } from '../../lib/authErrors';

export default function ForgotPassword() {
  const { t } = useI18n();
  const { requestPasswordReset } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(params.email ?? '');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setError(undefined);
    if (!looksLikeEmail(email)) {
      setError(t('validation.emailInvalid'));
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (e) {
      const key = authErrorKey(e);
      // Only connection and rate-limit problems are shown; anything else looks
      // like success so the screen never reveals whether an account exists.
      if (key === 'validation.networkFailed' || key === 'validation.rateLimited') setError(t(key));
      else setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      avoidKeyboard
      footer={
        sent ? (
          <LiquidButton title={t('auth.signIn')} onPress={() => router.replace({ pathname: '/sign-in', params: { email } })} />
        ) : (
          <LiquidButton title={t('common.continue')} loading={busy} onPress={submit} />
        )
      }>
      <Title center className="pt-xl">
        {t('auth.forgotPassword')}
      </Title>
      {sent ? (
        <Banner tone="success" message={t('auth.resetSent')} className="mt-xl" />
      ) : (
        <>
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
            error={error}
            className="mt-xl"
          />
          <TextButton title={t('common.back')} tone="secondary" className="self-center pt-lg" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
