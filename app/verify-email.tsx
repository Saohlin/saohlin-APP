import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { HOME_FOR, useSession } from '../auth';
import { Banner, EmptyState, LoadingState, Screen, SecondaryButton, TextButton } from '../components/ui';
import { useI18n } from '../i18n';
import { authErrorKey } from '../lib/authErrors';

/** Resend is limited server-side to once a minute; the button waits too. */
const RESEND_COOLDOWN_S = 60;

/** Outside the guarded groups: the user has registered but has no session yet. */
export default function VerifyEmail() {
  const { t } = useI18n();
  const router = useRouter();
  const { status, pendingEmail, resendVerification, clearPendingEmail, signOut } = useSession();

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

  const resend = async () => {
    setNotice(undefined);
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
    <Screen>
      <View className="flex-1 justify-center">
        <EmptyState
          icon="mail"
          title={t('auth.verifyEmail')}
          message={t('auth.verifyEmailMessage', { email: pendingEmail ?? '' })}
        />
        {notice ? <Banner tone={notice.tone} message={notice.message} className="mt-lg" /> : null}
      </View>

      <View className="gap-md pb-lg">
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
