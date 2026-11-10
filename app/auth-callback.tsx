import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { HOME_FOR, useSession } from '../auth';
import { Banner, LiquidButton, LoadingState, Screen, Title } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * Opened from the confirmation email. Exchanges the one-time code for a
 * session, then hands over to wherever the user's status belongs.
 */
export default function AuthCallback() {
  const { t } = useI18n();
  const router = useRouter();
  const { status, exchangeCode } = useSession();
  const { code, error_description } = useLocalSearchParams<{ code?: string; error_description?: string }>();

  const [failed, setFailed] = useState(!code || !!error_description);
  const [exchanged, setExchanged] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!code || error_description || started.current) return;
    started.current = true;
    exchangeCode(code)
      .then(() => setExchanged(true))
      .catch(() => setFailed(true));
  }, [code, error_description, exchangeCode]);

  if (failed) {
    // The link may already have confirmed the email (e.g. opened on another
    // device), so signing in is the reliable way forward.
    return (
      <Screen footer={<LiquidButton title={t('auth.signIn')} onPress={() => router.replace('/sign-in')} />}>
        <Title center className="pt-xl">
          {t('auth.verifyEmail')}
        </Title>
        <Banner tone="warning" message={t('auth.linkOpenedElsewhere')} className="mt-xl" />
      </Screen>
    );
  }

  if (!exchanged || status === 'restoring') return <LoadingState />;

  const home = HOME_FOR[status];
  return home ? <Redirect href={home} /> : <LoadingState />;
}
