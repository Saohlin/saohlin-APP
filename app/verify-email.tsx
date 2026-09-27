import { useRouter } from 'expo-router';

import { useSession } from '../auth';
import { EmptyState, Screen, SecondaryButton, TextButton } from '../components/ui';
import { useI18n } from '../i18n';

// Outside the guarded groups: signed in but not yet verified.
export default function VerifyEmail() {
  const { t } = useI18n();
  const { signOut, refresh } = useSession();
  const router = useRouter();

  return (
    <Screen>
      <EmptyState
        icon="mail"
        title={t('auth.verifyEmail')}
        message={t('states.emptyHistoryMessage')}
      />
      <SecondaryButton title={t('auth.resend')} icon="mail" onPress={refresh} />
      <TextButton
        title={t('auth.signOut')}
        tone="secondary"
        className="self-center pt-md"
        onPress={async () => {
          await signOut();
          router.replace('/sign-in');
        }}
      />
    </Screen>
  );
}
