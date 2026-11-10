import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { HOME_FOR, useSession } from '../auth';
import { Banner, LiquidButton, LoadingState, Screen, TextField, Title } from '../components/ui';
import { useI18n } from '../i18n';
import { authErrorKey, passwordMeetsPolicy } from '../lib/authErrors';

/**
 * Opened from the password reset email. Outside the guarded groups because the
 * link signs the user in before the new password is set.
 */
export default function ResetPassword() {
  const { t } = useI18n();
  const router = useRouter();
  const { status, exchangeCode, updatePassword } = useSession();
  const { code, error_description } = useLocalSearchParams<{ code?: string; error_description?: string }>();

  const [phase, setPhase] = useState<'exchanging' | 'form' | 'expired' | 'done'>(code ? 'exchanging' : 'expired');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!code || error_description || started.current) {
      if (error_description) setPhase('expired');
      return;
    }
    started.current = true;
    exchangeCode(code)
      .then(() => setPhase('form'))
      .catch(() => setPhase('expired'));
  }, [code, error_description, exchangeCode]);

  const save = async () => {
    setError(undefined);
    if (!passwordMeetsPolicy(password)) {
      setError(t('validation.passwordShort'));
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setPhase('done');
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'exchanging') return <LoadingState />;

  if (phase === 'expired') {
    return (
      <Screen footer={<LiquidButton title={t('auth.forgotPassword')} onPress={() => router.replace('/forgot-password')} />}>
        <Title center className="pt-xl">
          {t('auth.resetPassword')}
        </Title>
        <Banner tone="warning" message={t('validation.linkExpired')} className="mt-xl" />
      </Screen>
    );
  }

  if (phase === 'done') {
    const home = HOME_FOR[status] ?? '/sign-in';
    return (
      <Screen footer={<LiquidButton title={t('common.continue')} onPress={() => router.replace(home)} />}>
        <Title center className="pt-xl">
          {t('auth.resetPassword')}
        </Title>
        <Banner tone="success" message={t('auth.passwordUpdated')} className="mt-xl" />
      </Screen>
    );
  }

  return (
    <Screen avoidKeyboard footer={<LiquidButton title={t('common.save')} loading={busy} onPress={save} />}>
      <Title center className="pt-xl">
        {t('auth.resetPassword')}
      </Title>
      <TextField
        label={t('auth.newPassword')}
        placeholder={t('auth.newPasswordPlaceholder')}
        value={password}
        onChangeText={setPassword}
        password
        textContentType="newPassword"
        autoComplete="new-password"
        hint={t('auth.passwordHint')}
        error={error}
        className="mt-xl"
      />
    </Screen>
  );
}
