import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { HOME_FOR, useSession } from '../auth';
import {
  Banner,
  CodeField,
  LiquidButton,
  LoadingState,
  Screen,
  Text,
  TextButton,
  Title,
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
      {/* Same shape as sign-in: header, code and CTA as one group, centred on the screen. */}
      <View className="flex-1 justify-center gap-xxl py-xl">
        <View className="items-center gap-xs">
          <Title center>{t('auth.verifyEmail')}</Title>
          <Text variant="lead" tone="secondary" center>
            {t('auth.verifyEmailMessage', { email: pendingEmail ?? '' })}
          </Text>
        </View>

        <View className="gap-md">
          <CodeField
            label={t('auth.verifyCode')}
            value={code}
            onChangeText={onCodeChange}
            length={EMAIL_CODE_LENGTH}
            error={codeError}
            disabled={busy}
            autoFocus
          />
          {/* Resend is a quiet line under the code: a countdown first, then a link. */}
          <View className="items-center">
            {cooldown > 0 ? (
              <Text variant="micro" tone="tertiary" className="py-xs">
                {t('auth.resendIn', { seconds: String(cooldown) })}
              </Text>
            ) : (
              <TextButton title={t('auth.resend')} icon="mail" className="self-center" onPress={resend} />
            )}
          </View>
          {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
        </View>

        <View className="gap-sm">
          <LiquidButton title={t('auth.verifyConfirm')} loading={busy} onPress={() => confirm()} />
          <TextButton title={t('auth.useAnotherEmail')} tone="secondary" className="self-center" onPress={useAnotherEmail} />
        </View>
      </View>
    </Screen>
  );
}
