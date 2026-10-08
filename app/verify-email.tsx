import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { HOME_FOR, useSession } from '../auth';
import {
  Banner,
  EmptyState,
  LiquidButton,
  LoadingState,
  Screen,
  SecondaryButton,
  TextButton,
  TextField,
} from '../components/ui';
import { useI18n } from '../i18n';
import { authErrorKey } from '../lib/authErrors';
import { EMAIL_CODE_LENGTH } from '../lib/config';

/** Resend is limited server-side to once a minute; the button waits too. */
const RESEND_COOLDOWN_S = 60;

/**
 * Outside the guarded groups: the user has registered but has no session yet.
 * The code from the confirmation email is entered here.
 */
export default function VerifyEmail() {
  const { t } = useI18n();
  const router = useRouter();
  const { status, pendingEmail, verifyEmailCode, resendVerification, clearPendingEmail, signOut } = useSession();

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; message: string }>();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (status === 'restoring') return <LoadingState />;
  if (status !== 'needsVerification') {
    const home = HOME_FOR[status];
    if (home) return <Redirect href={home} />;
  }

  const confirm = async (value = code) => {
    if (busy) return;
    if (value.length !== EMAIL_CODE_LENGTH) {
      setCodeError(t('validation.codeInvalid'));
      return;
    }
    setCodeError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      await verifyEmailCode(value);
      // No navigation here: the redirect above routes from the new status.
    } catch (e) {
      setCodeError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, EMAIL_CODE_LENGTH);
    setCode(digits);
    setCodeError(undefined);
    // Submits by itself once complete, which also covers the keyboard's code autofill.
    if (digits.length === EMAIL_CODE_LENGTH && digits !== code) void confirm(digits);
  };

  const resend = async () => {
    setNotice(undefined);
    setCodeError(undefined);
    try {
      await resendVerification();
      setNotice({ tone: 'success', message: t('auth.resendSent') });
      setCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      setNotice({ tone: 'warning', message: t(authErrorKey(e)) });
    }
  };

  const useAnotherEmail = async () => {
    await clearPendingEmail();
    await signOut();
    router.replace('/sign-up');
  };

  return (
    <Screen scroll avoidKeyboard>
      <View className="flex-1 justify-center">
        <EmptyState
          icon="mail"
          title={t('auth.verifyEmail')}
          message={t('auth.verifyEmailMessage', { email: pendingEmail ?? '' })}
        />
        <TextField
          label={t('auth.verifyCode')}
          placeholder={t('auth.verifyCodePlaceholder')}
          value={code}
          onChangeText={onCodeChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={EMAIL_CODE_LENGTH}
          error={codeError}
          className="mt-lg"
        />
        {notice ? <Banner tone={notice.tone} message={notice.message} className="mt-lg" /> : null}
      </View>

      <View className="gap-md pb-lg">
        <LiquidButton title={t('auth.verifyConfirm')} loading={busy} onPress={() => confirm()} />
        <SecondaryButton
          title={cooldown > 0 ? t('auth.resendIn', { seconds: String(cooldown) }) : t('auth.resend')}
          icon="mail"
          disabled={cooldown > 0}
          onPress={resend}
        />
        <TextButton
          title={t('auth.alreadyConfirmed')}
          className="self-center"
          onPress={() => router.push({ pathname: '/sign-in', params: { email: pendingEmail ?? '' } })}
        />
        <TextButton title={t('auth.useAnotherEmail')} tone="secondary" className="self-center" onPress={useAnotherEmail} />
      </View>
    </Screen>
  );
}
